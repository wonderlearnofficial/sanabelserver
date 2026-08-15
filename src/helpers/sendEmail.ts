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

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    public readonly provider: "resend" | "smtp" | "configuration",
    public readonly statusCode = 503,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

// Uses Resend's HTTP API (plain HTTPS, never blocked by PaaS egress rules) when
// RESEND_API_KEY is set; otherwise falls back to SMTP via nodemailer, which is
// what local dev uses today.
export async function sendEmail({ to, subject, text, html, attachments }: SendEmailParams): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey) {
    if (!process.env.EMAIL_USER) {
      throw new EmailDeliveryError(
        "Email sender is not configured",
        "configuration",
      );
    }

    try {
      const resendAttachments = attachments?.map((a) => ({
        filename: a.filename,
        content: fs.readFileSync(a.path).toString("base64"),
        content_id: a.cid,
      }));
      const timeoutMs = Number(process.env.EMAIL_TIMEOUT_MS) || 10_000;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: globalThis.Response;

      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            from: process.env.EMAIL_USER,
            to: [to],
            subject,
            text,
            ...(html ? { html } : {}),
            ...(resendAttachments?.length ? { attachments: resendAttachments } : {}),
          }),
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.error("Email provider rejected request", {
          provider: "resend",
          providerStatus: response.status,
        });
        throw new EmailDeliveryError("Email provider rejected the request", "resend", 502);
      }
      return;
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      logger.error("Email provider request failed", { provider: "resend", error });
      throw new EmailDeliveryError("Email provider is unavailable", "resend");
    }
  }

  if (!process.env.MAIL_HOST || !process.env.MAIL_USERNAME || !process.env.MAIL_PASSWORD || !process.env.EMAIL_USER) {
    throw new EmailDeliveryError(
      "SMTP email service is not configured",
      "configuration",
    );
  }

  try {
    const nodemailer = (await import("nodemailer")).default;
    const timeoutMs = Number(process.env.EMAIL_TIMEOUT_MS) || 10_000;
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT) || 587,
      secure: process.env.MAIL_SECURE === "true",
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
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
  } catch (error) {
    logger.error("Email provider request failed", { provider: "smtp", error });
    throw new EmailDeliveryError("Email provider is unavailable", "smtp");
  }
}
