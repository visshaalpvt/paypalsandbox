import { getEnriched } from "@/lib/invoices";
import { planCash } from "@/lib/cashgap";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req) {
  try {
    const { bills = [], openingBalanceINR = 0 } = await req.json();

    if (!Array.isArray(bills) || bills.length === 0) {
      return Response.json(
        { error: "bills array is required (e.g. [{ label: 'Rent', amountINR: 40000, date: '2026-11-20' }])" },
        { status: 400 }
      );
    }

    // Load live invoices & clients with no caching
    const { invoices, clients } = await getEnriched();

    const plan = await planCash({
      bills,
      openingBalanceINR,
      invoices,
      clients,
    });

    return Response.json(plan);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

