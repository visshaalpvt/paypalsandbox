"use client";
import { useState } from "react";

export default function AgentActivity({
  queue = [],
  auditLog = [],
  onDecision,
  refreshing = false,
}) {
  const [processingIds, setProcessingIds] = useState(new Set());

  const pendingItems = queue.filter((q) => q.status === "pending");

  async function handleAction(id, decision) {
    if (processingIds.has(id)) return;
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      await onDecision(id, decision);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="agent-panels-grid">
      {/* 1. Approval Queue */}
      <section className="agent-ledger-card">
        <div className="ledger-header">
          <h3>Autonomous Approval Queue</h3>
          <span className="mono-count">{pendingItems.length} pending</span>
        </div>

        {pendingItems.length === 0 ? (
          <div className="empty-ledger-state">
            No items awaiting approval. When agents identify overdue invoices or cash gaps, proposed actions appear here.
          </div>
        ) : (
          <div className="ledger-items-list">
            {pendingItems.map((item) => {
              const p = item.payload || {};
              const isProcessing = processingIds.has(item.id);

              return (
                <div key={item.id} className="ledger-queue-row">
                  <div className="queue-row-top">
                    <div>
                      <span className="queue-invoice-ref">
                        {p.invoiceNumber ? `Invoice #${p.invoiceNumber}` : `Milestone Draft`}
                      </span>
                      {p.client && <span className="queue-client-name"> · {p.client}</span>}
                      {p.amount && (
                        <span className="queue-amount">
                          {" "}· {p.amount} {p.currency || "USD"}
                        </span>
                      )}
                    </div>
                    <div className="queue-tags">
                      <span className={`tag-tone tag-${p.tone || "standard"}`}>
                        {p.tone ? p.tone.toUpperCase() : item.type.toUpperCase()}
                      </span>
                      <span className="tag-agent">{item.agent}</span>
                    </div>
                  </div>

                  {item.reason && (
                    <div className="queue-reason-text">
                      <strong>Policy trigger:</strong> {item.reason}
                    </div>
                  )}

                  {p.message && (
                    <div className="queue-message-box">
                      {p.subject && <div className="queue-subject-line">Subject: {p.subject}</div>}
                      <div className="queue-body-line">{p.message}</div>
                    </div>
                  )}

                  {item.type === "draft_invoice" && (
                    <div className="queue-message-box">
                      <div>Suggested USD milestone: ${p.suggestedUSD}</div>
                      <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
                        Client name & email left blank for manual assignment.
                      </div>
                    </div>
                  )}

                  <div className="queue-actions-row">
                    <button
                      className="btn-approve"
                      disabled={isProcessing}
                      onClick={() => handleAction(item.id, "approve")}
                    >
                      {isProcessing ? "Executing..." : "Approve & send"}
                    </button>
                    <button
                      className="btn-reject"
                      disabled={isProcessing}
                      onClick={() => handleAction(item.id, "reject")}
                    >
                      Reject
                    </button>
                    <span className="mono-timestamp">
                      Queued {new Date(item.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Agent Activity & Audit Trail */}
      <section className="agent-ledger-card">
        <div className="ledger-header">
          <h3>Agent Audit Trail</h3>
          <span className="mono-count">{auditLog.length} entries</span>
        </div>

        {auditLog.length === 0 ? (
          <div className="empty-ledger-state">
            No agent runs recorded yet. Click "Run agents now" to execute the first autonomous loop.
          </div>
        ) : (
          <div className="audit-timeline-list">
            {auditLog.map((entry) => {
              const isBlocked = entry.policyResult?.allowed === false;
              const isSuccess = entry.result?.ok || entry.result?.status === "QUEUED_FOR_APPROVAL";

              return (
                <div key={entry.id} className="audit-entry-row">
                  <div className="audit-entry-meta">
                    <span className="mono-timestamp">
                      [{new Date(entry.at).toLocaleTimeString()}]
                    </span>
                    <span className={`audit-agent-badge agent-${entry.agent}`}>
                      {entry.agent}
                    </span>
                    <span className="audit-decision-tag">
                      {entry.decision ? entry.decision.toUpperCase() : "EVALUATE"}
                    </span>
                    {entry.policyResult?.rule && (
                      <span className={`audit-rule-tag ${isBlocked ? "rule-blocked" : "rule-passed"}`}>
                        {entry.policyResult.rule}
                      </span>
                    )}
                  </div>

                  {entry.observation && (
                    <div className="audit-observation">
                      {entry.observation}
                    </div>
                  )}

                  {entry.reason && (
                    <div className="audit-reason">
                      <strong>Reason:</strong> {entry.reason}
                    </div>
                  )}

                  {entry.result && (
                    <div className="audit-result-line">
                      <strong>Result:</strong>{" "}
                      {entry.result.error ? (
                        <span className="error-inline">{entry.result.error}</span>
                      ) : entry.result.status === 204 ? (
                        <span>HTTP 204 (Reminder delivered via PayPal)</span>
                      ) : (
                        <span>{JSON.stringify(entry.result)}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

