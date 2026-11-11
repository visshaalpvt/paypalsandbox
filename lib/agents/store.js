import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "agent-store.json");

const MAX_AUDIT_ENTRIES = 200;
const MAX_QUEUE_ITEMS = 100;

const DEFAULT_STATE = {
  settings: {
    autopilot: false,
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
  },
  queue: [], // { id, createdAt, agent, type, invoiceId, payload, reason, status, result }
  auditLog: [], // { id, at, runId, agent, observation, decision, reason, policyResult, action, result }
};

// In-memory cache
let inMemoryState = null;

function loadFromDisk() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_STATE.settings, ...parsed.settings },
        queue: Array.isArray(parsed.queue) ? parsed.queue : [],
        auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog : [],
      };
    }
  } catch (err) {
    console.warn("Failed to read agent-store.json, starting with clean state:", err.message);
  }
  return structuredClone(DEFAULT_STATE);
}

function saveToDisk(state) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to persist agent-store.json:", err.message);
  }
}

export function getState() {
  if (!inMemoryState) {
    inMemoryState = loadFromDisk();
  }
  return inMemoryState;
}

export function updateState(fn) {
  const state = getState();
  fn(state);

  // Enforce caps
  if (state.queue.length > MAX_QUEUE_ITEMS) {
    state.queue = state.queue.slice(-MAX_QUEUE_ITEMS);
  }
  if (state.auditLog.length > MAX_AUDIT_ENTRIES) {
    state.auditLog = state.auditLog.slice(-MAX_AUDIT_ENTRIES);
  }

  saveToDisk(state);
  return state;
}

export function getSettings() {
  return getState().settings;
}

export function updateSettings(partial) {
  return updateState((state) => {
    state.settings = { ...state.settings, ...partial };
  }).settings;
}

export function enqueueItem({ agent, type, invoiceId, payload, reason }) {
  const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const item = {
    id,
    createdAt: new Date().toISOString(),
    agent: agent || "collections",
    type, // "remind" | "draft_invoice"
    invoiceId: invoiceId || null,
    payload: payload || {},
    reason: reason || "",
    status: "pending", // "pending" | "approved" | "rejected" | "executed" | "failed"
    result: null,
  };

  updateState((state) => {
    state.queue.unshift(item);
  });

  return item;
}

export function updateQueueItem(id, updates) {
  let found = null;
  updateState((state) => {
    const idx = state.queue.findIndex((q) => q.id === id);
    if (idx !== -1) {
      state.queue[idx] = { ...state.queue[idx], ...updates };
      found = state.queue[idx];
    }
  });
  return found;
}

export function addAuditEntry({
  runId,
  agent,
  observation,
  decision,
  reason,
  policyResult,
  action,
  result,
}) {
  const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    id,
    at: new Date().toISOString(),
    runId: runId || `run_${Date.now()}`,
    agent: agent || "system",
    observation: observation || "",
    decision: decision || "",
    reason: reason || "",
    policyResult: policyResult || null,
    action: action || null,
    result: result || null,
  };

  updateState((state) => {
    state.auditLog.unshift(entry);
  });

  return entry;
}

export function getRecentRemindersForInvoice(invoiceId) {
  if (!invoiceId) return [];
  const state = getState();
  const times = [];

  for (const entry of state.auditLog) {
    if (
      entry.action?.invoiceId === invoiceId &&
      entry.action?.type === "remind" &&
      entry.result?.ok
    ) {
      times.push(new Date(entry.at).getTime());
    }
  }

  // Also include executed queue items
  for (const q of state.queue) {
    if (q.invoiceId === invoiceId && q.status === "executed" && q.result?.ok) {
      times.push(new Date(q.createdAt).getTime());
    }
  }

  return [...new Set(times)].sort((a, b) => b - a);
}

