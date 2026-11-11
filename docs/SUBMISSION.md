# Devpost Submission Kit: InvoicePilot
**PayPal AI Hackathon 2026** | **Owner:** Visshaal Ramachandran | **Deadline:** 13 Nov 2026, 1:30 AM IST

---

## 1. Project Information for Devpost

### Project Name
**InvoicePilot**

### Tagline
An approval-gated AI collections agent & Cash-Gap Shield for freelancers who bill international clients through PayPal.

### Category
Agentic Commerce / Freelancer FinTech

---

## 2. Description (Copy & Paste into Devpost)

### Inspiration
Cross-border invoicing is full of hidden traps for Indian and international freelancers:
1. **The PayPal India Fee Leak**: Freelancers invoice $500 expecting ₹43,500, but actually receive ~₹39,560 after PayPal's 4.4% cross-border fee, fixed fee, 18% GST on processing fees, and a 4% currency conversion spread.
2. **Awkward, Inconsistent Chasing**: Chasing late clients feels uncomfortable, over-chasing good clients destroys relationships, and freelancers never know when to stop chasing bad debts.
3. **The Rent Uncertainty ("Cash Gap")**: Freelancers cannot answer: *"Will I have enough cash in the bank when rent is due next week?"* because payment dates are unpredictable.

We built **InvoicePilot** to give freelancers an autonomous money agent that creates real PayPal invoices, manages collection ladders, and forecasts cash shortfalls—while keeping the human strictly in control before any money moves.

---

### What it Does
- **Conversational Invoicing with Approvals**: Say or type *"Bill Acme Corp (billing@acme.com) $500 for logo design, due in 7 days"*. The agent validates the inputs and prepares an approval card. One click creates and sends a real invoice via the PayPal Invoicing API v2. Double-click prevention ensures zero duplicate invoices.
- **🛡️ Cash-Gap Shield**: Input an upcoming bill (e.g. ₹50,000 rent on the 20th). The deterministic engine forecasts when open invoices will arrive based on past payment behavior and reliability scores, calculates net INR after fees, flags any shortfall before the bill date, and suggests **real actions only** (chasing overdue clients today or issuing milestone bills).
- **Collections Ladder (Behavioral Guardrails)**: The AI strictly follows 5 stages: *Wait → Friendly Nudge → Firm Notice → Final Warning → Stop Chasing*. Good clients aren't harassed, and overdue clients past 45 days trigger a firm recommendation to stop chasing and pause work.
- **Client Reliability Scoring (0–100)**: Learns from real payment transitions and webhooks, calculating average days late and dynamic reliability scores.
- **Transparent Fee & Net-INR Engine**: Fetches live USD/INR exchange rates (cached server-side for 1 hour) and displays the true net INR receipts. Offers optional fee pass-through invoices that gross up the fee transparently.
- **Evidence Vault & AI Dispute Defense**: Records proofs of delivery and client sign-offs. Generates a structured dispute-response packet if a chargeback occurs.

---

### How We Built It
- **PayPal Invoicing API v2 & Webhooks**: Integrated `/v2/invoicing/invoices` for draft creation, automatic numbering, sending, and reminder delivery. Real-time webhook listener for `INVOICING.INVOICE.PAID` and `CUSTOMER.DISPUTE.*` events with signature verification.
- **Multi-LLM Agentic Engine**: Powered by **Groq ultra-fast LLaMA/Qwen** and **Google Gemini** (with Anthropic Claude & DeepSeek support) using OpenAI-compatible tool calling across financial tools, plus batched structured output for autonomous collection evaluations.
- **Autonomous Collections & Cash-Flow Agents**: A background loop evaluates overdue invoices, checks policy guardrails (P1–P9), and queues or sends PayPal reminders via `POST /v2/invoicing/invoices/{id}/remind` (recorded with HTTP 204).
- **Frontend & Full Stack**: Built on **Next.js 14 (App Router)** with **AG Grid Community** for responsive invoice management, Web Speech Recognition for voice commands, and **Render** for cloud deployment with automated cron runners.
- **Deterministic Cash Engine**: Built a pure, mathematical cash-flow projection model (`lib/cashgap.js` and `lib/rates.js`) so the LLM never hallucinates fee calculations or cash shortfalls.

