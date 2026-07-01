import logger from "../config/logger";

interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  /** Optional rich HTML body. Falls back to `text` when omitted. */
  html?: string;
}

// Uses Resend's HTTP API (plain HTTPS, never blocked by PaaS egress rules) when
// RESEND_API_KEY is set; otherwise falls back to SMTP via nodemailer, which is
// what local dev uses today.
export async function sendEmail({ to, subject, text, html }: SendEmailParams): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_USER,
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error("Resend API error:", { status: response.status, body });
      throw new Error(`Resend API error (${response.status}): ${body}`);
    }
    return;
  }

  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });
}
