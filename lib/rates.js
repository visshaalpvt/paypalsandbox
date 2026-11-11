// Currency exchange rates and fee calculations for PayPal cross-border receiving into India
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);

export const DEFAULT_FALLBACK_RATES = {
  USD: num(process.env.FX_USD_INR, 87),
  EUR: num(process.env.FX_EUR_INR, 95),
  GBP: num(process.env.FX_GBP_INR, 112),
  INR: 1,
};

const FIXED = { USD: 0.3, EUR: 0.35, GBP: 0.3, INR: 20 };
const PCT = 0.044; // 4.4% PayPal merchant cross-border fee
const GST = 0.18;  // 18% GST on processing fees
const DEFAULT_SPREAD = 0.04; // 4% currency conversion spread

const r2 = (n) => Math.round(n * 100) / 100;

let fxCache = {
  rates: { ...DEFAULT_FALLBACK_RATES },
  asOf: null,
  isLive: false,
  expiresAt: 0,
};

export async function getLiveRates() {
  const now = Date.now();
  if (fxCache.asOf && now < fxCache.expiresAt) {
    return { ...fxCache };
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
      headers: { "User-Agent": "InvoicePilot/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const inrPerUsd = Number(data.rates?.INR);
    const inrPerEur = inrPerUsd / Number(data.rates?.EUR || 1.08);
    const inrPerGbp = inrPerUsd / Number(data.rates?.GBP || 0.79);

    if (inrPerUsd > 0) {
      fxCache = {
        rates: {
          USD: r2(inrPerUsd),
          EUR: r2(inrPerEur),
          GBP: r2(inrPerGbp),
          INR: 1,
        },
        asOf: new Date().toISOString(),
        isLive: true,
        expiresAt: now + 60 * 60 * 1000, // 1 hour cache
      };
      return { ...fxCache };
    }
  } catch (err) {
    console.warn("Live FX fetch failed, using fallback:", err.message);
  }

  // Fallback
  fxCache = {
    rates: { ...DEFAULT_FALLBACK_RATES },
    asOf: fxCache.asOf || new Date().toISOString(),
    isLive: false,
    expiresAt: now + 5 * 60 * 1000, // retry in 5 mins on failure
  };
  return { ...fxCache };
}

// Exactly matches dashboard's fee calculation
export function netINR(amount, currency = "USD", spread = DEFAULT_SPREAD, liveRate = null) {
  const a = Number(amount);
  const fixed = FIXED[currency] ?? 0.3;
  const rate = liveRate || fxCache.rates[currency] || DEFAULT_FALLBACK_RATES[currency] || 1;

  const fee = a * PCT + fixed;
  const gst = fee * GST;
  const afterFees = a - fee - gst;
  const spreadLoss = afterFees * spread;
  const netCcy = afterFees - spreadLoss;
  const netInr = netCcy * rate;
  const midInr = a * rate;

  return {
    gross: r2(a),
    currency,
    rate: r2(rate),
    paypalFee: r2(fee),
    gstOnFee: r2(gst),
    conversionSpreadLoss: r2(spreadLoss),
    netInCurrency: r2(netCcy),
    netINR: Math.round(netInr),
    midMarketINR: Math.round(midInr),
    lostINR: Math.round(midInr - netInr),
    lostPercent: r2(((midInr - netInr) / midInr) * 100),
    assumptions: `4.4% PayPal + ${fixed} ${currency} fixed fee + 18% GST + ${spread * 100}% FX spread @ ₹${r2(rate)}/${currency}`,
  };
}

export function grossUpUSD(target, currency = "USD") {
  const fixed = FIXED[currency] ?? 0.3;
  return r2((Number(target) + fixed * (1 + GST)) / (1 - PCT * (1 + GST)));
}

export function compareRails(amount, currency = "USD", liveRate = null) {
  const a = Number(amount);
  const rate = liveRate || fxCache.rates[currency] || DEFAULT_FALLBACK_RATES[currency] || 87;
  const midInr = a * rate;

  const pp = netINR(a, currency, DEFAULT_SPREAD, rate);

  // International wire / Wise business benchmark (~1% total friction)
  const wiseFee = a * 0.007 + 3;
  const wiseNetINR = (a - wiseFee) * rate;

  return {
    gross: a,
    currency,
    midMarketINR: Math.round(midInr),
    paypal: {
      netINR: pp.netINR,
      lostINR: pp.lostINR,
      effectiveRate: r2(pp.netINR / a),
      feeBreakdown: pp,
    },
    wireOrWise: {
      netINR: Math.round(wiseNetINR),
      lostINR: Math.round(midInr - wiseNetINR),
      effectiveRate: r2(wiseNetINR / a),
    },
    leakageVsDirect: Math.round(wiseNetINR - pp.netINR),
  };
}

