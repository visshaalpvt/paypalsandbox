// PayPal India cross-border receiving costs aligned with lib/rates.js
import { netINR, grossUpUSD, grossUpToNetINR, DEFAULT_FALLBACK_RATES } from "./rates.js";

export const FX = DEFAULT_FALLBACK_RATES;
export { grossUpToNetINR };

export function netReceipt(amount, currency = "USD", spread = 0.04) {
  const result = netINR(amount, currency, spread);
  return {
    gross: result.gross,
    currency: result.currency,
    paypalFee: result.paypalFee,
    gstOnFee: result.gstOnFee,
    conversionSpreadLoss: result.conversionSpreadLoss,
    netInCurrency: result.netInCurrency,
    netINR: result.netINR,
    midMarketINR: result.midMarketINR,
    lostINR: result.lostINR,
    lostPercent: result.lostPercent,
    note: `Indicative: 1 ${currency} = ${result.rate} INR, spread ${spread * 100}%. Verify rates in your PayPal account.`,
  };
}

export function grossUp(target, currency = "USD") {
  return grossUpUSD(target, currency);
}

export const toINR = (amount, currency = "USD") => {
  const rate = FX[currency] ?? 87;
  return Number(amount) * rate;
};
