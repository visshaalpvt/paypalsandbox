import { runCollectionsAgent } from "@/lib/agents/collections";
import { runCashFlowAgent } from "@/lib/agents/cashflow";
import { updateSettings } from "@/lib/agents/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  try {
    const runId = `run_${Date.now()}`;
    const now = new Date().toISOString();
    const nextRun = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

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

