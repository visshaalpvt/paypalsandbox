import { createAndSendInvoice, getInvoice, remindInvoice } from "./paypal";
import { getEnriched } from "./invoices";
import { netReceipt, grossUp } from "./fees";
import { planCash } from "./cashgap";
import * as store from "./store";

export const GATED = new Set(["create_invoice", "send_reminder", "issue_late_fee_invoice"]);

export const TOOLS = [
  {
    name: "calc_net_receipt",
    description: "Estimate what an Indian freelancer actually receives in INR after PayPal fee (4.4%+fixed), 18% GST on fees and currency-conversion spread.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR", "GBP"] }
      },
      required: ["amount"]
    }
  },
  {
    name: "create_invoice",
    description: "Create AND send a real PayPal invoice. If the user wants to keep the full amount after PayPal fees, set grossUpFees=true (adds a transparent processing-fee line). Needs the client's email. backdateDays is for demos only.",
    input_schema: {
      type: "object",
      properties: {
        clientName: { type: "string" },
        email: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, amount: { type: "number" } },
            required: ["name", "amount"]
          }
        },
        currency: { type: "string", enum: ["USD", "EUR", "GBP"] },
        dueDays: { type: "number" },
        grossUpFees: { type: "boolean" },
        backdateDays: { type: "number" }
      },
      required: ["clientName", "email", "items"]
    }
  },
  {
    name: "list_invoices",
    description: "List the user's PayPal invoices with status, due date and days overdue. Optionally filter by client name/email substring or only overdue.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string" },
        onlyOverdue: { type: "boolean" }
      }
    }
  },
  {
    name: "get_client_insights",
    description: "Per-client reliability score, average days late, outstanding amounts and the RECOMMENDED next collections step (wait / friendly / firm / final / stop-chasing). Always call before drafting a reminder.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string" }
      }
    }
  },
  {
    name: "plan_cash",
    description: "Forecast cash-flow shortfalls (Cash-Gap Shield) for upcoming bills based on real invoice arrival estimates and reliability scores. Returns gap details and recommended actions.",
    input_schema: {
      type: "object",
      properties: {
        bills: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              amountINR: { type: "number" },
              date: { type: "string", description: "Date in YYYY-MM-DD" }
            },
            required: ["amountINR", "date"]
          }
        },
        openingBalanceINR: { type: "number", description: "Current bank balance in INR" }
      },
      required: ["bills"]
    }
  },
  {
    name: "send_reminder",
    description: "Send a payment reminder through PayPal for an invoice. You write the subject and message. tone must match the recommended stage.",
    input_schema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" },
        tone: { type: "string", enum: ["friendly", "firm", "final"] },
        subject: { type: "string" },
        message: { type: "string" }
      },
      required: ["invoiceId", "tone", "subject", "message"]
    }
  },
  {
    name: "issue_late_fee_invoice",
    description: "Create and send a separate late-fee invoice for an overdue invoice. Only use if the user confirms their contract allows late fees.",
    input_schema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" },
        feePercent: { type: "number" }
      },
      required: ["invoiceId"]
    }
  },
  {
    name: "record_evidence",
    description: "Save proof for an invoice (delivery of work, client approval, important messages). Used later to fight disputes.",
    input_schema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" },
        kind: { type: "string", enum: ["delivery", "approval", "message", "other"] },
        text: { type: "string" }
      },
      required: ["invoiceId", "kind", "text"]
    }
  },
  {
    name: "get_dispute_packet",
    description: "Collect the invoice, saved evidence, reminders sent and payment events so you can draft a dispute/chargeback response for PayPal.",
    input_schema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" }
      },
      required: ["invoiceId"]
    }
  },
];

