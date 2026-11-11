import { getState, updateQueueItem, addAuditEntry, getRecentRemindersForInvoice } from "@/lib/agents/store";
import { getEnriched } from "@/lib/invoices";
import { sendReminder } from "@/lib/paypal";
import { checkPolicy } from "@/lib/agents/policy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req, { params }) {
  try {
    const { id } = params;
    const { decision } = await req.json();

    if (!["approve", "reject"].includes(decision)) {
      return Response.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
    }

    const state = getState();
    const item = state.queue.find((q) => q.id === id);

    if (!item) {
      return Response.json({ error: `Queue item "${id}" not found` }, { status: 404 });
    }

    // Idempotency: Second click does nothing
    if (item.status !== "pending") {
      return Response.json({
        ok: true,
        alreadyProcessed: true,
        status: item.status,
        result: item.result,
      });
    }

    if (decision === "reject") {
      updateQueueItem(id, {
        status: "rejected",
        result: { rejectedAt: new Date().toISOString() },
      });

      addAuditEntry({
        agent: item.agent,
        observation: `User rejected queued ${item.type} action for invoice #${item.payload?.invoiceNumber || item.invoiceId || "draft"}.`,
        decision: "reject",
        reason: "User clicked Reject in approval queue.",
        action: item,
        result: { status: "REJECTED_BY_USER" },
      });

      return Response.json({ ok: true, status: "rejected" });
    }

    // Decision === "approve"
    if (item.type === "remind") {
      // Re-validate against policy engine right before executing
      const { invoices = [], clients = [] } = await getEnriched();
      const inv = invoices.find((i) => i.id === item.invoiceId);
      const client = inv
        ? clients.find(
            (c) =>
              (c.email && inv.email && c.email.toLowerCase() === inv.email.toLowerCase()) ||
              (c.name && inv.client && c.name.toLowerCase() === inv.client.toLowerCase())
          )
        : null;

      const recentReminders = getRecentRemindersForInvoice(item.invoiceId);
      const policyResult = checkPolicy(
        {
          type: "remind",
          invoiceId: item.invoiceId,
          tone: item.payload?.tone,
          subject: item.payload?.subject,
          message: item.payload?.message,
          flaggedForGap: item.payload?.flaggedForGap,
        },
        {
          invoice: inv,
          client,
          recentReminders,
          agentEnabled: true,
        }
      );

      if (!policyResult.allowed) {
        updateQueueItem(id, {
          status: "failed",
          result: { error: policyResult.reason, rule: policyResult.rule },
        });

        addAuditEntry({
          agent: item.agent,
          observation: `Approval blocked by policy rule ${policyResult.rule}.`,
          decision: "approve_blocked",
          reason: policyResult.reason,
          policyResult,
          action: item,
          result: { ok: false, error: policyResult.reason },
        });

        return Response.json(
          { error: `Policy violation: ${policyResult.reason}` },
          { status: 400 }
        );
      }

      // Execute PayPal sendReminder
      try {
        const paypalRes = await sendReminder(item.invoiceId, {
          subject: item.payload?.subject,
          note: item.payload?.message,
        });

        updateQueueItem(id, {
          status: "executed",
          result: { ok: true, status: paypalRes.status || 204, executedAt: new Date().toISOString() },
        });

        addAuditEntry({
          agent: item.agent,
          observation: `User approved reminder for Invoice #${item.payload?.invoiceNumber || item.invoiceId}.`,
          decision: "remind",
          reason: "User approved action in queue.",
          policyResult: { allowed: true, rule: "MANUAL_APPROVAL_PASSED" },
          action: item,
          result: { ok: true, status: paypalRes.status || 204 },
        });

        return Response.json({ ok: true, status: "executed", result: paypalRes });
      } catch (sendErr) {
        updateQueueItem(id, {
          status: "failed",
          result: { error: sendErr.message },
        });

        addAuditEntry({
          agent: item.agent,
          observation: `PayPal reminder failed for Invoice #${item.payload?.invoiceNumber || item.invoiceId}.`,
          decision: "failed",
          reason: sendErr.message,
          action: item,
          result: { ok: false, error: sendErr.message },
        });

        return Response.json({ error: sendErr.message }, { status: 500 });
      }
    }

    // Default approval for non-remind items (e.g. draft_invoice)
    updateQueueItem(id, {
      status: "approved",
      result: { approvedAt: new Date().toISOString() },
    });

    addAuditEntry({
      agent: item.agent,
      observation: `User approved ${item.type} proposal.`,
      decision: "approve",
      reason: "User approved action in queue.",
      action: item,
      result: { ok: true },
    });

    return Response.json({ ok: true, status: "approved" });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

