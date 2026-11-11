import { getEnriched } from "../invoices.js";
import { sendReminder } from "../paypal.js";
import { checkPolicy } from "./policy.js";
import {
  getState,
  getSettings,
  enqueueItem,
  addAuditEntry,
  getRecentRemindersForInvoice,
} from "./store.js";

function cleanJsonText(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  }
  return cleaned.trim();
}

async function callLlmForReminders(prompt, { apiKey, model, endpoint, providerName = "AI" }) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: "system",
          content: `You are InvoicePilot's Collections Agent. Your job is to review a compact list of unpaid PayPal invoices and propose collection actions (remind or skip).
Strict Rules:
- Return ONLY a raw JSON array matching this schema:
  [{ "invoiceId": "...", "action": "remind" | "skip", "tone": "friendly" | "firm" | "final", "subject": "...", "message": "...", "reason": "..." }]
- Tones:
  * 1 to 7 days overdue: "friendly"
  * 8 to 21 days overdue: "firm"
  * 22+ days overdue: "final"
  * If client reliability is 80 or higher and under 8 days overdue: always "friendly"
- Reminder message must be short, polite, professional, in first person ("I", "my") from the freelancer.
- State invoice number, amount, and due date exactly as provided.
- NEVER include URLs or links.
- NEVER threaten legal action, courts, lawyers, or police.
- If an invoice was recently reminded or is not worth chasing, use action "skip" with a short reason.
- Output NO markdown text, no intro, no outro, ONLY the JSON array.`,
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${providerName} API error (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content || "";
  return rawText;
}

