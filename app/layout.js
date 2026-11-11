import "./globals.css";

export const metadata = {
  title: "InvoicePilot: Autonomous Collections & Cash-Gap Shield on PayPal",
  description: "Autonomous collections agent and Cash-Gap Shield for freelancers billing international clients on PayPal.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
