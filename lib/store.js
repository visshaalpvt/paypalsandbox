import fs from "fs";
import path from "path";

const DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "store.json");
const EMPTY = { evidence: {}, reminders: {}, events: [], history: {}, seenPaid: {} };

export function read() {
  try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; }
  catch { return structuredClone(EMPTY); }
}
export function write(data) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("store write failed", e.message); }
}
export function update(fn) { const d = read(); fn(d); write(d); return d; }

export const addEvent = (type, summary, ref) =>
  update((d) => { d.events.unshift({ type, summary, ref, at: new Date().toISOString() }); d.events = d.events.slice(0, 50); });
export const addEvidence = (invoiceId, kind, text) =>
  update((d) => { (d.evidence[invoiceId] ||= []).push({ kind, text, at: new Date().toISOString() }); });
export const addReminder = (invoiceId, tone, subject, note) =>
  update((d) => { (d.reminders[invoiceId] ||= []).push({ tone, subject, note, at: new Date().toISOString() }); });

export function getRemindersToday(invoiceId) {
  const d = read();
  const list = d.reminders[invoiceId] || [];
  const todayStr = new Date().toISOString().slice(0, 10);
  return list.filter((r) => r.at && r.at.slice(0, 10) === todayStr).length;
}
