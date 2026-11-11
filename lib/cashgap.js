import { netINR, getLiveRates } from "./rates.js";

const DAY_MS = 864e5;
const toDateStr = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY_MS);

export function forecastInflows(invoices = [], clients = [], liveRates = null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const clientMap = new Map();
  for (const c of clients) {
    if (c.email) clientMap.set(c.email.toLowerCase(), c);
    if (c.name) clientMap.set(c.name.toLowerCase(), c);
  }

  const openInvoices = invoices.filter((inv) => inv.open && inv.outstanding > 0);

  return openInvoices.map((inv) => {
    const client =
      (inv.email && clientMap.get(inv.email.toLowerCase())) ||
      (inv.client && clientMap.get(inv.client.toLowerCase())) ||
      null;

    const reliability = client?.reliability ?? 75; // 0-100 score
    const avgDaysLate = client?.avgDaysLate ?? 0;
    const isOverdue = inv.daysOverdue > 0;

    // Forecast arrival date
    let expectedArrival;
    if (isOverdue) {
      // Overdue invoices: estimate catchup in 2-7 days depending on history
      const catchupDays = Math.max(2, Math.min(7, Math.round((avgDaysLate || 4) * 0.5)));
      expectedArrival = addDays(today, catchupDays);
    } else if (inv.dueDate) {
      const baseDue = new Date(inv.dueDate);
      expectedArrival = addDays(baseDue, Math.max(0, avgDaysLate));
    } else {
      expectedArrival = addDays(today, 7);
    }

    // Convert to net INR
    const netDetails = netINR(inv.outstanding, inv.currency, 0.04, liveRates?.USD);
    const weightedNetINR = Math.round(netDetails.netINR * (reliability / 100));

    return {
      invoiceId: inv.id,
      number: inv.number || inv.id,
      client: inv.client || "Client",
      email: inv.email || "",
      currency: inv.currency,
      grossAmount: inv.outstanding,
      dueDate: inv.dueDate,
      expectedDate: toDateStr(expectedArrival),
      netINR: netDetails.netINR,
      weightedINR: weightedNetINR,
      reliability,
      avgDaysLate,
      daysOverdue: inv.daysOverdue || 0,
      isOverdue,
      assumptions: netDetails.assumptions,
    };
  }).sort((a, b) => (a.expectedDate > b.expectedDate ? 1 : -1));
}

export function cashGap(bills = [], inflows = [], openingBalanceINR = 0) {
  const sortedBills = [...bills]
    .filter((b) => b && b.amountINR > 0 && b.date)
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  let runningBalance = Number(openingBalanceINR) || 0;
  let firstGap = null;
  const checks = [];

  for (const bill of sortedBills) {
    const billDate = toDateStr(bill.date);
    const billAmount = Math.round(Number(bill.amountINR));

    // Cumulative inflows expected on or before billDate
    const eligibleInflows = inflows.filter((inf) => inf.expectedDate <= billDate);
    const totalExpectedInflowINR = eligibleInflows.reduce((sum, inf) => sum + inf.netINR, 0);
    const totalWeightedInflowINR = eligibleInflows.reduce((sum, inf) => sum + inf.weightedINR, 0);

    const projectedBalance = (Number(openingBalanceINR) || 0) + totalExpectedInflowINR - billAmount;
    const conservativeBalance = (Number(openingBalanceINR) || 0) + totalWeightedInflowINR - billAmount;

    const isCovered = projectedBalance >= 0;
    const shortfallINR = isCovered ? 0 : Math.abs(projectedBalance);

    const check = {
      label: bill.label || "Upcoming Bill",
      amountINR: billAmount,
      date: billDate,
      covered: isCovered,
      projectedBalance,
      conservativeBalance,
      shortfallINR,
      inflowsAvailableINR: totalExpectedInflowINR,
    };

    checks.push(check);

    if (!isCovered && !firstGap) {
      firstGap = {
        billLabel: check.label,
        gapDate: billDate,
        billAmountINR: billAmount,
        shortfallINR,
        projectedBalance,
      };
    }
  }

  return { checks, firstGap };
}

export function bestFixes(firstGap, inflows = []) {
  if (!firstGap || firstGap.shortfallINR <= 0) return [];

  const fixes = [];
  const shortfall = firstGap.shortfallINR;

  // 1. Chase overdue clients today (Real action)
  const overdueInflows = inflows.filter((inf) => inf.isOverdue);
  for (const inf of overdueInflows) {
    if (fixes.length >= 2) break;
    fixes.push({
      type: "chase_overdue",
      title: `Chase overdue invoice #${inf.number} (${inf.client})`,
      action: `Send payment reminder for ${inf.grossAmount} ${inf.currency} (${inf.daysOverdue} days overdue).`,
      impactINR: inf.netINR,
      impactLabel: `₹${inf.netINR.toLocaleString("en-IN")} when collected`,
      coversPercent: Math.min(100, Math.round((inf.netINR / shortfall) * 100)),
      invoiceId: inf.invoiceId,
    });
  }

  // 2. Group all upcoming invoices into ONE consolidated suggestion
  const upcomingInflows = inflows.filter(
    (inf) => !inf.isOverdue && inf.expectedDate >= firstGap.gapDate
  );
  if (upcomingInflows.length > 0) {
    const totalUpcomingNet = upcomingInflows.reduce((sum, inf) => sum + inf.netINR, 0);
    const invoiceList = upcomingInflows.map((inf) => `#${inf.number}`).join(", ");
    const firstInvoiceId = upcomingInflows[0].invoiceId;
    fixes.push({
      type: "nudge_upcoming",
      title: `Send early friendly nudge (${invoiceList})`,
      action: `Prompt clients on upcoming open invoices (${invoiceList}) to encourage early settlement before your ${firstGap.billLabel} on ${firstGap.gapDate}.`,
      impactINR: totalUpcomingNet,
      impactLabel: `up to ₹${totalUpcomingNet.toLocaleString("en-IN")}, if clients pay early`,
      coversPercent: Math.min(100, Math.round((totalUpcomingNet / shortfall) * 100)),
      invoiceId: firstInvoiceId,
      invoiceIds: upcomingInflows.map((inf) => inf.invoiceId),
    });
  }

  // 3. New bill / milestone
  if (fixes.length < 3) {
    const usdNeeded = Math.ceil(shortfall / 87 / 25) * 25;
    fixes.push({
      type: "bill_milestone",
      title: `Issue new milestone invoice for ~$${usdNeeded}`,
      action: `Bill an upcoming milestone of ~$${usdNeeded} USD today with a 3–5 day due date to bridge the shortfall before ${firstGap.gapDate}.`,
      impactINR: shortfall,
      impactLabel: `₹${shortfall.toLocaleString("en-IN")} on payment`,
      coversPercent: 100,
    });
  }

  return fixes.slice(0, 3);
}

export async function planCash({ bills = [], openingBalanceINR = 0, invoices = [], clients = [] }) {
  const rateData = await getLiveRates();
  const liveRates = rateData.rates;

  const inflows = forecastInflows(invoices, clients, liveRates);
  const { checks, firstGap } = cashGap(bills, inflows, openingBalanceINR);
  const fixes = bestFixes(firstGap, inflows);

  return {
    inflows,
    checks,
    firstGap,
    fixes,
    openingBalanceINR: Number(openingBalanceINR) || 0,
    rates: rateData,
    assumptions: `USD rate: ₹${rateData.rates.USD} (${rateData.isLive ? "Live API" : "Fallback"}). 4.4% PayPal fee + 18% GST + 4% FX spread.`,
  };
}
