import { updateSettings, getSettings } from "@/lib/agents/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req) {
  try {
    const body = await req.json();
    const current = getSettings();

    const updates = {};
    if (typeof body.autopilot === "boolean") updates.autopilot = body.autopilot;
    if (typeof body.enabled === "boolean") updates.enabled = body.enabled;

    const newSettings = updateSettings(updates);
    return Response.json({ ok: true, settings: newSettings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

