import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, runTool } from "@/lib/tools";

export const maxDuration = 60;

const system = () => `You are InvoicePilot, an AI invoicing and collections agent for freelancers who bill international clients through PayPal (sandbox). Today is ${new Date().toISOString().slice(0, 10)}.
Rules:
- Never guess invoice data. Use tools. To find an invoice id, call list_invoices.
- Never calculate fees, FX or dates yourself: call a tool (calc_net_receipt, plan_cash, list_invoices) and explain its result. Label all INR figures as estimates.
- Before drafting any reminder or advising escalation, call get_client_insights and follow its recommended stage (wait, friendly, firm, final, stop-chasing). Do not skip stages and never over-chase: if the stage is "wait", do not send anything.
- Write reminder text yourself: plain, respectful, specific (invoice number, amount, due date, how to pay). friendly = no pressure; firm = clear pay-by date; final = last notice before pausing work. Never threaten legal action, never invent fees, laws or deadlines.
- Late-fee invoices only after the user confirms their contract allows late fees.
- create_invoice, send_reminder and issue_late_fee_invoice may be queued for user approval. After calling them, say what is waiting for approval; never say it was sent.
- If an email is missing for a new invoice, ask for it. Any name and email can be invoiced.
- For "how much will I receive" questions use calc_net_receipt and explain the fee, GST and spread briefly. Rates are indicative.
- If the user asks about upcoming bills, rent, cash shortfall, or cash gaps, call plan_cash with the bill amount and date.
- If a client is 45+ days overdue, say clearly it is time to stop chasing and explain the options.
- Be concise.`;

async function runOpenAICompatible({ messages, autopilot, pending, log, apiKey, endpoint, defaultModel, providerName }) {
  const openAITools = TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const convo = [
    { role: "system", content: system() },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let step = 0; step < 8; step++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || defaultModel,
        messages: convo,
        tools: openAITools,
        max_tokens: 1500,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`${providerName} error: ${errMsg}`);
    }

    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error(`No response message from ${providerName}`);

    const toolCalls = msg.tool_calls || [];

    // Gemini can return content: null when making tool calls.
    // Ensure the assistant message always has valid content for the conversation history.
    const assistantMsg = { role: "assistant", content: msg.content || "" };
    if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
    convo.push(assistantMsg);

    if (toolCalls.length === 0) {
      return { reply: msg.content || "(done)", pending, log };
    }

    for (const call of toolCalls) {
      const toolName = call.function.name;
      log.push(toolName);
      let input = {};
      try { input = JSON.parse(call.function.arguments || "{}"); } catch {}
      let out, isError = false;
      try { out = await runTool(toolName, input, { autopilot, pending }); }
      catch (e) { out = { error: e.message }; isError = true; }
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(out).slice(0, 12000),
      });
    }
  }

  return { reply: "I reached my step limit. Please try a narrower request.", pending, log };
}

async function runAnthropic({ messages, autopilot, pending, log, apiKey }) {
  const client = new Anthropic({ apiKey });
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  for (let step = 0; step < 8; step++) {
    const res = await client.messages.create({
      model: process.env.AI_MODEL || "claude-3-7-sonnet-20250219",
      max_tokens: 1500,
      system: system(),
      tools: TOOLS,
      messages: convo,
    });
    convo.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use") {
      const reply = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return { reply, pending, log };
    }
    const results = [];
    for (const b of res.content.filter((b) => b.type === "tool_use")) {
      log.push(b.name);
      let out, isError = false;
      try { out = await runTool(b.name, b.input, { autopilot, pending }); }
      catch (e) { out = { error: e.message }; isError = true; }
      results.push({ type: "tool_result", tool_use_id: b.id, is_error: isError, content: JSON.stringify(out).slice(0, 12000) });
    }
    convo.push({ role: "user", content: results });
  }
  return { reply: "I reached my step limit. Please try a narrower request.", pending, log };
}

export async function POST(req) {
  try {
    const { messages, autopilot = false } = await req.json();
    const pending = [], log = [];

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY || process.env.deepseek_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (geminiKey) {
      const result = await runOpenAICompatible({
        messages, autopilot, pending, log,
        apiKey: geminiKey,
        endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        defaultModel: "gemini-2.5-flash",
        providerName: "Gemini",
      });
      return Response.json(result);
    }

    if (deepseekKey) {
      const result = await runOpenAICompatible({
        messages, autopilot, pending, log,
        apiKey: deepseekKey,
        endpoint: "https://api.deepseek.com/chat/completions",
        defaultModel: "deepseek-chat",
        providerName: "DeepSeek",
      });
      return Response.json(result);
    }

    if (groqKey) {
      const result = await runOpenAICompatible({
        messages, autopilot, pending, log,
        apiKey: groqKey,
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        defaultModel: "llama-3.3-70b-versatile",
        providerName: "Groq",
      });
      return Response.json(result);
    }

    if (openaiKey) {
      const result = await runOpenAICompatible({
        messages, autopilot, pending, log,
        apiKey: openaiKey,
        endpoint: "https://api.openai.com/v1/chat/completions",
        defaultModel: "gpt-4o-mini",
        providerName: "OpenAI",
      });
      return Response.json(result);
    }

    if (anthropicKey) {
      const result = await runAnthropic({ messages, autopilot, pending, log, apiKey: anthropicKey });
      return Response.json(result);
    }

    return Response.json({
      error: "No AI API key found. Add GEMINI_API_KEY, deepseek_API_KEY, or ANTHROPIC_API_KEY to .env.local",
    }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
