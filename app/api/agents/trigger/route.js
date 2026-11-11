import { runCollectionsAgent } from "@/lib/agents/collections";
import { runCashFlowAgent } from "@/lib/agents/cashflow";
import { updateSettings } from "@/lib/agents/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

let lastTriggerTime = 0;
const COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown to protect Gemini quota & PayPal rate limits

export async function POST() {
  try {
    const nowMs = Date.now();
    const elapsed = nowMs - lastTriggerTime;

    if (elapsed < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return Response.json(
        {
          error: `Agent run cooldown active. Please wait ${waitSec}s before running again to protect API quotas.`,
          cooldownRemaining: waitSec,
        },
        { status: 429 }
      );
    }

    lastTriggerTime = nowMs;

    const runId = `run_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const nextRun = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    const collectionsResult = await runCollectionsAgent({ runId });
    const cashFlowResult = await runCashFlowAgent({ runId });

    updateSettings({
      lastRunAt: nowIso,
      nextRunAt: nextRun,
    });

    return Response.json({
      ok: true,
      runId,
      at: nowIso,
      nextScheduledRun: nextRun,
      collections: collectionsResult,
      cashflow: cashFlowResult,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
