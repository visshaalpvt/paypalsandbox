import { getEnriched } from "@/lib/invoices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try { return Response.json(await getEnriched()); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}