---

### Challenges We Ran Into
1. **Invoice Number Collisions**: Calling PayPal's next-number endpoint caused duplicate invoice number errors during fast testing. We resolved this by delegating numbering entirely to PayPal's internal generator.
2. **Next.js 14 Cache Traps**: Next.js Data Cache cached PayPal GET responses, causing invoices to appear unpaid after payment. We solved this with `cache: "no-store"`, route-level `revalidate = 0`, and `dynamic = "force-dynamic"`.
3. **Gemini Tool Calling Edge Cases**: Gemini occasionally returns `content: null` during tool-call dispatches, which rejected subsequent turns. We normalized the conversation history so every assistant turn carries clean string content.

---

### Accomplishments We're Proud Of
- A complete, working loop against the live PayPal sandbox: prompt → approval gate → PayPal send → sandbox client payment → instant PAID transition on dashboard.
- **Cash-Gap Shield**: A feature absent in generic invoice-chat apps that bridges client receivables with real freelancer life expenses (like rent and software bills).
- 100% adherence to security: Zero secrets committed, pure environment variable isolation, and human approval on all money-moving actions.

---

### What's Next for InvoicePilot
- WhatsApp & Slack bots for on-the-go billing and instant payment notifications.
- Multi-currency client portfolios with EUR/GBP/USD cross-hedging alerts.
- Automated recurring subscription invoices for retainer clients.

---

## 3. Demo Video Script (Target: 2:30)

| Time | Visual | Voiceover / Action |
|---|---|---|
| **0:00 - 0:20** | Dashboard & Fee Leak KPI | *"Freelancers invoicing abroad lose up to 9% to fees, GST, and FX markups—a $500 invoice doesn't equal ₹43,500. Worse, rent is due next week and you don't know who will pay in time. Meet InvoicePilot."* |
| **0:20 - 1:05** | Chat & Approval Card | Type: *"Bill Design Agency (client@example.com) $450 for brand identity, due in 7 days"*. Show the AI preparing the invoice. Point to the **Approval Card** (*"Notice the AI cannot move money without our permission"*). Click **Approve & send**. Button disables to prevent duplicates. Real PayPal invoice sent. |
| **1:05 - 1:35** | Sandbox Payment & Live Update | Open sandbox payment link in incognito tab. Pay with sandbox buyer. Show the dashboard instantly updating the invoice status to **PAID** with fresh collected INR. |
| **1:35 - 2:15** | 🛡️ Cash-Gap Shield in Action | In the Cash-Gap Shield card, enter: *"Studio Rent"*, `₹50,000`, due in 5 days. Click **Check Shield**. Show the **Red Shortfall Banner** highlighting the exact cash gap. Point out the recommended real action: *"Chase overdue invoice #0002"*. Click **"Chase in AI"** to draft a contextual reminder following the collections ladder. |
| **2:15 - 2:30** | Tech Stack & Wrap-Up | Show architecture slide: Next.js + PayPal Invoicing v2 + Gemini 2.5 Flash + Render. *"Open source, approval-gated, and built for international freelancers."* |

---

## 4. Submission Checklist

- [x] Code audited: No credentials or secrets committed (`.gitignore` protects `.env.local` and `.data`).
- [x] Universal client creation tested (no hardcoded names or emails).
- [x] Cash-Gap Shield built, tested, and verified with deterministic logic.
- [x] Production build clean: `npm run build` exits with code 0.
- [x] Hosted configuration ready: `render.yaml` with environment blueprints.
- [x] README and LICENSE (MIT) documented.
- [ ] Push to GitHub public repository.
- [ ] Connect repo to Render and deploy.
- [ ] Record demo video using the script above (< 3 mins, public YouTube link).
- [ ] Submit on Devpost before deadline!
