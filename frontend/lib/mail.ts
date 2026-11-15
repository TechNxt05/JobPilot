import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing mail for the daily digest. Uses any SMTP server; for one person, Gmail with an app password works:
 * SMTP_USER=you@gmail.com, SMTP_PASS=<16-letter app password>. (Same as Supabase's sign-in email setup.)
 */
export const mailConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

export async function sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  if (!mailConfigured()) throw new Error("Email isn't set up on this server (SMTP_USER / SMTP_PASS).");
  const port = Number(process.env.SMTP_PORT) || 465;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: process.env.MAIL_FROM || `JobPilot <${process.env.SMTP_USER}>`, ...msg });
}

export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}
