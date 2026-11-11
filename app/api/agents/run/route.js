import { runCollectionsAgent } from "@/lib/agents/collections";
import { runCashFlowAgent } from "@/lib/agents/cashflow";
import { updateSettings } from "@/lib/agents/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req) {
  try {
    const secret = process.env.AGENT_SECRET;
    const providedSecret = req.headers.get("x-agent-secret");

    // Enforce secret header if AGENT_SECRET is configured
    if (secret && providedSecret !== secret) {
      return Response.json({ error: "Unauthorized: Invalid or missing x-agent-secret header" }, { status: 401 });
    }

    const runId = `run_${Date.now()}`;
    const now = new Date().toISOString();
    const nextRun = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    // Run both autonomous agents
    const collectionsResult = await runCollectionsAgent({ runId });
    const cashFlowResult = await runCashFlowAgent({ runId });

    updateSettings({
      lastRunAt: now,
      nextRunAt: nextRun,
    });

    return Response.json({
      ok: true,
      runId,
      at: now,
      nextScheduledRun: nextRun,
      collections: collectionsResult,
      cashflow: cashFlowResult,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