export function summarize(name, i) {
  if (name === "create_invoice") {
    const total = (i.items || []).reduce((a, x) => a + Number(x.amount), 0);
    return `Create & send invoice to ${i.clientName} <${i.email}> for ${total} ${i.currency || "USD"}, due in ${i.dueDays ?? 7} days${i.grossUpFees ? " (fees passed through)" : ""}`;
  }
  if (name === "send_reminder") {
    const todayCount = store.getRemindersToday(i.invoiceId);
    return `Send ${i.tone || "friendly"} reminder on invoice ${i.invoiceId} (${todayCount + 1} of 2 today)`;
  }
  if (name === "issue_late_fee_invoice") return `Issue ${i.feePercent ?? 2}% late-fee invoice for ${i.invoiceId}`;
  return name;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const handlers = {
  async calc_net_receipt({ amount, currency = "USD" }) {
    if (amount <= 0 || isNaN(Number(amount))) throw new Error("Amount must be greater than 0");
    return netReceipt(amount, currency);
  },

  async create_invoice(i) {
    if (!i.clientName || !i.clientName.trim()) {
      throw new Error("Client name cannot be blank");
    }
    const cleanEmail = (i.email || "").trim();
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      throw new Error(`Invalid email address: "${i.email}". Please provide a valid email address.`);
    }
    if (!Array.isArray(i.items) || i.items.length === 0) {
      throw new Error("Invoice must include at least one item");
    }
    for (const item of i.items) {
      const amt = Number(item.amount);
      if (isNaN(amt) || amt <= 0) {
        throw new Error(`Item amount must be greater than 0. Invalid value for item "${item.name}": ${item.amount}`);
      }
    }
    const dueDays = i.dueDays !== undefined ? Number(i.dueDays) : 7;
    if (isNaN(dueDays) || dueDays < 1 || dueDays > 90) {
      throw new Error(`Due days must be between 1 and 90 days. Received: ${i.dueDays}`);
    }

    const currency = i.currency || "USD";
    let items = i.items.map((x) => ({ name: x.name, amount: Number(x.amount) }));
    let feeLine = null;
    if (i.grossUpFees) {
      const target = items.reduce((a, x) => a + x.amount, 0);
      const extra = +(grossUp(target, currency) - target).toFixed(2);
      feeLine = { name: "Payment processing fee (pass-through)", amount: extra };
      items = [...items, feeLine];
    }
    const out = await createAndSendInvoice({
      clientName: i.clientName.trim(),
      email: cleanEmail,
      items,
      currency,
      dueDays,
      backdateDays: i.backdateDays ?? 0
    });
    store.addEvent("invoice", `Invoice ${out.invoice_number} sent to ${i.clientName.trim()}`, out.id);
    return { ...out, total: items.reduce((a, x) => a + x.amount, 0), currency, processingFeeLine: feeLine };
  },

  async list_invoices({ client, onlyOverdue }) {
    let { invoices } = await getEnriched();
    if (client) invoices = invoices.filter((x) => `${x.client} ${x.email}`.toLowerCase().includes(client.toLowerCase()));
    if (onlyOverdue) invoices = invoices.filter((x) => x.daysOverdue > 0);
    return invoices.slice(0, 30);
  },

  async get_client_insights({ client }) {
    let { clients } = await getEnriched();
    if (client) clients = clients.filter((x) => `${x.name} ${x.email}`.toLowerCase().includes(client.toLowerCase()));
    return clients;
  },

  async plan_cash({ bills, openingBalanceINR = 0 }) {
    const { invoices, clients } = await getEnriched();
    return planCash({ bills, openingBalanceINR, invoices, clients });
  },

  async send_reminder({ invoiceId, tone = "friendly", subject, message, note }) {
    const todayCount = store.getRemindersToday(invoiceId);
    if (todayCount >= 2) {
      throw new Error(`PayPal daily limit reached: 2 reminders have already been sent today for invoice ${invoiceId}.`);
    }
    const finalSubject = subject || "Friendly payment reminder";
    const finalNote = message || note || "Just a quick reminder about your open invoice. Thank you!";
    await remindInvoice(invoiceId, finalSubject, finalNote);
    store.addReminder(invoiceId, tone, finalSubject, finalNote);
    store.addEvent("reminder", `${tone} reminder sent on ${invoiceId} (${todayCount + 1} of 2 today)`, invoiceId);
    return { sent: true, tone, subject: finalSubject, reminderNumberToday: todayCount + 1 };
  },

  async issue_late_fee_invoice({ invoiceId, feePercent = 2 }) {
    const orig = await getInvoice(invoiceId);
    const r = orig.primary_recipients?.[0]?.billing_info;
    const cur = orig.detail.currency_code;
    const fee = +(Number(orig.amount.value) * (feePercent / 100)).toFixed(2);
    const out = await createAndSendInvoice({
      clientName: [r?.name?.given_name, r?.name?.surname].filter(Boolean).join(" ") || "Client",
      email: r.email_address,
      items: [{ name: `Late fee (${feePercent}%) for invoice ${orig.detail.invoice_number}`, amount: fee }],
      currency: cur,
      dueDays: 7,
    });
    store.addEvent("late-fee", `Late-fee invoice ${out.invoice_number} issued`, out.id);
    return { ...out, fee, currency: cur };
  },

  async record_evidence({ invoiceId, kind, text }) {
    store.addEvidence(invoiceId, kind, text);
    return { saved: true };
  },

  async get_dispute_packet({ invoiceId }) {
    const inv = await getInvoice(invoiceId);
    const s = store.read();
    return {
      invoice: {
        id: inv.id,
        number: inv.detail?.invoice_number,
        status: inv.status,
        date: inv.detail?.invoice_date,
        due: inv.detail?.payment_term?.due_date,
        amount: inv.amount,
        items: inv.items?.map((x) => x.name),
        client: inv.primary_recipients?.[0]?.billing_info
      },
      evidence: s.evidence[invoiceId] || [],
      remindersSent: s.reminders[invoiceId] || [],
      events: s.events.filter((e) => e.ref === invoiceId),
      instruction: "Draft a factual, chronological dispute response from this data only. List what evidence is missing and tell the user to add it.",
    };
  },
};

export async function runTool(name, input, { autopilot = false, pending = [], force = false } = {}) {
  if (!handlers[name]) throw new Error(`Unknown tool ${name}`);
  if (GATED.has(name) && !autopilot && !force) {
    pending.push({
      id: Math.random().toString(36).slice(2),
      tool: name,
      input,
      summary: summarize(name, input),
      preview: name === "send_reminder" ? `${input.subject}\n\n${input.message}` : undefined,
    });
    return { status: "PENDING_USER_APPROVAL", note: "Queued for the user to approve in the UI. Do not claim it was sent." };
  }
  return handlers[name](input);
}
