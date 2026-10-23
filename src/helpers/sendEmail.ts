import logger from "../config/logger";
import fs from "fs";
import { createHash } from "crypto";
import EmailEvent, { EmailPurpose } from "../models/email-event.model";

interface EmailAttachment {
  filename: string;
  /** Absolute path to the file on disk. */
  path: string;
  /** Content-ID referenced from HTML via `src="cid:<cid>"` for inline images. */
  cid: string;
}

interface SendEmailParams {
  to: string;
  purpose?: EmailPurpose;
  userId?: number | null;
  subject: string;
  text: string;
  /** Optional rich HTML body. Falls back to `text` when omitted. */
  html?: string;
  /** Inline images (e.g. logos) referenced from `html` via cid:. */
  attachments?: EmailAttachment[];
}

type EmailProvider = "resend" | "smtp" | "configuration";

const recipientHash = (recipient: string) =>
  createHash("sha256").update(recipient.trim().toLowerCase()).digest("hex");

const recordEmailEvent = async (params: {
  to: string;
  userId?: number | null;
  purpose: EmailPurpose;
  provider: EmailProvider;
  providerMessageId?: string | null;
  status: "send_accepted" | "send_failed";
  failureCode?: string | null;
  failureCategory?: string | null;
}) => {
  try {
    await EmailEvent.create({
      userId: params.userId ?? null,
      recipientHash: recipientHash(params.to),
      purpose: params.purpose,
      provider: params.provider,
      providerMessageId: params.providerMessageId ?? null,
      status: params.status,
      failureCode: params.failureCode ?? null,
      failureCategory: params.failureCategory ?? null,
    });
  } catch (error) {
    // Telemetry is deliberately non-blocking. Email delivery and account
    // recovery must continue if the event table is unavailable.
    logger.warn("Email telemetry write failed", { error });
  }
};

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
export async function sendEmail({
  to,
  purpose = "ACCOUNT_NOTIFICATION",
  userId = null,
  subject,
  text,
  html,
  attachments,
}: SendEmailParams): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey) {
    if (!process.env.EMAIL_USER) {
      await recordEmailEvent({
        to, userId, purpose, provider: "configuration", status: "send_failed",
        failureCode: "EMAIL_SENDER_MISSING", failureCategory: "configuration",
      });
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
        const deliveryError = new EmailDeliveryError("Email provider rejected the request", "resend", 502);
        await recordEmailEvent({
          to, userId, purpose, provider: "resend", status: "send_failed",
          failureCode: `HTTP_${response.status}`, failureCategory: "provider_rejected",
        });
        throw deliveryError;
      }
      let providerMessageId: string | null = null;
      try {
        const body = await response.json() as { id?: unknown };
        providerMessageId = typeof body.id === "string" ? body.id : null;
      } catch {
        // Acceptance is authoritative even when the provider response body is
        // absent or malformed; the message id is optional telemetry.
      }
      await recordEmailEvent({
        to, userId, purpose, provider: "resend", providerMessageId,
        status: "send_accepted",
      });
      return;
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      logger.error("Email provider request failed", { provider: "resend", error });
      await recordEmailEvent({
        to, userId, purpose, provider: "resend", status: "send_failed",
        failureCode: error instanceof Error ? error.name.slice(0, 80) : "UNKNOWN",
        failureCategory: error instanceof Error && error.name === "AbortError" ? "timeout" : "provider_unavailable",
      });
      throw new EmailDeliveryError("Email provider is unavailable", "resend");
    }
  }

  if (!process.env.MAIL_HOST || !process.env.MAIL_USERNAME || !process.env.MAIL_PASSWORD || !process.env.EMAIL_USER) {
    await recordEmailEvent({
      to, userId, purpose, provider: "configuration", status: "send_failed",
      failureCode: "SMTP_CONFIGURATION_INCOMPLETE", failureCategory: "configuration",
    });
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

    const result = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
      ...(attachments?.length
        ? { attachments: attachments.map((a) => ({ filename: a.filename, path: a.path, cid: a.cid })) }
        : {}),
    });
    await recordEmailEvent({
      to, userId, purpose, provider: "smtp",
      providerMessageId: typeof result.messageId === "string" ? result.messageId : null,
      status: "send_accepted",
    });
  } catch (error) {
    logger.error("Email provider request failed", { provider: "smtp", error });
    await recordEmailEvent({
      to, userId, purpose, provider: "smtp", status: "send_failed",
      failureCode: error instanceof Error ? error.name.slice(0, 80) : "UNKNOWN",
      failureCategory: "provider_unavailable",
    });
    throw new EmailDeliveryError("Email provider is unavailable", "smtp");
  }
}
