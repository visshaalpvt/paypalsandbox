import { getState } from "@/lib/agents/store";
import { loadSavedBills } from "@/lib/agents/cashflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const state = getState();
    const bills = loadSavedBills();

    return Response.json({
      settings: state.settings,
      queue: state.queue,
      auditLog: state.auditLog.slice(0, 50),
      bills,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