export async function runCollectionsAgent({ runId = `run_${Date.now()}` } = {}) {
  const settings = getSettings();
  const killSwitch = !settings.enabled;

  if (killSwitch) {
    addAuditEntry({
      runId,
      agent: "collections",
      observation: "Kill switch is active.",
      decision: "blocked",
      reason: "Agent run was blocked by global kill switch.",
      policyResult: { allowed: false, rule: "P8" },
    });
    return { status: "blocked", reason: "Kill switch enabled" };
  }

  // Multi-provider AI resolver (Groq, Gemini, DeepSeek, OpenAI)
  let llmConfig = null;
  if (process.env.GROQ_API_KEY) {
    llmConfig = {
      apiKey: process.env.GROQ_API_KEY,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.AI_MODEL || "qwen/qwen3.8-27b",
      providerName: "Groq",
    };
  } else if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    llmConfig = {
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: process.env.AI_MODEL || "gemini-2.5-flash",
      providerName: "Gemini",
    };
  } else if (process.env.DEEPSEEK_API_KEY || process.env.deepseek_API_KEY) {
    llmConfig = {
      apiKey: process.env.DEEPSEEK_API_KEY || process.env.deepseek_API_KEY,
      endpoint: "https://api.deepseek.com/chat/completions",
      model: process.env.AI_MODEL || "deepseek-chat",
      providerName: "DeepSeek",
    };
  } else if (process.env.OPENAI_API_KEY) {
    llmConfig = {
      apiKey: process.env.OPENAI_API_KEY,
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: process.env.AI_MODEL || "gpt-4o-mini",
      providerName: "OpenAI",
    };
  }

  if (!llmConfig) {
    throw new Error("No AI API key found. Please set GEMINI_API_KEY or GROQ_API_KEY in .env.local.");
  }

  // 1. Observe: Load live invoices and client insights
  const { invoices = [], clients = [] } = await getEnriched();

  // Filter: Keep open invoices that are overdue (> 0 days)
  const candidateInvoices = invoices.filter(
    (inv) => inv.open && ["SENT", "PARTIALLY_PAID"].includes(inv.status) && (inv.daysOverdue || 0) > 0
  );

  const clientMap = new Map();
  for (const c of clients) {
    if (c.email) clientMap.set(c.email.toLowerCase(), c);
    if (c.name) clientMap.set(c.name.toLowerCase(), c);
  }

  if (candidateInvoices.length === 0) {
    addAuditEntry({
      runId,
      agent: "collections",
      observation: `Reviewed ${invoices.length} invoices. 0 overdue open invoices found.`,
      decision: "idle",
      reason: "No invoices require collections chasing.",
      policyResult: { allowed: true, rule: "OBSERVE_ONLY" },
    });
    return { status: "completed", actions: 0, reason: "No overdue open invoices" };
  }

  // Compact payload for single batched LLM call
  const compactCandidates = candidateInvoices.map((inv) => {
    const client =
      (inv.email && clientMap.get(inv.email.toLowerCase())) ||
      (inv.client && clientMap.get(inv.client.toLowerCase())) ||
      {};
    const recent = getRecentRemindersForInvoice(inv.id);
    const ms24h = 24 * 60 * 60 * 1000;
    const remindersLast24h = recent.filter((t) => Date.now() - t < ms24h).length;

    return {
      invoiceId: inv.id,
      number: inv.number || inv.id,
      client: inv.client || "Client",
      amount: inv.amount,
      currency: inv.currency,
      dueDate: inv.dueDate,
      daysOverdue: inv.daysOverdue,
      reliability: client.reliability ?? 75,
      avgDaysLate: client.avgDaysLate ?? 0,
      remindersLast24h,
    };
  });

  const promptText = `Evaluate these overdue invoices and decide whether to send a reminder or skip:\n${JSON.stringify(
    compactCandidates,
    null,
    2
  )}`;

  // 2. Decide: Single batched LLM call with retry
  let decisions = null;
  let rawResponse = "";
  try {
    rawResponse = await callLlmForReminders(promptText, llmConfig);
    decisions = JSON.parse(cleanJsonText(rawResponse));
  } catch (err1) {
    console.warn("First LLM parse failed, retrying once...", err1.message);
    try {
      const retryPrompt = `${promptText}\n\nERROR: Your previous output failed: ${err1.message}. Return ONLY a valid JSON array matching the requested schema.`;
      rawResponse = await callLlmForReminders(retryPrompt, llmConfig);
      decisions = JSON.parse(cleanJsonText(rawResponse));
    } catch (err2) {
      addAuditEntry({
        runId,
        agent: "collections",
        observation: `Failed to parse LLM decisions after 1 retry for ${candidateInvoices.length} invoices.`,
        decision: "failed",
        reason: `JSON parsing error: ${err2.message}`,
        result: { error: err2.message, raw: rawResponse.slice(0, 300) },
      });
      throw new Error(`Collections Agent failed JSON validation: ${err2.message}`);
    }
  }

  if (!Array.isArray(decisions)) {
    throw new Error("LLM response did not return an array of decisions.");
  }

  // 3 & 4. Validate & Policy Check per action
  let executedCount = 0;
  let queuedCount = 0;
  const results = [];

  for (const item of decisions) {
    const inv = candidateInvoices.find((i) => i.id === item.invoiceId);
    const client = inv
      ? (inv.email && clientMap.get(inv.email.toLowerCase())) ||
        (inv.client && clientMap.get(inv.client.toLowerCase()))
      : null;

    const action = {
      type: item.action,
      invoiceId: item.invoiceId,
      tone: item.tone,
      subject: item.subject,
      message: item.message,
      reason: item.reason,
    };

    const recent = getRecentRemindersForInvoice(item.invoiceId);
    const policyResult = checkPolicy(action, {
      invoice: inv,
      client,
      recentReminders: recent,
      actionsThisRun: executedCount + queuedCount,
      agentEnabled: settings.enabled,
      killSwitch,
    });

    if (!policyResult.allowed) {
      addAuditEntry({
        runId,
        agent: "collections",
        observation: `Invoice #${inv?.number || item.invoiceId} (${inv?.client}), overdue ${inv?.daysOverdue}d.`,
        decision: item.action,
        reason: item.reason,
        policyResult,
        action,
        result: { status: "BLOCKED", rule: policyResult.rule, reason: policyResult.reason },
      });
      results.push({ invoiceId: item.invoiceId, allowed: false, rule: policyResult.rule });
      continue;
    }

    // Action is allowed by policy
    if (action.type === "skip") {
      addAuditEntry({
        runId,
        agent: "collections",
        observation: `Invoice #${inv?.number || item.invoiceId} (${inv?.client}), overdue ${inv?.daysOverdue}d.`,
        decision: "skip",
        reason: item.reason || "Skipped by recommendation.",
        policyResult,
        action,
        result: { status: "SKIPPED" },
      });
      results.push({ invoiceId: item.invoiceId, allowed: true, action: "skip" });
      continue;
    }

    // Remind action: Check Autopilot
    if (settings.autopilot) {
      // Execute directly
      try {
        const paypalRes = await sendReminder(action.invoiceId, {
          subject: action.subject,
          note: action.message,
        });

        addAuditEntry({
          runId,
          agent: "collections",
          observation: `Invoice #${inv?.number || item.invoiceId} (${inv?.client}), overdue ${inv?.daysOverdue}d.`,
          decision: "remind",
          reason: item.reason,
          policyResult,
          action,
          result: { ok: true, status: paypalRes.status || 204, executedVia: "autopilot" },
        });

        executedCount++;
        results.push({ invoiceId: item.invoiceId, allowed: true, action: "executed", status: 204 });
      } catch (sendErr) {
        addAuditEntry({
          runId,
          agent: "collections",
          observation: `Invoice #${inv?.number || item.invoiceId} (${inv?.client}), overdue ${inv?.daysOverdue}d.`,
          decision: "remind",
          reason: item.reason,
          policyResult,
          action,
          result: { ok: false, error: sendErr.message },
        });
        results.push({ invoiceId: item.invoiceId, allowed: true, action: "failed", error: sendErr.message });
      }
    } else {
      // Queue for human approval
      const queuedItem = enqueueItem({
        agent: "collections",
        type: "remind",
        invoiceId: action.invoiceId,
        payload: {
          invoiceNumber: inv?.number,
          client: inv?.client,
          email: inv?.email,
          amount: inv?.amount,
          currency: inv?.currency,
          dueDate: inv?.dueDate,
          daysOverdue: inv?.daysOverdue,
          tone: action.tone,
          subject: action.subject,
          message: action.message,
        },
        reason: item.reason || `${action.tone} collection reminder for overdue invoice`,
      });

      addAuditEntry({
        runId,
        agent: "collections",
        observation: `Invoice #${inv?.number || item.invoiceId} (${inv?.client}), overdue ${inv?.daysOverdue}d.`,
        decision: "remind",
        reason: item.reason,
        policyResult,
        action,
        result: { status: "QUEUED_FOR_APPROVAL", queueId: queuedItem.id },
      });

      queuedCount++;
      results.push({ invoiceId: item.invoiceId, allowed: true, action: "queued", queueId: queuedItem.id });
    }
  }

  return {
    status: "completed",
    runId,
    candidateCount: candidateInvoices.length,
    executedCount,
    queuedCount,
    results,
  };
}
