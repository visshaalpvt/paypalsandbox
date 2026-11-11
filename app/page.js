"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import CashGapCard from "@/components/CashGapCard";
import AgentControls from "@/components/AgentControls";
import AgentActivity from "@/components/AgentActivity";

ModuleRegistry.registerModules([AllCommunityModule]);

const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const money = (v, c) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: c || "USD" }).format(v);
  } catch {
    return `${v} ${c}`;
  }
};

const PROMPTS = [
  "Bill Acme Corp (billing@acme.com) $500 for logo design, due in 7 days",
  "Who is overdue and what should I do about each?",
  "Check cash-gap: will I have ₹50,000 for rent in 10 days?",
  "How much INR will I really receive from a $1,000 invoice?",
];

function StatusCell({ data }) {
  if (!data) return null;
  const overdue = data.daysOverdue > 0;
  const cls = data.status === "PAID" ? "paid" : overdue ? "overdue" : data.open ? "open" : "draft";
  const label = overdue ? `OVERDUE ${data.daysOverdue}d` : data.status.replace("_", " ");
  return <span className={`chip ${cls}`}>{label}</span>;
}

export default function Home() {
  const [data, setData] = useState({ invoices: [], clients: [], kpis: {}, events: [] });
  const [err, setErr] = useState("");

  // Agent State
  const [agentState, setAgentState] = useState({
    settings: { autopilot: false, enabled: true, lastRunAt: null, nextRunAt: null },
    queue: [],
    auditLog: [],
  });
  const [runningAgents, setRunningAgents] = useState(false);

  // Chat State
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm InvoicePilot. Tell me who to bill, ask who is overdue, or check your Cash-Gap Shield forecast. Money-moving actions wait for your approval.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState([]);
  const [approvingIds, setApprovingIds] = useState(new Set());
  const bottom = useRef(null);

  // Refresh live invoice data
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/invoices");
      const j = await r.json();
      if (j.error) setErr(j.error);
      else {
        setErr("");
        setData(j);
      }
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  // Refresh autonomous agent state
  const refreshAgentState = useCallback(async () => {
    try {
      const r = await fetch("/api/agents/state");
      const j = await r.json();
      if (!j.error) {
        setAgentState(j);
      }
    } catch (e) {
      console.warn("Failed to fetch agent state:", e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshAgentState();
    const t = setInterval(() => {
      refresh();
      refreshAgentState();
    }, 10000);
    return () => clearInterval(t);
  }, [refresh, refreshAgentState]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  // Run autonomous agents loop
  async function handleRunAgents() {
    setRunningAgents(true);
    try {
      const res = await fetch("/api/agents/trigger", { method: "POST" });
      const j = await res.json();
      if (j.error) {
        setErr("Agent run error: " + j.error);
      } else {
        await refreshAgentState();
        await refresh();
      }
    } catch (e) {
      setErr("Failed to trigger agents: " + e.message);
    } finally {
      setRunningAgents(false);
    }
  }

  // Toggle Autopilot
  async function handleToggleAutopilot(val) {
    try {
      const res = await fetch("/api/agents/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autopilot: val }),
      });
      const j = await res.json();
      if (j.settings) {
        setAgentState((prev) => ({ ...prev, settings: j.settings }));
      }
    } catch (e) {
      setErr("Failed to update autopilot setting: " + e.message);
    }
  }

  // Toggle Kill Switch
  async function handleToggleKillSwitch(enabledVal) {
    try {
      const res = await fetch("/api/agents/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enabledVal }),
      });
      const j = await res.json();
      if (j.settings) {
        setAgentState((prev) => ({ ...prev, settings: j.settings }));
      }
    } catch (e) {
      setErr("Failed to toggle kill switch: " + e.message);
    }
  }

  // Approve or Reject an item in the Autonomous Agent Queue
  async function handleAgentDecision(id, decision) {
    try {
      const res = await fetch(`/api/agents/queue/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const j = await res.json();
      if (j.error) {
        setErr(`Action error: ${j.error}`);
      }
      await refreshAgentState();
      await refresh();
    } catch (e) {
      setErr("Failed to submit decision: " + e.message);
    }
  }

  // Chat message sending
  async function send(text) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    const next = [...messages, { role: "user", content: t }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const history = next
        .filter((m, i) => !(i === 0 && m.role === "assistant"))
        .map(({ role, content }) => ({ role, content }));
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, autopilot: agentState.settings?.autopilot }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setMessages((m) => [...m, { role: "assistant", content: j.reply || "(done)", tools: j.log }]);
      if (j.pending?.length) setPending((p) => [...p, ...j.pending]);
      refresh();
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Error: " + e.message }]);
    }
    setBusy(false);
  }

  // Approve / Reject Chat-initiated pending actions
  async function decide(p, approve) {
    if (approvingIds.has(p.id)) return;
    setApprovingIds((prev) => new Set(prev).add(p.id));
    setPending((x) => x.filter((y) => y.id !== p.id));

    if (!approve) {
      setApprovingIds((prev) => {
        const n = new Set(prev);
        n.delete(p.id);
        return n;
      });
      setMessages((m) => [...m, { role: "assistant", content: `Rejected: ${p.summary}` }]);
      return;
    }

    setBusy(true);
    try {
      const r = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: p.tool, input: p.input }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const res = j.result || {};
      const extra = res.payLink ? `\nClient pay link: ${res.payLink}` : "";
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Done: ${p.summary}${res.invoice_number ? ` (invoice ${res.invoice_number})` : ""}${extra}`,
        },
      ]);
      refresh();
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Failed: " + e.message }]);
    } finally {
      setApprovingIds((prev) => {
        const n = new Set(prev);
        n.delete(p.id);
        return n;
      });
      setBusy(false);
    }
  }

  function mic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Voice input works in Chrome.");
    const r = new SR();
    r.lang = "en-IN";
    r.onresult = (e) => setInput(e.results[0][0].transcript);
    r.start();
  }

  const cols = [
    { field: "number", headerName: "Invoice", width: 120 },
    { field: "client", headerName: "Client", flex: 1, minWidth: 130 },
    { field: "description", headerName: "For", flex: 1.3, minWidth: 140 },
    {
      field: "amount",
      headerName: "Amount",
      width: 120,
      valueFormatter: (p) => money(p.value, p.data?.currency),
    },
    { field: "dueDate", headerName: "Due", width: 115 },
    { field: "status", headerName: "Status", width: 150, cellRenderer: StatusCell },
    {
      headerName: "",
      width: 110,
      sortable: false,
      filter: false,
      cellRenderer: ({ data }) =>
        data?.open ? (
          <button
            style={{ padding: "2px 8px", fontSize: 12 }}
            onClick={() => send(`Handle the overdue follow-up for invoice ${data.number} (${data.client})`)}
          >
            Ask AI
          </button>
        ) : null,
    },
  ];

  const k = data.kpis || {};

  return (
    <>
      <header>
        <h1>
          InvoicePilot <small>Autonomous Collections Agent & Cash-Gap Shield on PayPal</small>
        </h1>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="env-tag">PayPal Sandbox</span>
        </div>
      </header>

      <main>
        {err && (
          <div className="err" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Error: {err}</span>
            <button
              onClick={() => setErr("")}
              style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: 13 }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. Autonomous Agent Controls Bar */}
        <AgentControls
          settings={agentState.settings}
          onToggleAutopilot={handleToggleAutopilot}
          onToggleKillSwitch={handleToggleKillSwitch}
          onRunAgents={handleRunAgents}
          running={runningAgents}
        />

        {/* 2. KPIs Overview */}
        <div className="kpis">
          <div className="kpi">
            <span>Outstanding</span>
            <b>{inr(k.outstandingINR)}</b>
            <small>{k.openCount || 0} open invoices</small>
          </div>
          <div className="kpi bad">
            <span>Overdue</span>
            <b>{inr(k.overdueINR)}</b>
            <small>{k.overdueCount || 0} invoices</small>
          </div>
          <div className="kpi ok">
            <span>Collected</span>
            <b>{inr(k.collectedINR)}</b>
            <small>paid invoices</small>
          </div>
          <div className="kpi warn">
            <span>PayPal Fee Leak (Est.)</span>
            <b>{inr(k.feeLeakINR)}</b>
            <small>on outstanding, after fee + GST + FX</small>
          </div>
        </div>

        {/* 3. Autonomous Agent Activity: Approval Queue & Audit Trail */}
        <AgentActivity
          queue={agentState.queue}
          auditLog={agentState.auditLog}
          onDecision={handleAgentDecision}
        />

        {/* 4. Interactive Workspace: Conversational Money Agent + CashGap & Tables */}
        <div className="cols">
          <section className="card chat">
            <h2>Conversational Money Agent</h2>
            <div className="msgs">
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.content}
                  {m.tools?.length > 0 && (
                    <div className="tools">
                      {[...new Set(m.tools)].map((t) => (
                        <span className="tool" key={t}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {pending.map((p) => (
                <div className="pending" key={p.id}>
                  <strong>Waiting for your approval:</strong>
                  <div>{p.summary}</div>
                  {p.preview && <pre>{p.preview}</pre>}
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      className="ok"
                      disabled={busy || approvingIds.has(p.id)}
                      onClick={() => decide(p, true)}
                    >
                      {approvingIds.has(p.id) ? "Approving..." : "Approve & send"}
                    </button>
                    <button disabled={busy || approvingIds.has(p.id)} onClick={() => decide(p, false)}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
              {busy && <div className="msg assistant">Thinking...</div>}
              <div ref={bottom} />
            </div>

            <div className="chips">
              {PROMPTS.map((p) => (
                <button key={p} onClick={() => setInput(p)}>
                  {p.length > 42 ? p.slice(0, 40) + "..." : p}
                </button>
              ))}
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <input
                className="chatin"
                value={input}
                placeholder="Bill someone, chase a payment, check cash gap..."
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button onClick={mic} title="Voice Input">
                Mic
              </button>
              <button className="primary" disabled={busy} onClick={() => send()}>
                Send
              </button>
            </div>
          </section>

          <div className="right">
            {/* Cash-Gap Shield Card */}
            <CashGapCard onAskAI={(prompt) => send(prompt)} />

            {/* Invoices Table */}
            <section className="card">
              <h2>Invoices (Live from PayPal Invoicing API)</h2>
              <div style={{ height: 320 }}>
                <AgGridReact
                  rowData={data.invoices}
                  columnDefs={cols}
                  defaultColDef={{ sortable: true, filter: true, resizable: true }}
                  getRowId={(p) => p.data.id}
                />
              </div>
            </section>

            {/* Client Reliability Insights */}
            <section className="card">
              <h2>Client Reliability & Collections Stage</h2>
              <div className="clients">
                {data.clients.length === 0 && <small>No clients observed yet.</small>}
                {data.clients.map((c) => (
                  <div className="client" key={c.email || c.name}>
                    <b>{c.name}</b>
                    <div className="meter">
                      <i
                        style={{
                          width: c.reliability + "%",
                          background:
                            c.reliability > 70 ? "var(--forest)" : c.reliability > 40 ? "var(--amber)" : "var(--vermilion)",
                        }}
                      />
                    </div>
                    <small>
                      Reliability {c.reliability}/100
                      {c.paidInvoicesObserved
                        ? ` (based on ${c.paidInvoicesObserved} paid invoice${c.paidInvoicesObserved > 1 ? "s" : ""})`
                        : " (new client)"}
                      {c.avgDaysLate != null ? ` · pays ~${c.avgDaysLate}d late` : ""}
                    </small>
                    <small>
                      Stage: <strong style={{ display: "inline" }}>{c.stage}</strong> · {c.action}
                    </small>
                  </div>
                ))}
              </div>
            </section>

            {/* Activity Stream */}
            <section className="card feed">
              <h2>Activity Log (Webhooks & Operations)</h2>
              {data.events.length === 0 && <small>Events appear here when PayPal webhooks fire or actions occur.</small>}
              {data.events.map((e, i) => (
                <div key={i}>
                  {new Date(e.at).toLocaleTimeString()} · {e.summary}
                </div>
              ))}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
