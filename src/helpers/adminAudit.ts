import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";
import logger from "../config/logger";
import AdminAuditLog from "../models/admin-audit-log.model";

/**
 * Records one administrative action in `AdminAuditLogs`.
 *
 * Call it after the action has succeeded. Like the import-run recorder it
 * never throws: the change is already made, and losing a log row must not
 * turn a successful operation into an error for the operator.
 *
 * Store identifiers and short labels only. Never a password, a token, a
 * connect code or a row of imported data.
 */
export type AdminAuditAction =
  | "user.create"
  | "user.update"
  | "user.delete"
  | "user.reset_password"
  | "user.sign_out"
  | "user.disable"
  | "user.enable"
  | "student.update"
  | "student.delete"
  | "student.link_parent"
  | "student.unlink_parent"
  | "student.impersonate"
  | "organization.create"
  | "organization.update"
  | "organization.delete"
  | "organization.sign_out"
  | "platform.sign_out_all"
  | "platform.session_policy"
  | "class.create"
  | "class.update"
  | "class.delete"
  | "grade.create"
  | "grade.update"
  | "grade.delete"
  | "grade.import"
  | "import.batch"
  | "app_version.update"
  | "leaderboard.update";

export interface AdminAuditEntry {
  action: AdminAuditAction;
  targetType?: "user" | "student" | "organization" | "class" | "grade" | "platform" | "import";
  targetId?: number | null;
  targetLabel?: string | null;
  /** The school the action affected, when there is one. */
  organizationId?: number | null;
  details?: Record<string, unknown> | null;
}

export const recordAdminAction = async (req: Request, entry: AdminAuditEntry): Promise<void> => {
  try {
    const actor = (req as Request & { user?: JwtPayload }).user;
    const actorScope = (req as Request & { adminOrganizationId?: number | null }).adminOrganizationId;
    await AdminAuditLog.create({
      actorUserId: actor?.id ?? null,
      actorEmail: typeof actor?.email === "string" ? actor.email.slice(0, 255) : null,
      actorOrganizationId: actorScope ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel ? entry.targetLabel.slice(0, 255) : null,
      // A School Admin's actions always land in their own school.
      organizationId: entry.organizationId ?? actorScope ?? null,
      details: entry.details ?? null,
    });
  } catch (error) {
    logger.warn("Failed to record admin action (non-fatal)", { action: entry.action, error });
  }
};

/** "First Last <email>", or whichever parts exist. */
export const userLabel = (user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
} | null | undefined): string | null => {
  if (!user) return null;
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  if (name && user.email) return `${name} <${user.email}>`;
  return name || user.email || null;
};
