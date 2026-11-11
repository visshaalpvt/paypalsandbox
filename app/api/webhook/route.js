import { verifyWebhook } from "@/lib/paypal";
import { addEvent } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.text();
  try {
    const v = await verifyWebhook(req.headers, body);
    if (!v.ok) return new Response("bad signature", { status: 400 });
    const ev = JSON.parse(body);
    const t = ev.event_type || "";
    const inv = ev.resource?.invoice || ev.resource || {};
    const ref = inv.id;
    const num = inv.detail?.invoice_number || ref;
    if (t === "INVOICING.INVOICE.PAID") addEvent("paid", `Invoice ${num} was paid (webhook)`, ref);
    else if (t.startsWith("CUSTOMER.DISPUTE")) addEvent("dispute", `Dispute event: ${t}. Ask the agent to draft a dispute packet.`, ev.resource?.disputed_transactions?.[0]?.invoice_number || ref);
    else if (t.startsWith("INVOICING.")) addEvent("invoice", `${t} (${num})`, ref);
    return new Response("ok");
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
}
