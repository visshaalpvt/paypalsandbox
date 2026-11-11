import fs from "fs";
import path from "path";
import { getEnriched } from "../invoices.js";
import { planCash } from "../cashgap.js";
import { grossUpToNetINR } from "../rates.js";
import {
  enqueueItem,
  addAuditEntry,
  getSettings,
  getState,
} from "./store.js";

const BILLS_FILE = path.join(process.cwd(), "data", "bills.json");

export function loadSavedBills() {
  try {
    if (fs.existsSync(BILLS_FILE)) {
      const raw = fs.readFileSync(BILLS_FILE, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.warn("Failed to read bills.json:", err.message);
  }
  return [
    { id: "bill_1", label: "Studio Rent", amountINR: 50000, dayOfMonth: 20 },
    { id: "bill_2", label: "Software Subscriptions", amountINR: 12000, dayOfMonth: 1 },
  ];
}

export function saveBills(bills) {
  try {
    const dir = path.dirname(BILLS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BILLS_FILE, JSON.stringify(bills, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("Failed to save bills.json:", err.message);
    return false;
  }
}

export function computeNextOccurrences(recurringBills = [], horizonDays = 14) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const maxDate = new Date(today.getTime() + horizonDays * 864e5);

  const activeBills = [];

  for (const b of recurringBills) {
    const day = Math.min(31, Math.max(1, Number(b.dayOfMonth) || 1));
    const year = today.getFullYear();
    const month = today.getMonth();

    // Check this month
    let target = new Date(year, month, day);
    if (target < today) {
      // Move to next month
      target = new Date(year, month + 1, day);
    }

    if (target >= today && target <= maxDate) {
      activeBills.push({
        id: b.id,
        label: b.label || "Recurring Expense",
        amountINR: Number(b.amountINR) || 0,
        date: target.toISOString().slice(0, 10),
      });
    }
  }

  return activeBills.sort((a, b) => (a.date > b.date ? 1 : -1));
}

export async function runCashFlowAgent({ runId = `run_${Date.now()}` } = {}) {
  const settings = getSettings();
  if (!settings.enabled) {
    addAuditEntry({
      runId,
      agent: "cashflow",
      observation: "Kill switch is active.",
      decision: "blocked",
      reason: "Agent run was blocked by global kill switch.",
      policyResult: { allowed: false, rule: "P8" },
    });
    return { status: "blocked", reason: "Kill switch enabled" };
  }

  const recurringBills = loadSavedBills();
  const nextBills = computeNextOccurrences(recurringBills, 14);

  if (nextBills.length === 0) {
    addAuditEntry({
      runId,
      agent: "cashflow",
      observation: `Reviewed ${recurringBills.length} recurring bills. 0 occur in next 14 days.`,
      decision: "idle",
      reason: "No upcoming bills in the 14-day horizon.",
    });
    return { status: "completed", alert: false, reason: "No bills in 14-day window" };
  }

  // Run deterministic cash plan
  const { invoices = [], clients = [] } = await getEnriched();
  const plan = await planCash({
    bills: nextBills,
    openingBalanceINR: 0,
    invoices,
    clients,
  });

  const { firstGap, inflows = [] } = plan;

  if (!firstGap || firstGap.shortfallINR <= 0) {
    addAuditEntry({
      runId,
      agent: "cashflow",
      observation: `Evaluated ${nextBills.length} bills against expected PayPal receipts.`,
      decision: "covered",
      reason: `All upcoming expenses are fully covered by forecasted inflows.`,
      result: { checks: plan.checks },
    });
    return { status: "completed", alert: false, covered: true };
  }

  // Gap exists: raise alert and queue concrete fixes
  const shortfallFmt = `₹${Math.round(firstGap.shortfallINR).toLocaleString("en-IN")}`;
  addAuditEntry({
    runId,
    agent: "cashflow",
    observation: `CASH SHORTFALL ALERT: Projected gap of ${shortfallFmt} on ${firstGap.gapDate} for "${firstGap.billLabel}".`,
    decision: "alert_and_queue_fixes",
    reason: `Inflows arriving before ${firstGap.gapDate} fall short by ${shortfallFmt}.`,
    result: { firstGap },
  });

  // Action 1: Flag open invoices that would arrive after the gap date for early nudge
  const state = getState();
  const lateInflows = inflows.filter(
    (inf) => !inf.isOverdue && inf.expectedDate >= firstGap.gapDate
  );

  for (const late of lateInflows.slice(0, 2)) {
    // Avoid re-queuing duplicate reminder if already pending in queue
    const alreadyQueued = state.queue.some(
      (q) => q.invoiceId === late.invoiceId && q.status === "pending"
    );

    if (!alreadyQueued) {
      enqueueItem({
        agent: "cashflow",
        type: "remind",
        invoiceId: late.invoiceId,
        payload: {
          invoiceNumber: late.number,
          client: late.client,
          email: late.email,
          amount: late.grossAmount,
          currency: late.currency,
          dueDate: late.dueDate,
          tone: "friendly",
          flaggedForGap: true,
          subject: `Friendly check-in on Invoice #${late.number}`,
          message: `Hi ${late.client}, hope you're doing well! Just sending a friendly check-in regarding Invoice #${late.number} for ${late.grossAmount} ${late.currency}. Thank you!`,
        },
        reason: `Early nudge flagged by Cash-Flow Agent to cover ${shortfallFmt} shortfall on ${firstGap.gapDate}`,
      });
    }
  }

  // Action 2: Milestone draft invoice proposal (client fields left intentionally empty)
  // Must gross up so net INR >= shortfall after 4.4% PayPal fee + fixed + 18% GST + 4% FX spread
  const rateUSD = plan.rates?.rates?.USD || 87;
  const exactGrossUSD = grossUpToNetINR(firstGap.shortfallINR, "USD", rateUSD);
  const suggestedUSD = Math.ceil(exactGrossUSD / 25) * 25;

  const alreadyHasMilestone = state.queue.some(
    (q) => q.type === "draft_invoice" && q.status === "pending"
  );

  if (!alreadyHasMilestone) {
    enqueueItem({
      agent: "cashflow",
      type: "draft_invoice",
      invoiceId: null,
      payload: {
        suggestedUSD,
        clientName: "", // Intentionally blank for user to select client
        email: "",      // Intentionally blank
        currency: "USD",
        items: [{ name: "Project Milestone", amount: suggestedUSD }],
        dueDays: 5,
        targetBill: firstGap.billLabel,
        gapDate: firstGap.gapDate,
      },
      reason: `Milestone invoice draft of ~$${suggestedUSD} USD to bridge ${shortfallFmt} shortfall before ${firstGap.gapDate}`,
    });
  }

  return {
    status: "completed",
    alert: true,
    firstGap,
    shortfallINR: firstGap.shortfallINR,
  };
}

