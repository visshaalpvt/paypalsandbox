const BASE = () => process.env.PAYPAL_BASE || "https://api-m.sandbox.paypal.com";
let cache = { token: null, exp: 0 };

async function getToken() {
  if (cache.token && Date.now() < cache.exp) return cache.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
  const res = await fetch(`${BASE()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${JSON.stringify(data)}`);
  cache = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return cache.token;
}

export async function pp(path, { method = "GET", body } = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  // Handle 204 No Content (returned by PayPal remind, cancel, delete endpoints)
  if (res.status === 204) return { ok: true, status: 204 };

  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : { ok: true, status: res.status };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

export async function createAndSendInvoice({ clientName, email, items, currency = "USD", dueDays = 7, backdateDays = 0, note }) {
  const invDate = addDays(new Date(), -backdateDays);
  const due = addDays(invDate, dueDays);
  const [given, ...rest] = clientName.trim().split(/\s+/);
  const draft = await pp("/v2/invoicing/invoices", {
    method: "POST",
    body: {
      detail: {
        invoice_date: iso(invDate), currency_code: currency, note,
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: iso(due) },
      },
      primary_recipients: [{ billing_info: { name: { given_name: given, surname: rest.join(" ") || undefined }, email_address: email } }],
      items: items.map((i) => ({
        name: i.name, quantity: "1",
        unit_amount: { currency_code: currency, value: Number(i.amount).toFixed(2) },
      })),
    },
  });
  const id = draft.href.split("/").pop();
  const sent = await pp(`/v2/invoicing/invoices/${id}/send`, { method: "POST", body: { send_to_recipient: true, send_to_invoicer: false } });
  let invoice_number = null;
  try { invoice_number = (await pp(`/v2/invoicing/invoices/${id}`)).detail?.invoice_number; } catch {}
  return { id, invoice_number, due: iso(due), payLink: sent?.href };
}

export const listInvoicesRaw = () => pp("/v2/invoicing/invoices?page=1&page_size=100&total_required=true");
export const getInvoice = (id) => pp(`/v2/invoicing/invoices/${id}`);

export async function sendReminder(invoiceId, { subject, note } = {}) {
  const finalSubject = subject || "Payment reminder";
  const finalNote = note || "Just a quick reminder regarding your open invoice. Thank you!";
  const res = await pp(`/v2/invoicing/invoices/${invoiceId}/remind`, {
    method: "POST",
    body: {
      subject: finalSubject,
      note: finalNote,
      send_to_recipient: true,
      send_to_invoicer: false,
    },
  });
  return { ok: true, status: res.status || 204, invoiceId, subject: finalSubject };
}

export const remindInvoice = (id, subject, note) => sendReminder(id, { subject, note });

export async function verifyWebhook(headers, bodyText) {
  const webhook_id = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhook_id) return { ok: true, skipped: true };
  const r = await pp("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: headers.get("paypal-auth-algo"), cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"), transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"), webhook_id, webhook_event: JSON.parse(bodyText),
    },
  });
  return { ok: r.verification_status === "SUCCESS" };
}
