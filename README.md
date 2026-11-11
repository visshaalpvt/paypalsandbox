# ✈️ InvoicePilot

**An approval-gated AI collections agent & Cash-Gap Shield for freelancers who bill international clients through PayPal.**
Built for the PayPal AI Hackathon 2026. Powered by **PayPal Invoicing API v2 + Webhooks (sandbox)** and **Multi-LLM Tool-Use (Groq ultra-fast Qwen/LLaMA with automatic fallback to Google Gemini / DeepSeek / OpenAI)**.

> Late payments, awkward chasing, PayPal's hidden India receiving fees and uncertainty over whether rent can be covered are four major freelancer headaches. InvoicePilot solves them with AI automation, and never moves money without human approval.

---

## 🌟 What it does

| Pain point freelancers report | InvoicePilot feature |
|---|---|
| **Awkward, manual invoicing** | Type or speak: *"Bill Acme Corp (billing@acme.com) $500 for logo design, due in 7 days"* → real PayPal invoice drafted & sent |
| **"Will I have enough cash for rent?"** | **🛡️ Cash-Gap Shield**: Forecasts arrival dates using payment history and reliability scores, finds shortfalls against upcoming expenses, and suggests real actions |
| **Awkward chasing & over-chasing** | **Collections ladder** (*wait → friendly → firm → final → stop-chasing*). The agent follows strict guardrails and writes contextual reminders |
| **"When do I stop chasing?"** | At 45+ days overdue the agent pauses work and explains formal demand options |
| **Unpredictable client payment habits** | **Client reliability score** (0–100) and average days late, learned from observed payment events |
| **PayPal India fees eat 8–9%** | **Live FX Rates + Net INR Calculator**: Accounts for 4.4% PayPal fee + fixed fee + 18% GST + 4% FX conversion spread |
| **Flipping disputes** | **Evidence vault** (log delivery/approval proofs) and AI **dispute-response packets** built from invoice timelines and webhook events |
| **Rogue AI actions** | **Human-in-the-loop approvals**: Every invoice creation or reminder requires user approval before calling PayPal |

---

## 🏗️ Architecture

```
Browser (Next.js, AG Grid, Cash-Gap Shield, Chat with Voice input, Agent Controls & Audit Ledger)
   │
   ├─► /api/agent    ──► Multi-LLM Tool-use Engine (Groq Qwen-27B / Gemini 2.5 / DeepSeek)
   │                      Tools: create_invoice, list_invoices, get_client_insights,
   │                             plan_cash, send_reminder, issue_late_fee_invoice,
   │                             calc_net_receipt, record_evidence, get_dispute_packet
   │
   ├─► /api/agents/* ──► Autonomous Collections & Cash-Flow Agents with P1–P9 Policy Guardrails
   │
   ├─► /api/cashplan ──► Cash-Gap Shield deterministic forecasting & shortfall detection
   │
   ├─► /api/actions  ──► Executes user-approved actions against PayPal Invoicing API v2
   │
   ├─► /api/invoices ──► Live, uncached invoice statuses, client scores & fee metrics
   │
   └─◄ /api/webhook  ◄── PayPal webhooks (INVOICING.INVOICE.PAID, CUSTOMER.DISPUTE.*)
```

---

## 🚀 Quickstart (Run locally in 3 minutes)

### Prerequisites
- Node.js 18+
- PayPal Developer Account ([developer.paypal.com](https://developer.paypal.com))
- Groq API Key ([console.groq.com](https://console.groq.com/keys)) or Google Gemini Key ([aistudio.google.com](https://aistudio.google.com/apikey))

### Steps
```bash
git clone <this-repo>
cd invoicepilot
npm install
cp .env.example .env.local
```

Fill in `.env.local`:
```env
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_SECRET=your_sandbox_secret
PAYPAL_BASE=https://api-m.sandbox.paypal.com

GEMINI_API_KEY=your_gemini_api_key
AI_MODEL=gemini-2.5-flash
```

Run dev server:
```bash
npm run dev
# Open http://localhost:3000
```

---

## 🧪 Testing Notes for Judges

1. **Dashboard & Live Invoices**:
   - Open the web app. The dashboard loads live invoice records directly from the PayPal Invoicing API v2 sandbox.
2. **AI Invoice Creation & Approval Gate**:
   - In the chat box, type:
     > *"Bill Design Studio (design@example.com) $450 for brand identity, due in 7 days"*
   - The AI prepares the invoice and generates an **Approval Card**.
   - Click **Approve & send**. The button disables to prevent double-clicks, and PayPal sends the invoice.
3. **Paying an Invoice in Sandbox**:
   - Copy the generated `Client pay link` or open your PayPal sandbox buyer account.
   - Complete the payment with sandbox funds.
   - The invoice flips to **PAID** on the dashboard, updating the collection KPIs.
4. **Cash-Gap Shield**:
   - In the **Cash-Gap Shield** card, enter an upcoming expense (e.g., *"Studio Rent"*, `₹50,000`, date in 7 days).
   - Click **Check Shield**. It forecasts when open invoices will arrive based on client reliability and highlights any shortfall with real actionable fixes.

---

## ☁️ Deployment on Render

This project is configured with [`render.yaml`](./render.yaml) for 1-click deployment on Render:
1. Push to GitHub.
2. In Render, select **New Blueprint Instance** and connect the repository.
3. Supply `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, and `GEMINI_API_KEY`.
4. Deploy!

---

## 📄 License

[MIT](./LICENSE)
