import logger from "../config/logger";
import fs from "fs";

interface EmailAttachment {
  filename: string;
  /** Absolute path to the file on disk. */
  path: string;
  /** Content-ID referenced from HTML via `src="cid:<cid>"` for inline images. */
  cid: string;
}

interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  /** Optional rich HTML body. Falls back to `text` when omitted. */
  html?: string;
  /** Inline images (e.g. logos) referenced from `html` via cid:. */
  attachments?: EmailAttachment[];
}

// Uses Resend's HTTP API (plain HTTPS, never blocked by PaaS egress rules) when
// RESEND_API_KEY is set; otherwise falls back to SMTP via nodemailer, which is
// what local dev uses today.
export async function sendEmail({ to, subject, text, html, attachments }: SendEmailParams): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey) {
    const resendAttachments = attachments?.map((a) => ({
      filename: a.filename,
      content: fs.readFileSync(a.path).toString("base64"),
      content_id: a.cid,
    }));

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
        ...(resendAttachments?.length ? { attachments: resendAttachments } : {}),
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
    ...(attachments?.length
      ? { attachments: attachments.map((a) => ({ filename: a.filename, path: a.path, cid: a.cid })) }
      : {}),
  });
}
