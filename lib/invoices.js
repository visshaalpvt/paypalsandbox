import { listInvoicesRaw } from "./paypal";
import { toINR, netReceipt } from "./fees";
import * as store from "./store";

const OPEN = ["SENT", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING"];
const DAY = 864e5;
const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function normalize(inv) {
  const r = inv.primary_recipients?.[0]?.billing_info;
  const email = r?.email_address || "";
  const name = [r?.name?.given_name, r?.name?.surname].filter(Boolean).join(" ") || email || "Unknown";
  const due = inv.detail?.payment_term?.due_date || null;
  const amount = Number(inv.amount?.value || 0);
  const open = OPEN.includes(inv.status);
  const outstanding = open ? Number(inv.due_amount?.value ?? amount) : 0;
  let daysOverdue = 0;
  if (open && due) daysOverdue = Math.max(0, Math.floor((utcDay(new Date()) - utcDay(new Date(due))) / DAY));
  return {
    id: inv.id, number: inv.detail?.invoice_number, client: name, email,
    description: inv.items?.map((i) => i.name).join(", ") || "",
    currency: inv.detail?.currency_code || "USD", amount, outstanding, status: inv.status,
    dueDate: due, daysOverdue, open,
  };
}

// The collections ladder: guardrails the AI must follow
export function recommend(daysOverdue, open) {
  if (!open) return { stage: "none", action: "Nothing to do" };
  if (daysOverdue === 0) return { stage: "wait", action: "Not overdue. Do not chase yet." };
  if (daysOverdue <= 3) return { stage: "friendly", action: "Send a friendly nudge (assume it slipped their mind)." };
  if (daysOverdue <= 14) return { stage: "firm", action: "Send a firm reminder with a clear pay-by date." };
  if (daysOverdue <= 30) return { stage: "final", action: "Send a final notice. Pause new work. Late-fee invoice only if your contract says so." };
  return { stage: "stop-chasing", action: "Stop sending reminders. Pause all work, send one formal demand, then consider a collections service or small-claims process." };
}

export function clientInsights(invoices, history) {
  const by = {};
  for (const i of invoices.filter((x) => x.status !== "DRAFT" && x.status !== "CANCELLED")) {
    const c = (by[i.email || i.client] ||= { email: i.email, name: i.client, invoices: 0, outstanding: {}, overdueCount: 0, maxDaysOverdue: 0 });
    c.invoices++;
    if (i.open) c.outstanding[i.currency] = (c.outstanding[i.currency] || 0) + i.outstanding;
    if (i.daysOverdue > 0) { c.overdueCount++; c.maxDaysOverdue = Math.max(c.maxDaysOverdue, i.daysOverdue); }
  }
  return Object.values(by).map((c) => {
    const past = history[c.email] || [];
    const avgDaysLate = past.length ? Math.round(past.reduce((a, b) => a + b, 0) / past.length) : null;
    const score = Math.round(Math.max(0, Math.min(100, 100 - Math.min((avgDaysLate || 0) * 3, 45) - c.overdueCount * 15 - Math.min(c.maxDaysOverdue, 60) * 0.5)));
    return { ...c, paidInvoicesObserved: past.length, avgDaysLate, reliability: score, ...recommend(c.maxDaysOverdue, Object.keys(c.outstanding).length > 0) };
  }).sort((a, b) => a.reliability - b.reliability);
}

export async function getEnriched() {
  const raw = await listInvoicesRaw();
  const invoices = (raw.items || []).map(normalize);
  // learn payment behaviour: first time we see an invoice as PAID, record how late it was
  store.update((d) => {
    for (const i of invoices) {
      if (i.status === "PAID" && !d.seenPaid[i.id]) {
        d.seenPaid[i.id] = true;
        const late = i.dueDate ? Math.max(0, Math.floor((utcDay(new Date()) - utcDay(new Date(i.dueDate))) / DAY)) : 0;
        (d.history[i.email] ||= []).push(late);
        d.events.unshift({ type: "paid", summary: `Invoice ${i.number} paid by ${i.client}`, ref: i.id, at: new Date().toISOString() });
      }
    }
  });
  const s = store.read();
  const clients = clientInsights(invoices, s.history);
  const openInv = invoices.filter((i) => i.open);
  const sum = (arr) => Math.round(arr.reduce((a, i) => a + toINR(i.outstanding, i.currency), 0));
  const kpis = {
    outstandingINR: sum(openInv),
    overdueINR: sum(openInv.filter((i) => i.daysOverdue > 0)),
    collectedINR: Math.round(invoices.filter((i) => i.status === "PAID").reduce((a, i) => a + toINR(i.amount, i.currency), 0)),
    feeLeakINR: Math.round(openInv.reduce((a, i) => a + netReceipt(i.outstanding, i.currency).lostINR, 0)),
    openCount: openInv.length, overdueCount: openInv.filter((i) => i.daysOverdue > 0).length,
  };
  return { invoices, clients, kpis, events: s.events.slice(0, 12) };
}
