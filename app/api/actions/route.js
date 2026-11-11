import { runTool, GATED } from "@/lib/tools";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { tool, input } = await req.json();
    if (!GATED.has(tool)) return Response.json({ error: "Not an approvable action" }, { status: 400 });
    const result = await runTool(tool, input, { force: true });
    return Response.json({ result });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
