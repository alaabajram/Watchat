// Sending email (admin password resets). Uses Resend's HTTP API when RESEND_API_KEY and EMAIL_FROM are set in
// Vercel; without them email is "not set up" and the screens offer the other ways to get back in.

export const emailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!emailReady()) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) console.error("[email] send failed", res.status);
  return res.ok;
}
