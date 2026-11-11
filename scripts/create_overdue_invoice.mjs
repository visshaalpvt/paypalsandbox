import { createAndSendInvoice } from "../lib/paypal.js";

async function createOverdue() {
  console.log("=== Creating Fresh Overdue Invoice on PayPal Sandbox ===");
  try {
    const result = await createAndSendInvoice({
      clientName: "Marcus Vance",
      email: "marcus.vance@brandstudio.example.com",
      items: [
        { name: "Brand & Design Sprint", amount: 750 }
      ],
      currency: "USD",
      dueDays: 7,
      backdateDays: 16, // Makes it 9 days overdue today
      note: "Design sprint deliverables completed."
    });
    console.log("Invoice created successfully!");
    console.log("ID:", result.id);
    console.log("Invoice Number:", result.invoice_number);
    console.log("Due Date:", result.due);
    console.log("Pay Link:", result.payLink);
  } catch (err) {
    console.error("Error creating invoice:", err.message);
  }
}

createOverdue();
