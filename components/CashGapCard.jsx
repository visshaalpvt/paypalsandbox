"use client";
import { useState } from "react";

const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

export default function CashGapCard({ onAskAI }) {
  // Default date to 7 days from today
  const defaultDate = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  const [label, setLabel] = useState("Studio Rent");
  const [amountINR, setAmountINR] = useState("50000");
  const [date, setDate] = useState(defaultDate);
  const [openingBalanceINR, setOpeningBalanceINR] = useState("0");

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");

  async function handleCheck(e) {
    if (e) e.preventDefault();
    if (!amountINR || Number(amountINR) <= 0) {
      setError("Please enter a valid bill amount greater than 0");
      return;
    }
    if (!date) {
      setError("Please select a date");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/cashplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bills: [
            {
              label: label.trim() || "Upcoming Expense",
              amountINR: Number(amountINR),
              date,
            },
          ],
          openingBalanceINR: Number(openingBalanceINR) || 0,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to calculate cash plan");
      setPlan(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const check = plan?.checks?.[0];
  const hasGap = Boolean(plan?.firstGap);

  return (
    <section className="card cashgap-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🛡️ Cash-Gap Shield <small style={{ fontWeight: 400, color: "var(--mute)" }}>Forecast shortfall before rent is due</small></h2>
        {plan?.assumptions && (
          <span style={{ fontSize: 11, color: "var(--mute)", background: "var(--bg)", padding: "2px 8px", borderRadius: 6 }}>
            {plan.rates?.isLive ? "🟢 Live FX" : "⚪ Fallback FX"} @ ₹{plan.rates?.rates?.USD || 87}
          </span>
        )}
      </div>

      <form onSubmit={handleCheck} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr)) 110px", gap: 10, alignItems: "end" }}>
        <div>
          <label style={{ fontSize: 12, color: "var(--mute)", display: "block", marginBottom: 4 }}>Bill Name</label>
          <input
            className="chatin"
            style={{ width: "100%", padding: "6px 10px", fontSize: 13 }}
            value={label}
            placeholder="Rent, Adobe, Taxes"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: "var(--mute)", display: "block", marginBottom: 4 }}>Amount (INR)</label>
          <input
            type="number"
            className="chatin"
            style={{ width: "100%", padding: "6px 10px", fontSize: 13 }}
            value={amountINR}
            placeholder="50000"
            onChange={(e) => setAmountINR(e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: "var(--mute)", display: "block", marginBottom: 4 }}>Due Date</label>
          <input
            type="date"
            className="chatin"
            style={{ width: "100%", padding: "6px 10px", fontSize: 13 }}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: "var(--mute)", display: "block", marginBottom: 4 }}>Bank Balance (INR)</label>
          <input
            type="number"
            className="chatin"
            style={{ width: "100%", padding: "6px 10px", fontSize: 13 }}
            value={openingBalanceINR}
            placeholder="0"
            onChange={(e) => setOpeningBalanceINR(e.target.value)}
          />
        </div>

        <div>
          <button
            type="submit"
            className="primary"
            disabled={loading}
            style={{ width: "100%", padding: "8px 12px", fontSize: 13, height: 38 }}
          >
            {loading ? "Checking…" : "Check Shield"}
          </button>
        </div>
      </form>

      {error && <div className="err" style={{ marginTop: 12 }}>⚠️ {error}</div>}

      {check && (
        <div style={{ marginTop: 14 }}>
          {hasGap ? (
            <div
              style={{
                background: "#d92d2015",
                border: "1px solid #d92d2044",
                color: "var(--bad)",
                padding: "12px 14px",
                borderRadius: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b>⚠️ Shortfall: {inr(check.shortfallINR)} gap on {check.date}</b>
                <span style={{ fontSize: 12 }}>Bill: {inr(check.amountINR)} · Inflows: {inr(check.inflowsAvailableINR)}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink)" }}>
                Expected net inflows arriving on or before {check.date} fall short of your {check.label} expense.
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "#12a15015",
                border: "1px solid #12a15044",
                color: "var(--ok)",
                padding: "12px 14px",
                borderRadius: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b>✅ Fully Covered! Projected surplus: {inr(check.projectedBalance)}</b>
                <span style={{ fontSize: 12 }}>Bill: {inr(check.amountINR)} · Inflows: {inr(check.inflowsAvailableINR)}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink)" }}>
                Your {check.label} on {check.date} is covered by reliable incoming PayPal payments.
              </div>
            </div>
          )}

          {/* Actionable Fixes */}
          {plan.fixes?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mute)", textTransform: "uppercase" }}>
                Recommended Fixes (Real Actions)
              </span>
              <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                {plan.fixes.map((fix, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <b>{fix.title}</b>
                        {fix.impactLabel && (
                          <span style={{ fontSize: 11, background: "var(--card)", padding: "1px 6px", borderRadius: 4, color: "var(--mute)", border: "1px solid var(--line)" }}>
                            {fix.impactLabel}
                          </span>
                        )}
                      </div>
                      <div style={{ color: "var(--mute)", fontSize: 12, marginTop: 2 }}>{fix.action}</div>
                    </div>
                    {onAskAI && (
                      <div style={{ marginLeft: 8, flexShrink: 0 }}>
                        {fix.type === "chase_overdue" && (
                          <button
                            onClick={() => onAskAI(`Send a reminder for overdue invoice ${fix.invoiceId}`)}
                            style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                          >
                            Chase in AI
                          </button>
                        )}
                        {fix.type === "nudge_upcoming" && (
                          <button
                            onClick={() => onAskAI(`Send a friendly payment reminder on invoice ${fix.invoiceId}`)}
                            style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                          >
                            Nudge in AI
                          </button>
                        )}
                        {fix.type === "bill_milestone" && (
                          <button
                            onClick={() => onAskAI(`Create a milestone invoice for an upcoming client`)}
                            style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                          >
                            Bill in AI
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expected Inflows breakdown */}
          <div style={{ marginTop: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mute)", textTransform: "uppercase" }}>
              Expected Inflows (Estimated Net of PayPal Fees, GST & FX Spread)
            </span>
            {plan.inflows?.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--mute)", marginTop: 6 }}>
                No open invoices found. Create invoices in chat to forecast cash flow.
              </div>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--mute)" }}>
                      <th style={{ padding: "6px 8px" }}>Invoice</th>
                      <th style={{ padding: "6px 8px" }}>Client</th>
                      <th style={{ padding: "6px 8px" }}>Gross Amount</th>
                      <th style={{ padding: "6px 8px" }}>Est. Arrival</th>
                      <th style={{ padding: "6px 8px" }}>Net INR</th>
                      <th style={{ padding: "6px 8px" }}>Reliability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.inflows.map((inf) => (
                      <tr key={inf.invoiceId} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 8px" }}>#{inf.number}</td>
                        <td style={{ padding: "6px 8px" }}>{inf.client}</td>
                        <td style={{ padding: "6px 8px" }}>${inf.grossAmount} {inf.currency}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {inf.expectedDate}{" "}
                          {inf.isOverdue && <span style={{ color: "var(--bad)", fontSize: 11 }}>(overdue)</span>}
                        </td>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{inr(inf.netINR)}</td>
                        <td style={{ padding: "6px 8px" }}>{inf.reliability}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

