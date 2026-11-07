import { Request, Response } from "express";
import { Op } from "sequelize";
import AccountDeletionRequest from "../models/account-deletion-request.model";
import User from "../models/user.model";
import logger from "../config/logger";
import { sendEmail } from "../helpers/sendEmail";
import { recordAdminAction } from "../helpers/adminAudit";

const ACCOUNT_TYPES = ["student", "teacher", "parent"] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const ACCEPTED = {
  success: true,
  message: "Your request was received. We will delete the account and contact you by email.",
};

/** Tells the administrators by email, when an address is configured. Never blocks or fails the request. */
const notifyAdmins = async (request: AccountDeletionRequest): Promise<void> => {
  const to = process.env.DELETION_REQUEST_EMAIL;
  if (!to) return;
  try {
    await sendEmail({
      to,
      purpose: "ACCOUNT_NOTIFICATION",
      subject: "Sanabel: a new account deletion request",
      text:
        `A person asked to delete their Sanabel account (request #${request.id}).\n\n` +
        `Name: ${request.fullName}\nContact: ${request.contactEmail}\n` +
        `Account: ${request.accountIdentifier}\nSchool: ${request.schoolName ?? "-"}\n` +
        `Matched an account: ${request.userId ? "yes" : "no"}\n\n` +
        `Review it in the Admin console and delete the account there.`,
    });
  } catch (error) {
    logger.warn("Deletion request email failed (non-fatal)", { requestId: request.id, error });
  }
};

/**
 * POST /account-deletion/requests (public, rate limited).
 * Always answers the same way, so it never reveals whether an account exists.
 */
export const createPublicRequest = async (req: Request, res: Response): Promise<void> => {
  const fullName = clean(req.body?.fullName, 120);
  const contactEmail = clean(req.body?.contactEmail, 255).toLowerCase();
  const accountIdentifier = clean(req.body?.accountIdentifier, 255);
  if (!fullName || !accountIdentifier || !EMAIL_PATTERN.test(contactEmail)) {
    res.status(400).json({
      success: false,
      message: "Enter your name, a valid contact email and your account username or email.",
    });
    return;
  }
  const typed = clean(req.body?.accountType, 16);
  const accountType = (ACCOUNT_TYPES as readonly string[]).includes(typed) ? typed : null;
  try {
    let matched: User | null = null;
    for (const email of [accountIdentifier.toLowerCase(), contactEmail]) {
      matched = await User.findOne({ where: { email } });
      if (matched) break;
    }
    const request = await AccountDeletionRequest.create({
      fullName,
      contactEmail,
      accountIdentifier,
      accountType,
      schoolName: clean(req.body?.schoolName, 160) || null,
      details: clean(req.body?.details, 1000) || null,
      source: "web",
      userId: matched?.id ?? null,
    });
    void notifyAdmins(request);
    res.status(202).json(ACCEPTED);
  } catch (error) {
    logger.error("Error creating deletion request", { error });
    res.status(500).json({ success: false, message: "We could not save your request. Try again later." });
  }
};

/** POST /account-deletion/mine (signed in, from inside the app). */
export const createOwnRequest = async (req: Request, res: Response): Promise<void> => {
  const userId = Number((req as Request & { user?: { id?: number } }).user?.id);
  if (!userId) {
    res.status(401).json({ success: false, message: "Sign in to request deletion from the app." });
    return;
  }
  try {
    const user = await User.findByPk(userId);
    if (!user) {
      res.status(404).json({ success: false, message: "Account not found." });
      return;
    }
    const open = await AccountDeletionRequest.findOne({ where: { userId, status: "pending" } });
    if (open) {
      res.status(200).json({ ...ACCEPTED, alreadyRequested: true });
      return;
    }
    const request = await AccountDeletionRequest.create({
      fullName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email,
      contactEmail: user.email,
      accountIdentifier: user.email,
      accountType: String(user.role ?? "").toLowerCase() || null,
      details: clean(req.body?.details, 1000) || null,
      source: "app",
      userId,
    });
    void notifyAdmins(request);
    res.status(201).json(ACCEPTED);
  } catch (error) {
    logger.error("Error creating own deletion request", { error });
    res.status(500).json({ success: false, message: "We could not save your request. Try again later." });
  }
};

/**
 * GET /admin/deletion-requests?status=pending|done|rejected&search=&page=&limit= (Super Admin).
 * Paged like the other admin lists: { data, total, page, limit }, newest first.
 */
export const listRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = String(req.query.status ?? "");
    const search = String(req.query.search ?? "").trim();
    const where: any = {};
    if (["pending", "done", "rejected"].includes(status)) where.status = status;
    if (search) {
      const term = `%${search}%`;
      where[Op.or] = [
        { fullName: { [Op.like]: term } },
        { contactEmail: { [Op.like]: term } },
        { accountIdentifier: { [Op.like]: term } },
      ];
    }
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "25"), 10) || 25, 1), 100);
    const page = Math.max(Number.parseInt(String(req.query.page ?? "1"), 10) || 1, 1);
    const { rows, count } = await AccountDeletionRequest.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    });
    res.json({ data: rows.map((row) => row.toJSON()), total: count, page, limit });
  } catch (error) {
    logger.error("Error listing deletion requests", { error });
    res.status(500).json({ message: "Internal Server Error" });
  }
};

/** PATCH /admin/deletion-requests/:id  { status: "done" | "rejected" | "pending" } (Super Admin). */
export const updateRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? "");
    if (!id || !["pending", "done", "rejected"].includes(status)) {
      res.status(400).json({ message: "Invalid request id or status" });
      return;
    }
    const row = await AccountDeletionRequest.findByPk(id);
    if (!row) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    const actorId = Number((req as Request & { user?: { id?: number } }).user?.id) || null;
    await row.update({
      status: status as any,
      handledByUserId: status === "pending" ? null : actorId,
      handledAt: status === "pending" ? null : new Date(),
    });
    await recordAdminAction(req, {
      action: "deletion_request.update",
      targetType: "user",
      targetId: row.userId ?? null,
      targetLabel: `request #${row.id}: ${status}`,
    });
    res.json({ request: row });
  } catch (error) {
    logger.error("Error updating deletion request", { error });
    res.status(500).json({ message: "Internal Server Error" });
  }
};
