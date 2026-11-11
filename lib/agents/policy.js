// Deterministic Policy Engine for InvoicePilot Autonomous Agents
// Pure functions, no model calls, fully unit-testable.

const URL_REGEX = /(https?:\/\/|www\.|\b\w+\.(com|org|net|io|co|in|app)\b)/i;
const THREAT_REGEX = /\b(legal|court|lawyer|attorney|sue|suing|lawsuit|police|jail|criminal|bailiff|collection agency|arrest)\b/i;

export function evaluateToneGuide(daysOverdue, reliability = 75, flaggedForGap = false) {
  if (daysOverdue <= 0 || flaggedForGap) {
    return ["friendly"];
  }
  // High reliability clients (>= 80) never get a tone above friendly before 8 days overdue
  if (reliability >= 80 && daysOverdue < 8) {
    return ["friendly"];
  }
  if (daysOverdue >= 1 && daysOverdue <= 7) {
    return ["friendly"];
  }
  if (daysOverdue >= 8 && daysOverdue <= 21) {
    return ["firm"];
  }
  // 22 or more days
  return ["final"];
}

export function checkPolicy(action, context = {}) {
  const {
    invoice,
    client,
    recentReminders = [], // timestamps (ISO strings or ms) of recent successful/approved reminders for this invoice
    actionsThisRun = 0,
    maxActions = Number(process.env.AGENT_MAX_ACTIONS || 5),
    agentEnabled = process.env.AGENT_ENABLED !== "false",
    killSwitch = false,
    now = Date.now(),
  } = context;

  // P8: Global kill switch
  if (!agentEnabled || killSwitch) {
    return {
      allowed: false,
      rule: "P8",
      reason: "Agent execution is disabled by the global kill switch (AGENT_ENABLED=false).",
    };
  }

  // P1: Only remind and skip actions are valid
  if (!action || !["remind", "skip"].includes(action.type)) {
    return {
      allowed: false,
      rule: "P1",
      reason: `Action type "${action?.type}" is invalid. Only "remind" and "skip" are permitted.`,
    };
  }

  // Skip actions are always allowed through to be logged
  if (action.type === "skip") {
    return {
      allowed: true,
      rule: "P1",
      reason: action.reason || "Skipped by agent recommendation.",
    };
  }

  // P6: Max actions per run
  if (actionsThisRun >= maxActions) {
    return {
      allowed: false,
      rule: "P6",
      reason: `Run action limit reached (${actionsThisRun}/${maxActions}). Configurable via AGENT_MAX_ACTIONS.`,
    };
  }

  // P2: Invoice must exist, be open, status SENT or PARTIALLY_PAID
  if (!invoice) {
    return {
      allowed: false,
      rule: "P2",
      reason: `Invoice "${action.invoiceId}" does not exist in active records.`,
    };
  }
  const allowedStatuses = ["SENT", "PARTIALLY_PAID"];
  if (!invoice.open || !allowedStatuses.includes(invoice.status)) {
    return {
      allowed: false,
      rule: "P2",
      reason: `Invoice ${invoice.number || invoice.id} status is "${invoice.status}" (open=${Boolean(invoice.open)}). Reminders are only allowed on SENT or PARTIALLY_PAID invoices. Never remind PAID, CANCELLED or DRAFT.`,
    };
  }

  // P4: No reminder before the due date, unless flagged by Cash-Flow Agent
  const isOverdue = (invoice.daysOverdue || 0) > 0;
  const isFlagged = Boolean(action.flaggedForGap);
  if (!isOverdue && !isFlagged) {
    return {
      allowed: false,
      rule: "P4",
      reason: `Invoice ${invoice.number || invoice.id} is not yet overdue (${invoice.dueDate || "no due date"}). Reminders before due date are only permitted if flagged by the Cash-Flow Agent for an upcoming shortfall.`,
    };
  }

  // Reminder frequency checks based on recent reminders
  const ms24h = 24 * 60 * 60 * 1000;
  const ms12h = 12 * 60 * 60 * 1000;
  const reminderTimes = recentReminders
    .map((r) => (typeof r === "number" ? r : new Date(r).getTime()))
    .filter((t) => !isNaN(t) && t <= now)
    .sort((a, b) => b - a); // newest first

  // P3: Max 2 reminders per invoice per rolling 24 hours
  const inLast24h = reminderTimes.filter((t) => now - t < ms24h);
  if (inLast24h.length >= 2) {
    return {
      allowed: false,
      rule: "P3",
      reason: `Invoice ${invoice.number || invoice.id} has already received ${inLast24h.length} reminders in the last 24 hours (maximum allowed is 2).`,
    };
  }

  // P5: Minimum 12 hours between reminders to the same invoice
  if (reminderTimes.length > 0) {
    const lastReminderTime = reminderTimes[0];
    const diffHours = (now - lastReminderTime) / (60 * 60 * 1000);
    if (diffHours < 12) {
      return {
        allowed: false,
        rule: "P5",
        reason: `Only ${diffHours.toFixed(1)} hours have elapsed since the last reminder for invoice ${invoice.number || invoice.id}. Minimum interval is 12 hours.`,
      };
    }
  }

  // Tone Validation Guide
  const reliability = client?.reliability ?? 75;
  const allowedTones = evaluateToneGuide(invoice.daysOverdue || 0, reliability, isFlagged);
  if (action.tone && !allowedTones.includes(action.tone)) {
    return {
      allowed: false,
      rule: "P7",
      reason: `Proposed tone "${action.tone}" violates tone policy for overdue ${invoice.daysOverdue}d (client reliability ${reliability}/100). Allowed tone: ${allowedTones.join(", ")}.`,
    };
  }

  // P7: Message length, forbidden content, facts check
  const msg = (action.message || "").trim();
  if (msg.length < 1 || msg.length > 600) {
    return {
      allowed: false,
      rule: "P7",
      reason: `Message length (${msg.length} characters) is out of bounds. Must be between 1 and 600 characters.`,
    };
  }

  if (URL_REGEX.test(msg)) {
    return {
      allowed: false,
      rule: "P7",
      reason: "Message contains a URL, which is forbidden in automated reminders to prevent phishing flags.",
    };
  }

  if (THREAT_REGEX.test(msg)) {
    return {
      allowed: false,
      rule: "P7",
      reason: "Message contains hostile or legal threat language, which violates freelancer professional guidelines.",
    };
  }

  // Fact check: If an invoice number is referenced in message, ensure it does not contradict
  if (invoice.number && msg.includes("#") && !msg.includes(invoice.number)) {
    return {
      allowed: false,
      rule: "P7",
      reason: `Message contains an invoice reference that does not match expected invoice #${invoice.number}.`,
    };
  }

  return {
    allowed: true,
    rule: "ALL_PASSED",
    reason: "Action complies with all P1–P9 policy guardrails.",
  };
}

