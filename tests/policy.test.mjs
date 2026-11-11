import { checkPolicy, evaluateToneGuide } from "../lib/agents/policy.js";
import { grossUpToNetINR, netINR } from "../lib/rates.js";

console.log("=== Running Policy Engine & Cash-Gap Unit Tests ===");

let passed = 0;
let failed = 0;

function assert(name, condition, details = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}. ${details}`);
  }
}

const mockInvoice = {
  id: "INV-100",
  number: "0100",
  client: "Acme",
  status: "SENT",
  open: true,
  amount: 500,
  currency: "USD",
  dueDate: "2026-11-01",
  daysOverdue: 10,
};

const validAction = {
  type: "remind",
  invoiceId: "INV-100",
  tone: "firm",
  subject: "Reminder for Invoice #0100",
  message: "Hi Acme, just a quick reminder about invoice #0100 for $500, due on 2026-11-01. Thank you!",
};

// P8: Kill switch
const rP8_kill = checkPolicy(validAction, { invoice: mockInvoice, killSwitch: true });
assert("P8 blocks when kill switch active", !rP8_kill.allowed && rP8_kill.rule === "P8");

// P1: Invalid action type
const rP1_invalid = checkPolicy({ type: "delete" }, { invoice: mockInvoice });
assert("P1 blocks invalid action type", !rP1_invalid.allowed && rP1_invalid.rule === "P1");

const rP1_skip = checkPolicy({ type: "skip", reason: "All good" }, { invoice: mockInvoice });
assert("P1 allows skip action", rP1_skip.allowed && rP1_skip.rule === "P1");

// P2: Invoice exists & open
const rP2_noInv = checkPolicy(validAction, { invoice: null });
assert("P2 blocks missing invoice", !rP2_noInv.allowed && rP2_noInv.rule === "P2");

const rP2_paid = checkPolicy(validAction, { invoice: { ...mockInvoice, status: "PAID", open: false } });
assert("P2 blocks PAID invoice", !rP2_paid.allowed && rP2_paid.rule === "P2");

// P4: No reminder before due date unless flagged
const rP4_notDue = checkPolicy(validAction, { invoice: { ...mockInvoice, daysOverdue: 0 } });
assert("P4 blocks reminder before due date", !rP4_notDue.allowed && rP4_notDue.rule === "P4");

const rP4_flagged = checkPolicy({ ...validAction, tone: "friendly", flaggedForGap: true }, { invoice: { ...mockInvoice, daysOverdue: 0 } });
assert("P4 allows reminder before due date if flagged for shortfall", rP4_flagged.allowed);

// P3: Max 2 reminders per 24h
const now = Date.now();
const hourAgo = now - 60 * 60 * 1000;
const twoHoursAgo = now - 2 * 60 * 60 * 1000;
const rP3_limit = checkPolicy(validAction, {
  invoice: mockInvoice,
  recentReminders: [hourAgo, twoHoursAgo],
  now,
});
assert("P3 blocks 3rd reminder in 24h", !rP3_limit.allowed && rP3_limit.rule === "P3");

// P5: Minimum 12 hours between reminders
const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
const rP5_interval = checkPolicy(validAction, {
  invoice: mockInvoice,
  recentReminders: [fiveHoursAgo],
  now,
});
assert("P5 blocks if less than 12h elapsed", !rP5_interval.allowed && rP5_interval.rule === "P5");

const fourteenHoursAgo = now - 14 * 60 * 60 * 1000;
const rP5_ok = checkPolicy(validAction, {
  invoice: mockInvoice,
  recentReminders: [fourteenHoursAgo],
  now,
});
assert("P5 allows when >= 12h elapsed", rP5_ok.allowed);

// P6: Max actions per run
const rP6_max = checkPolicy(validAction, { invoice: mockInvoice, actionsThisRun: 5, maxActions: 5 });
assert("P6 blocks when run action limit reached", !rP6_max.allowed && rP6_max.rule === "P6");

// P7: Tone, length, URLs, threats
const rP7_url = checkPolicy({ ...validAction, message: "Pay here: https://payme.xyz" }, { invoice: mockInvoice });
assert("P7 blocks messages with URLs", !rP7_url.allowed && rP7_url.rule === "P7");

const rP7_threat = checkPolicy({ ...validAction, message: "Pay now or our lawyer will take you to court." }, { invoice: mockInvoice });
assert("P7 blocks messages with threats/legal language", !rP7_threat.allowed && rP7_threat.rule === "P7");

const rP7_toneHighRel = checkPolicy({ ...validAction, tone: "firm" }, {
  invoice: { ...mockInvoice, daysOverdue: 3 },
  client: { reliability: 90 },
});
assert("P7 blocks firm tone for high reliability client under 8d overdue", !rP7_toneHighRel.allowed && rP7_toneHighRel.rule === "P7");

// Valid action complies
const rValid = checkPolicy(validAction, { invoice: mockInvoice });
assert("Valid action passes all checks", rValid.allowed && rValid.rule === "ALL_PASSED");

// Cash-Gap Shield: grossUpToNetINR guarantees net INR >= shortfall
console.log("\n=== Testing Cash-Gap Shield (grossUpToNetINR) ===");
const shortfallTestCases = [29092, 144445, 200000];
for (const shortfall of shortfallTestCases) {
  // Test across both fallback rate 87 and live rate 93.96
  for (const rate of [87, 93.96]) {
    const grossUSD = grossUpToNetINR(shortfall, "USD", rate);
    const roundedUSD = Math.ceil(grossUSD / 25) * 25;
    const net = netINR(roundedUSD, "USD", 0.04, rate);
    assert(
      `Shortfall ₹${shortfall.toLocaleString()} at rate ${rate} -> $${roundedUSD} yields ₹${net.netINR.toLocaleString()} (diff: +₹${net.netINR - shortfall})`,
      net.netINR >= shortfall,
      `Net ₹${net.netINR} fell short of ₹${shortfall}`
    );
  }
}

console.log(`\nTest Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

