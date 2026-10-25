import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { Op } from "sequelize";
import { literal } from "@sequelize/core";
import logger from "../config/logger";

import User from "../models/user.model";
import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Admin from "../models/admin.model";
import Class from "../models/class.model";
import Organization from "../models/oraganization.model";
import AdminAuditLog from "../models/admin-audit-log.model";
import { recordAdminAction, userLabel } from "../helpers/adminAudit";
import {
  SESSION_LIMITS,
  defaultSessionPolicy,
  getSessionPolicy,
  saveSessionPolicy,
  validateSessionPolicy,
} from "../helpers/sessionPolicy";

/**
 * Super Admin platform control: sessions, account access, the activity log
 * and per-school data health. Every route here is mounted behind
 * `requireSuperAdmin`; nothing in this file scopes to a school on its own.
 */

const MAX_PAGE_SIZE = 100;

const positiveInt = (value: unknown): number | null => {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
};

const pagination = (page: unknown, limit: unknown, defaultLimit = 25) => {
  const pageNum = Math.min(positiveInt(page) ?? 1, 100000);
  const limitNum = Math.min(positiveInt(limit) ?? defaultLimit, MAX_PAGE_SIZE);
  return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
};

const actorOf = (req: Request): JwtPayload | undefined =>
  (req as Request & { user?: JwtPayload }).user;

const isDate = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(new Date(value).getTime());

/** User ids that belong to a school: its students, teachers and school admins. */
const schoolMemberIds = async (organizationId: number): Promise<number[]> => {
  const [students, teachers, admins] = await Promise.all([
    Student.findAll({ where: { organizationId }, attributes: ["userId"], raw: true }),
    Teacher.findAll({ where: { organizationId }, attributes: ["userId"], raw: true }),
    Admin.findAll({ where: { organizationId }, attributes: ["userId"], raw: true }),
  ]);
  return Array.from(
    new Set(
      [...students, ...teachers, ...admins]
        .map((row: any) => Number(row.userId))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type AccountStatus = "active" | "disabled" | "unverified";

export const accountStatus = (user: { isAccess?: unknown; disabledAt?: unknown }): AccountStatus =>
  user.isAccess ? "active" : user.disabledAt ? "disabled" : "unverified";

const STATUS_WHERE: Record<string, object> = {
  active: { isAccess: true },
  disabled: { isAccess: false, disabledAt: { [Op.ne]: null } },
  unverified: { isAccess: false, disabledAt: null },
  // Has an account but has never completed a password sign-in.
  never: { lastLoginAt: null },
};

const ROLES = ["Student", "Teacher", "Parent", "Admin"];

/**
 * GET /admin/sessions — every account with its sign-in state, most recently
 * active first. Filters: search, role, status, organizationId.
 */
export const listSessions = async (req: Request, res: Response) => {
  try {
    const { search, role, status, organizationId, page, limit } = req.query;
    const where: any = {};

    if (role !== undefined && role !== "") {
      if (typeof role !== "string" || !ROLES.includes(role)) {
        return res.status(400).json({ message: `role must be one of ${ROLES.join(", ")}`, field: "role" });
      }
      where.role = role;
    }
    if (status !== undefined && status !== "") {
      if (typeof status !== "string" || !Object.prototype.hasOwnProperty.call(STATUS_WHERE, status)) {
        return res.status(400).json({
          message: `status must be one of ${Object.keys(STATUS_WHERE).join(", ")}`,
          field: "status",
        });
      }
      Object.assign(where, STATUS_WHERE[status]);
    }
    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      where[Op.or] = [
        { firstName: { [Op.like]: term } },
        { lastName: { [Op.like]: term } },
        { email: { [Op.like]: term } },
      ];
    }
    if (organizationId !== undefined && organizationId !== "") {
      const orgId = positiveInt(organizationId);
      if (!orgId) {
        return res.status(400).json({ message: "organizationId must be a positive integer", field: "organizationId" });
      }
      const ids = await schoolMemberIds(orgId);
      where.id = { [Op.in]: ids.length ? ids : [0] };
    }

    const { pageNum, limitNum, offset } = pagination(page, limit);
    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "role",
        "isAccess",
        "disabledAt",
        "lastLoginAt",
        "lastActiveAt",
        "lastLoginUserAgent",
        "createdAt",
      ],
      // Most recently active first; accounts that never signed in last.
      order: [
        [literal("`lastActiveAt` IS NULL") as any, "ASC"],
        ["lastActiveAt", "DESC"],
        ["id", "ASC"],
      ],
      limit: limitNum,
      offset,
    });

    return res.status(200).json({
      data: rows.map((row) => ({ ...row.toJSON(), status: accountStatus(row) })),
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    logger.error("Error in listSessions:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/** POST /admin/users/:userId/sign-out — ends every session of one account. */
export const signOutUser = async (req: Request, res: Response) => {
  try {
    const userId = positiveInt(req.params.userId);
    if (!userId) return res.status(400).json({ message: "Invalid user id" });

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    await user.update({ tokenVersion: (user.tokenVersion || 0) + 1 });
    await recordAdminAction(req, {
      action: "user.sign_out",
      targetType: "user",
      targetId: user.id,
      targetLabel: userLabel(user),
      details: { role: user.role },
    });

    return res.status(200).json({ message: "Signed out of every device" });
  } catch (error) {
    logger.error("Error in signOutUser:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * PATCH /admin/users/:userId/access — `{ enabled: boolean }`.
 *
 * Disabling also ends every session, since the auth middleware already
 * refuses a disabled account on its next request but a refresh token minted
 * before would otherwise stay valid until then.
 */
export const setUserAccess = async (req: Request, res: Response) => {
  try {
    const userId = positiveInt(req.params.userId);
    if (!userId) return res.status(400).json({ message: "Invalid user id" });

    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled must be a boolean", field: "enabled" });
    }
    if (actorOf(req)?.id === userId && !enabled) {
      return res.status(400).json({ message: "You cannot disable your own account" });
    }

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (enabled) {
      // Re-enabling only undoes an administrator's disable. An account that
      // never verified its email stays unverified.
      if (!user.disabledAt) {
        return res.status(409).json({ message: "This account was not disabled by an administrator" });
      }
      await user.update({ isAccess: true, disabledAt: null } as any);
    } else {
      // Disabling an unverified account would let a later "enable" activate
      // it without the email ever being verified.
      if (!user.isAccess && !user.disabledAt) {
        return res.status(409).json({ message: "This account is not verified yet, so there is nothing to disable" });
      }
      await user.update({
        isAccess: false,
        disabledAt: new Date(),
        tokenVersion: (user.tokenVersion || 0) + 1,
      } as any);
    }

    await recordAdminAction(req, {
      action: enabled ? "user.enable" : "user.disable",
      targetType: "user",
      targetId: user.id,
      targetLabel: userLabel(user),
      details: { role: user.role },
    });

    return res.status(200).json({ message: enabled ? "Account enabled" : "Account disabled", status: accountStatus(user) });
  } catch (error) {
    logger.error("Error in setUserAccess:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/** POST /admin/organizations/:organizationId/sign-out — every member of one school. */
export const signOutOrganization = async (req: Request, res: Response) => {
  try {
    const organizationId = positiveInt(req.params.organizationId);
    if (!organizationId) return res.status(400).json({ message: "Invalid organization id" });

    const organization = await Organization.findByPk(organizationId);
    if (!organization) return res.status(404).json({ message: "Organization not found" });

    const actorId = actorOf(req)?.id;
    const ids = (await schoolMemberIds(organizationId)).filter((id) => id !== actorId);
    if (ids.length) {
      await User.increment("tokenVersion", { by: 1, where: { id: { [Op.in]: ids } } as any });
    }

    await recordAdminAction(req, {
      action: "organization.sign_out",
      targetType: "organization",
      targetId: organization.id,
      targetLabel: organization.name,
      organizationId: organization.id,
      details: { accounts: ids.length },
    });

    return res.status(200).json({ message: "School signed out", accounts: ids.length });
  } catch (error) {
    logger.error("Error in signOutOrganization:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * POST /admin/sessions/sign-out-all — `{ confirm: true }`. Every account on
 * the platform except the admin doing it. The explicit confirmation keeps a
 * stray request from logging out every student at once.
 */
export const signOutEveryone = async (req: Request, res: Response) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ message: "confirm must be true", field: "confirm" });
    }
    const actorId = actorOf(req)?.id ?? 0;
    const others = { id: { [Op.ne]: actorId } } as any;
    const accounts = await User.count({ where: others });
    await User.increment("tokenVersion", { by: 1, where: others });

    await recordAdminAction(req, {
      action: "platform.sign_out_all",
      targetType: "platform",
      targetLabel: "all accounts",
      details: { accounts },
    });

    return res.status(200).json({ message: "Everyone signed out", accounts });
  } catch (error) {
    logger.error("Error in signOutEveryone:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/**
 * GET /admin/audit-log — newest first. Filters: action (exact, or a prefix
 * ending in "." such as "user."), actorUserId, organizationId, search (actor
 * email or target), from / to (ISO dates, inclusive day range).
 */
export const listAuditLog = async (req: Request, res: Response) => {
  try {
    const { action, actorUserId, organizationId, search, from, to, page, limit } = req.query;
    const where: any = {};

    if (typeof action === "string" && action) {
      where.action = action.endsWith(".") ? { [Op.like]: `${action}%` } : action;
    }
    if (actorUserId !== undefined && actorUserId !== "") {
      const id = positiveInt(actorUserId);
      if (!id) return res.status(400).json({ message: "actorUserId must be a positive integer", field: "actorUserId" });
      where.actorUserId = id;
    }
    if (organizationId !== undefined && organizationId !== "") {
      const id = positiveInt(organizationId);
      if (!id) return res.status(400).json({ message: "organizationId must be a positive integer", field: "organizationId" });
      where.organizationId = id;
    }
    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      where[Op.or] = [{ actorEmail: { [Op.like]: term } }, { targetLabel: { [Op.like]: term } }];
    }
    const range: any = {};
    if (from !== undefined && from !== "") {
      if (!isDate(from)) return res.status(400).json({ message: "from must be a date", field: "from" });
      range[Op.gte] = new Date(from);
    }
    if (to !== undefined && to !== "") {
      if (!isDate(to)) return res.status(400).json({ message: "to must be a date", field: "to" });
      const end = new Date(to);
      end.setUTCHours(23, 59, 59, 999);
      range[Op.lte] = end;
    }
    if (Reflect.ownKeys(range).length) where.createdAt = range;

    const { pageNum, limitNum, offset } = pagination(page, limit, 50);
    const { rows, count } = await AdminAuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit: limitNum,
      offset,
    });

    // School names for the rows on this page, in one query.
    const orgIds = Array.from(
      new Set(rows.map((row) => row.organizationId).filter((id): id is number => typeof id === "number")),
    );
    const organizations = orgIds.length
      ? await Organization.findAll({ where: { id: { [Op.in]: orgIds } } as any, attributes: ["id", "name"], raw: true })
      : [];
    const nameOf = new Map(organizations.map((org: any) => [org.id, org.name]));

    return res.status(200).json({
      data: rows.map((row) => ({
        ...row.toJSON(),
        organizationName: row.organizationId ? nameOf.get(row.organizationId) ?? null : null,
      })),
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    logger.error("Error in listAuditLog:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Data health per school
// ---------------------------------------------------------------------------

const countBy = (rows: any[]): Map<number, number> =>
  new Map(rows.map((row) => [Number(row.organizationId), Number(row.count)]));

/**
 * GET /admin/data-quality/schools — the problems in each school, worst first.
 * Every count is something an operator can fix on the school's page.
 */
export const dataQualityBySchool = async (_req: Request, res: Response) => {
  try {
    const grouped = (model: any, where: object) =>
      model.findAll({
        where: { ...where, organizationId: { [Op.ne]: null } },
        attributes: ["organizationId", [literal("COUNT(*)"), "count"]],
        group: ["organizationId"],
        raw: true,
      });

    const [organizations, noClass, noGrade, classNoTeacher, classNoGrade, teachers, assignedTeachers] =
      await Promise.all([
        Organization.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]], raw: true }),
        grouped(Student, { classId: null }),
        grouped(Student, { gradeId: null }),
        grouped(Class, { teacherId: null }),
        grouped(Class, { gradeId: null }),
        Teacher.findAll({
          where: { organizationId: { [Op.ne]: null } } as any,
          attributes: ["id", "organizationId"],
          raw: true,
        }),
        Class.findAll({
          where: { teacherId: { [Op.ne]: null } } as any,
          attributes: ["teacherId"],
          raw: true,
        }),
      ]);

    // Teachers who teach no class, per school.
    const teaching = new Set(assignedTeachers.map((row: any) => Number(row.teacherId)));
    const idleTeachers = new Map<number, number>();
    for (const teacher of teachers as any[]) {
      if (teaching.has(Number(teacher.id))) continue;
      const orgId = Number(teacher.organizationId);
      idleTeachers.set(orgId, (idleTeachers.get(orgId) ?? 0) + 1);
    }

    const maps = {
      studentsWithoutClass: countBy(noClass),
      studentsWithoutGrade: countBy(noGrade),
      classesWithoutTeacher: countBy(classNoTeacher),
      classesWithoutGrade: countBy(classNoGrade),
      teachersWithoutClass: idleTeachers,
    };

    const schools = (organizations as any[])
      .map((org) => {
        const counts = Object.fromEntries(
          Object.entries(maps).map(([key, map]) => [key, map.get(Number(org.id)) ?? 0]),
        ) as Record<keyof typeof maps, number>;
        const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
        return { organizationId: org.id, name: org.name, counts, total };
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    return res.status(200).json({ data: schools });
  } catch (error) {
    logger.error("Error in dataQualityBySchool:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/** GET /admin/settings/session — the current token lifetimes and their bounds. */
export const getSessionSettings = (_req: Request, res: Response) =>
  res.status(200).json({
    data: { policy: getSessionPolicy(), defaults: defaultSessionPolicy(), limits: SESSION_LIMITS },
  });

/**
 * PATCH /admin/settings/session — sets both lifetimes.
 * Body: { accessTokenMinutes, refreshTokenDays }. Applies to new tokens at once
 * and to existing ones on their next use.
 */
export const updateSessionSettings = async (req: Request, res: Response) => {
  try {
    const checked = validateSessionPolicy(req.body);
    if (!("policy" in checked)) {
      return res.status(400).json({ message: checked.message, field: checked.field });
    }
    const previous = getSessionPolicy();
    const policy = await saveSessionPolicy(checked.policy);

    await recordAdminAction(req, {
      action: "platform.session_policy",
      targetType: "platform",
      targetLabel: "Session lifetime",
      details: { previous, next: policy },
    });

    return res.status(200).json({
      data: { policy, defaults: defaultSessionPolicy(), limits: SESSION_LIMITS },
    });
  } catch (error) {
    logger.error("Error in updateSessionSettings:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
