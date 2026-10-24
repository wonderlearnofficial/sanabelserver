import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import logger from "../config/logger";

import User from "../models/user.model";
import Student from "../models/student.model";
import StudentTask from "../models/student-task.model";
import StudentChallenge from "../models/student-challenge.model";
import Challenge from "../models/challenge.model";
import Task from "../models/task.model";
import TaskCategory from "../models/task-category.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Organization, { OrganizationType } from "../models/oraganization.model";
import Tree from "../models/tree.model";
import Admin from "../models/admin.model";
import { QueryTypes } from "sequelize";
import { literal } from "@sequelize/core";
import { signAccessToken, signRefreshToken } from "../helpers/tokens";
import { generatePassword } from "../helpers/generatePassword";
import generateUniqueConnectCode from "../helpers/generateRandomconnectcode";
import { getImportField } from "../helpers/importFieldLookup";
import { ImportFailure, describeRowError, importRowNumber, rowFailure } from "../helpers/importRow";
import {
  InvalidOptionalIdError,
  parseOptionalPositiveId,
} from "../helpers/optionalId";
import { buildCategoryCounts } from "../helpers/taskCategoryStats";
import {
  RelationshipValidationError,
  resolveStudentRelationships,
  validateGradeForOrganization,
} from "../helpers/organizationRelationships";
import crypto from "crypto";
import AdminImpersonationHandoff from "../models/admin-impersonation-handoff.model";
import ImportRun from "../models/import-run.model";
import { IMPORT_RUN_GRANULARITY_NOTE, recordImportRun } from "../helpers/importRunRecorder";
import { recordAdminAction, userLabel } from "../helpers/adminAudit";

const DEFAULT_RESET_PASSWORD = "changeme123";

// Same shape the User model's isEmail validator accepts in practice; checked
// up front so a bad address is a 400 naming the field, not a 500.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Every admin list is paged. Without a ceiling `?limit=100000` dumps a whole
// table, and a negative page/limit reaches MySQL as a negative OFFSET (500).
// Page is capped too: `?page=1e300` is finite but yields an unsafe OFFSET.
// Anything that is not a plain positive safe integer falls back to the default.
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 100000;
const parsePositiveInt = (value: unknown): number | null => {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
};
const parsePagination = (page: unknown, limit: unknown, defaultLimit = 20) => {
  const p = parsePositiveInt(page);
  const l = parsePositiveInt(limit);
  const pageNum = p === null ? 1 : Math.min(p, MAX_PAGE);
  const limitNum = l === null ? defaultLimit : Math.min(l, MAX_PAGE_SIZE);
  return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
};

// Optional numeric id filters from the query string. Absent or empty means
// "no filter"; anything that is not a positive integer is a 400 rather than an
// unvalidated value reaching the WHERE clause.
class InvalidQueryParamError extends Error {
  constructor(public readonly field: string, message?: string) {
    super(message ?? `${field} must be a positive integer`);
    this.name = "InvalidQueryParamError";
  }
}
const parseQueryId = (value: unknown, field: string): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new InvalidQueryParamError(field);
  return parsed;
};

const persistStudentRelationships = async (
  studentId: number,
  relationships: {
    organizationId: number | null;
    classId: number | null;
    gradeId: number | null;
    gradeName: string | null;
  },
  transaction: any,
) => {
  // The project currently mixes Sequelize 6 helpers with @sequelize/core v7
  // alpha models. Both static and instance updates have been observed to drop
  // explicit null relationship values while still resolving successfully.
  // A fixed, bound UPDATE makes the four validated fields truly atomic.
  await Student.sequelize!.query(
    `UPDATE Students
     SET organizationId = :organizationId,
         classId = :classId,
         gradeId = :gradeId,
         grade = :gradeName,
         updatedAt = :updatedAt
     WHERE id = :studentId`,
    {
      replacements: {
        studentId,
        organizationId: relationships.organizationId,
        classId: relationships.classId,
        gradeId: relationships.gradeId,
        gradeName: relationships.gradeName,
        updatedAt: new Date(),
      },
      transaction,
      type: QueryTypes.UPDATE,
    },
  );
};

// ---------------------------------------------------------------------------
// Organization scope (school-scoped admins)
// ---------------------------------------------------------------------------

// Set by the checkAdmin middleware: null = super admin (sees everything);
// a number locks this request to that organization's data.
const getAdminScope = (req: Request): number | null =>
  (req as Request & { adminOrganizationId?: number | null })
    .adminOrganizationId ?? null;

// Whether a target user belongs to the acting admin's school. Admin users
// are never in a school scope — scoped admins cannot see or manage them.
// Neither are parents: a parent signs up and links their own children, so
// parent accounts are managed by the Super Admin only.
const isUserInAdminScope = async (
  userRecord: User,
  scope: number,
  transaction?: any,
): Promise<boolean> => {
  if (userRecord.role === "Student") {
    const count = await Student.count({
      where: { userId: userRecord.id, organizationId: scope },
      transaction,
    });
    return count > 0;
  }
  if (userRecord.role === "Teacher") {
    const count = await Teacher.count({
      where: { userId: userRecord.id, organizationId: scope },
      transaction,
    });
    return count > 0;
  }
  return false;
};

const getAdminProfile = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;
  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  try {
    const admin = await User.findOne({
      where: { id: user.id, role: "Admin" },
      // organizationId tells the client whether this is a school-scoped
      // admin (a value) or a super admin (null)
      attributes: ["id", "firstName", "lastName", "email", "role", "seenGuides", "organizationId"],
    });

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Scope comes from the Admins table (database V2 authoritative source),
    // resolved by checkAdmin. isSuperAdmin is derived, never stored.
    const scope = (req as Request & { adminOrganizationId?: number | null }).adminOrganizationId;
    const organizationId = scope !== undefined ? scope : admin.organizationId ?? null;

    return res.status(200).json({
      data: {
        ...admin.toJSON(),
        organizationId,
        isSuperAdmin: organizationId === null,
      },
    });
  } catch (error) {
    logger.error("Error in getAdminProfile:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Dashboard counters in one round trip — the admin UI previously issued four
// limit=1 list requests just to read totals.
const getAdminStats = async (req: Request, res: Response) => {
  try {
    const scope = getAdminScope(req);

    if (scope !== null) {
      // School admin: everything counted within their organization only.
      // Parents are not school members (they manage their own accounts), so
      // they are neither counted nor reported here.
      const [students, teachers, classes] = await Promise.all([
        Student.count({ where: { organizationId: scope } }),
        Teacher.count({ where: { organizationId: scope } }),
        Class.count({ where: { organizationId: scope } }),
      ]);

      return res.status(200).json({
        data: {
          users: students + teachers,
          students,
          teachers,
          organizations: 1,
          classes,
        },
      });
    }

    const [users, students, teachers, parents, organizations, classes] =
      await Promise.all([
        User.count(),
        Student.count(),
        Teacher.count(),
        Parent.count(),
        Organization.count(),
        Class.count(),
      ]);

    return res.status(200).json({
      data: { users, students, teachers, parents, organizations, classes },
    });
  } catch (error) {
    logger.error("Error in getAdminStats:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

const listOrganizations = async (req: Request, res: Response) => {
  try {
    const { search, type, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (search) where.name = { [Op.like]: `%${String(search)}%` };
    if (type) {
      if (!(Object.values(OrganizationType) as unknown[]).includes(type)) {
        return res.status(400).json({ message: "Invalid organization type filter" });
      }
      where.type = type;
    }

    // School admins only ever see their own school
    const scope = getAdminScope(req);
    if (scope !== null) where.id = scope;

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const { rows, count } = await Organization.findAndCountAll({
      where,
      limit: limitNum,
      offset,
      order: [["name", "ASC"]],
    });

    return res.status(200).json({
      data: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    logger.error("Error in listOrganizations:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const getOrganization = async (req: Request, res: Response) => {
  try {
    const organizationId = Number(req.params.organizationId);
    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    const scope = getAdminScope(req);
    if (scope !== null && organizationId !== scope) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const organization = await Organization.findByPk(organizationId, {
      include: [
        {
          model: Class,
          as: "Classes",
          attributes: ["id", "classname", "grade", "gradeId"],
          required: false,
          include: [
            {
              model: Grade,
              as: "GradeEntity",
              attributes: ["id", "name"],
              required: false,
            },
          ],
        },
      ],
    });

    if (!organization) {
      return res.status(404).json({ message: "Organization not found" });
    }

    return res.status(200).json({ data: organization });
  } catch (error) {
    logger.error("Error in getOrganization:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const createOrganization = async (req: Request, res: Response) => {
  try {
    if (getAdminScope(req) !== null) {
      return res
        .status(403)
        .json({ message: "School admins cannot create organizations" });
    }

    const { name, type, img } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ message: "name is required" });
    }

    const normalizedName = name.trim().toLowerCase();

    const existing = await Organization.findOne({ where: { name: normalizedName } });
    if (existing) {
      return res.status(409).json({ message: "Organization with this name already exists" });
    }

    const organization = await Organization.create({
      name: normalizedName,
      type: type || OrganizationType.School,
      img,
    });

    await recordAdminAction(req, {
      action: "organization.create",
      targetType: "organization",
      targetId: organization.id,
      targetLabel: organization.name,
      organizationId: organization.id,
    });

    return res.status(201).json({ data: organization });
  } catch (error) {
    logger.error("Error in createOrganization:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const updateOrganization = async (req: Request, res: Response) => {
  try {
    if (getAdminScope(req) !== null) {
      return res
        .status(403)
        .json({ message: "School admins cannot modify organizations" });
    }

    const organizationId = Number(req.params.organizationId);
    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    const { name, type, img } = req.body;

    const organization = await Organization.findByPk(organizationId);
    if (!organization) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const updateData: Record<string, any> = {};
    if (name) updateData.name = name.trim().toLowerCase();
    if (type) updateData.type = type;
    if (img !== undefined) updateData.img = img;

    if (Object.keys(updateData).length > 0) {
      const previousName = organization.name;
      await organization.update(updateData);
      await recordAdminAction(req, {
        action: "organization.update",
        targetType: "organization",
        targetId: organization.id,
        targetLabel: organization.name,
        organizationId: organization.id,
        details: { fields: Object.keys(updateData), previousName },
      });
    }

    return res.status(200).json({ data: organization });
  } catch (error) {
    logger.error("Error in updateOrganization:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const deleteOrganization = async (req: Request, res: Response) => {
  try {
    if (getAdminScope(req) !== null) {
      return res
        .status(403)
        .json({ message: "School admins cannot modify organizations" });
    }

    const organizationId = Number(req.params.organizationId);
    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    const organization = await Organization.findByPk(organizationId);
    if (!organization) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const [studentCount, teacherCount, classCount] = await Promise.all([
      Student.count({ where: { organizationId } }),
      Teacher.count({ where: { organizationId } }),
      Class.count({ where: { organizationId } }),
    ]);

    if (studentCount + teacherCount + classCount > 0) {
      return res.status(409).json({
        message: "Organization has dependent records, reassign or remove them first",
        studentCount,
        teacherCount,
        classCount,
      });
    }

    await organization.destroy();
    await recordAdminAction(req, {
      action: "organization.delete",
      targetType: "organization",
      targetId: organizationId,
      targetLabel: organization.name,
      organizationId,
    });

    return res.status(200).json({ message: "Organization deleted successfully" });
  } catch (error) {
    logger.error("Error in deleteOrganization:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

const listStudents = async (req: Request, res: Response) => {
  try {
    const {
      search,
      organizationId,
      classId,
      gradeId,
      grade,
      missing,
      page = "1",
      limit = "20",
    } = req.query;

    const where: any = {};
    const organizationIdFilter = parseQueryId(organizationId, "organizationId");
    const classIdFilter = parseQueryId(classId, "classId");
    const gradeIdFilter = parseQueryId(gradeId, "gradeId");
    if (organizationIdFilter) where.organizationId = organizationIdFilter;
    if (classIdFilter) where.classId = classIdFilter;
    if (gradeIdFilter) where.gradeId = gradeIdFilter;
    else if (grade) where.grade = String(grade);
    // The data-quality drill-down: only students missing a class or a grade.
    if (missing !== undefined && missing !== "") {
      if (missing === "class") where.classId = null;
      else if (missing === "grade") where.gradeId = null;
      else throw new InvalidQueryParamError("missing", "missing must be class or grade");
    }

    // School admins are locked to their own school regardless of query params
    const scope = getAdminScope(req);
    if (scope !== null) where.organizationId = scope;

    const userWhere: any = {};
    if (search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${String(search)}%` } },
        { lastName: { [Op.like]: `%${String(search)}%` } },
        { email: { [Op.like]: `%${String(search)}%` } },
      ];
    }

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const { rows, count } = await Student.findAndCountAll({
      where,
      limit: limitNum,
      offset,
      order: [["id", "ASC"]],
      distinct: true,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["firstName", "lastName", "email", "profileImg", "gender", "dateOfBirth"],
          where: Reflect.ownKeys(userWhere).length ? userWhere : undefined,
          required: !!search,
        },
        {
          model: Class,
          as: "Class",
          attributes: ["id", "classname", "grade", "gradeId"],
          required: false,
          include: [
            {
              model: Grade,
              as: "GradeEntity",
              attributes: ["id", "name"],
              required: false,
            }
          ]
        },
        {
          model: Grade,
          as: "GradeEntity",
          attributes: ["id", "name"],
          required: false,
        },
        {
          model: Organization,
          as: "organization",
          attributes: ["id", "name"],
          required: false,
        },
        // The linked parent, for a Super Admin only: parents are not part of
        // a school, so a School Admin never sees them.
        ...(scope === null
          ? [
              {
                model: Parent,
                as: "Parent",
                attributes: ["id"],
                required: false,
                include: [
                  {
                    model: User,
                    as: "user",
                    attributes: ["id", "firstName", "lastName", "email"],
                    required: false,
                  },
                ],
              },
            ]
          : []),
      ],
    });

    return res.status(200).json({
      data: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in listStudents:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const getStudentDetail = async (req: Request, res: Response) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!studentId) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    const student = await Student.findOne({
      where: { id: studentId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["firstName", "lastName", "email", "profileImg", "gender", "dateOfBirth"],
        },
        {
          model: Class,
          as: "Class",
          attributes: ["id", "classname", "grade", "gradeId"],
          required: false,
          include: [
            {
              model: Grade,
              as: "GradeEntity",
              attributes: ["id", "name"],
              required: false,
            }
          ]
        },
        {
          model: Grade,
          as: "GradeEntity",
          attributes: ["id", "name"],
          required: false,
        },
        {
          model: Organization,
          as: "organization",
          attributes: ["id", "name"],
          required: false,
        },
      ],
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const scope = getAdminScope(req);
    if (scope !== null && student.organizationId !== scope) {
      return res.status(404).json({ message: "Student not found" });
    }

    const allCategories = await TaskCategory.findAll({
      attributes: ["id", "title"],
      raw: true,
    });

    const completedTasks = await Student.sequelize.query(
      `
      SELECT COUNT(StudentTasks.taskId) AS count, Tasks.categoryId, TaskCategories.title
      FROM StudentTasks
      INNER JOIN Tasks ON StudentTasks.taskId = Tasks.id
      INNER JOIN TaskCategories ON Tasks.categoryId = TaskCategories.id
      WHERE StudentTasks.studentId = :studentId
      AND StudentTasks.completionStatus = 'Completed'
      GROUP BY Tasks.categoryId, TaskCategories.title
      `,
      {
        replacements: { studentId: student.id },
        type: QueryTypes.SELECT,
      }
    );

    const categoryCounts = (completedTasks as any[]).reduce(
      (acc: Record<string, number>, row: any) => {
        acc[row["title"]] = Number(row["count"]) || 0;
        return acc;
      },
      {} as Record<string, number>
    );

    const finalCategoryCounts = buildCategoryCounts(
      allCategories.map((category) => category.title),
      categoryCounts,
    );

    const totalCompletedTasks = (
      Object.values(finalCategoryCounts) as number[]
    ).reduce((sum: number, count: number) => sum + count, 0);

    return res.status(200).json({
      data: {
        student,
        totalCompletedTasks,
        categoryCounts: finalCategoryCounts,
      },
    });
  } catch (error) {
    logger.error("Error in getStudentDetail:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const updateStudent = async (req: Request, res: Response) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ message: "Invalid student id" });
    }

    const { firstName, lastName, email, gradeId, grade, organizationId, classId, profileImg, parentId } =
      req.body;
    const requestedOrganizationId = parseOptionalPositiveId(organizationId, "organizationId");
    const requestedClassId = parseOptionalPositiveId(classId, "classId");
    const requestedGradeId = parseOptionalPositiveId(gradeId, "gradeId");
    // null unlinks the parent; a number links that parent.
    const requestedParentId = parseOptionalPositiveId(parentId, "parentId");

    // Written to the activity log once the transaction has committed.
    const auditEntries: Parameters<typeof recordAdminAction>[1][] = [];

    const response = await User.sequelize!.transaction(async (transaction) => {
      const student = await Student.findByPk(studentId, { transaction });
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const scope = getAdminScope(req);
      if (scope !== null) {
        if (student.organizationId !== scope) {
          return res.status(404).json({ message: "Student not found" });
        }
        // Parents link their own children; only a Super Admin may override that.
        if (requestedParentId !== undefined) {
          return res.status(403).json({ message: "School admins cannot link parents" });
        }
        // A school admin can never move a student out of their school
        if (requestedOrganizationId !== undefined && requestedOrganizationId !== scope) {
          return res.status(403).json({
            message: "School admins cannot move students to another organization",
          });
        }
      }

      // Checked before anything is written, so a bad id changes nothing.
      let parentRecord: Parent | null = null;
      if (requestedParentId != null) {
        parentRecord = await Parent.findByPk(requestedParentId, {
          transaction,
          include: [{ model: User, as: "user", attributes: ["firstName", "lastName", "email"] }],
        });
        if (!parentRecord) {
          return res.status(400).json({ message: "Parent does not exist", field: "parentId" });
        }
      }

      const userRecord = student.userId
        ? await User.findOne({ where: { id: student.userId }, transaction })
        : null;
      const studentLabel = userLabel(userRecord);

      const userUpdateData: Record<string, any> = {};
      if (firstName) userUpdateData.firstName = firstName;
      if (lastName) userUpdateData.lastName = lastName;
      if (email) userUpdateData.email = email;
      if (profileImg && typeof profileImg === "object") userUpdateData.profileImg = profileImg;

      const studentUpdateData: Record<string, any> = {};
      let resolvedRelationships: Awaited<
        ReturnType<typeof resolveStudentRelationships>
      > | null = null;
      const relationshipsWereSubmitted =
        requestedOrganizationId !== undefined ||
        requestedClassId !== undefined ||
        requestedGradeId !== undefined;
      if (relationshipsWereSubmitted) {
        const relationships = await resolveStudentRelationships({
          organizationId:
            requestedOrganizationId !== undefined
              ? requestedOrganizationId
              : student.organizationId ?? null,
          classId:
            requestedClassId !== undefined
              ? requestedClassId
              : requestedOrganizationId === null
                ? null
                : student.classId ?? null,
          gradeId:
            requestedGradeId !== undefined
              ? requestedGradeId
              : requestedClassId != null
                ? null
              : requestedOrganizationId === null
                ? null
                : student.gradeId ?? null,
          transaction,
        });
        studentUpdateData.organizationId = relationships.organizationId;
        studentUpdateData.classId = relationships.classId;
        studentUpdateData.gradeId = relationships.gradeId;
        studentUpdateData.grade = relationships.gradeName;
        resolvedRelationships = relationships;
      } else if (grade !== undefined) {
        studentUpdateData.grade = grade === "" ? null : grade;
      }

      if (userRecord && Object.keys(userUpdateData).length > 0) {
        await userRecord.update(userUpdateData, { transaction });
      }
      if (resolvedRelationships) {
        await persistStudentRelationships(
          student.id,
          resolvedRelationships,
          transaction,
        );
      } else if (Object.keys(studentUpdateData).length > 0) {
        await student.update(studentUpdateData, {
          transaction,
          fields: Object.keys(studentUpdateData),
          omitNull: false,
        });
      }

      const changedFields = [
        ...Object.keys(userUpdateData),
        ...(resolvedRelationships ? ["organizationId", "classId", "gradeId"] : Object.keys(studentUpdateData)),
      ];
      if (changedFields.length > 0) {
        auditEntries.push({
          action: "student.update",
          targetType: "student",
          targetId: student.id,
          targetLabel: studentLabel,
          organizationId: resolvedRelationships?.organizationId ?? student.organizationId ?? null,
          details: {
            fields: changedFields,
            ...(resolvedRelationships
              ? {
                  from: { organizationId: student.organizationId, classId: student.classId, gradeId: student.gradeId },
                  to: {
                    organizationId: resolvedRelationships.organizationId,
                    classId: resolvedRelationships.classId,
                    gradeId: resolvedRelationships.gradeId,
                  },
                }
              : {}),
          },
        });
      }

      if (requestedParentId !== undefined) {
        await Student.update({ ParentId: requestedParentId } as any, {
          where: { id: student.id },
          transaction,
        });
        auditEntries.push({
          action: requestedParentId === null ? "student.unlink_parent" : "student.link_parent",
          targetType: "student",
          targetId: student.id,
          targetLabel: studentLabel,
          organizationId: student.organizationId ?? null,
          details: {
            previousParentId: (student as any).ParentId ?? null,
            parentId: requestedParentId,
            parent: parentRecord ? userLabel((parentRecord as any).user) : null,
          },
        });
      }

      return res.status(200).json({ message: "Student updated successfully" });
    });

    for (const entry of auditEntries) await recordAdminAction(req, entry);
    return response;
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof RelationshipValidationError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Email already in use" });
    }
    logger.error("Error in updateStudent:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const deleteStudent = async (req: Request, res: Response) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!studentId) {
      return res.status(400).json({ message: "Invalid student id" });
    }

    const student = await Student.findByPk(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const scope = getAdminScope(req);
    if (scope !== null && student.organizationId !== scope) {
      return res.status(404).json({ message: "Student not found" });
    }

    const userRecord = student.userId
      ? await User.findOne({ where: { id: student.userId } })
      : null;

    await StudentTask.destroy({ where: { studentId: student.id } });
    await StudentChallenge.destroy({ where: { studentId: student.id } });

    await student.destroy();
    if (userRecord) await userRecord.destroy();
    await recordAdminAction(req, {
      action: "student.delete",
      targetType: "student",
      targetId: student.id,
      targetLabel: userLabel(userRecord),
      organizationId: student.organizationId ?? null,
    });

    return res.status(200).json({ message: "Student deleted successfully" });
  } catch (error) {
    logger.error("Error in deleteStudent:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Users (flat view across all roles) / Teachers / Parents / Password reset
// ---------------------------------------------------------------------------

const listUsers = async (req: Request, res: Response) => {
  try {
    const { search, role, verified, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (role) {
      if (typeof role !== "string" || !["Student", "Teacher", "Parent", "Admin"].includes(role)) {
        return res.status(400).json({ message: "role must be one of Student, Teacher, Parent, Admin" });
      }
      where.role = role;
    }
    if (verified === "true") where.isAccess = true;
    if (search) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${String(search)}%` } },
        { lastName: { [Op.like]: `%${String(search)}%` } },
        { email: { [Op.like]: `%${String(search)}%` } },
      ];
    }

    // School admins only see users belonging to their school: its students
    // and teachers. Admin and parent accounts are never visible to them.
    const scope = getAdminScope(req);
    if (scope !== null) {
      if (role === "Parent") {
        return res.status(403).json({ message: "School admins cannot view parent accounts" });
      }
      const [studentRows, teacherRows] = await Promise.all([
        Student.findAll({
          where: { organizationId: scope },
          attributes: ["userId"],
          raw: true,
        }),
        Teacher.findAll({
          where: { organizationId: scope },
          attributes: ["userId"],
          raw: true,
        }),
      ]);
      const scopedUserIds = [
        ...studentRows.map((r: any) => r.userId),
        ...teacherRows.map((r: any) => r.userId),
      ].filter(Boolean);
      // [0] keeps the IN clause valid when the school has no members yet
      where.id = { [Op.in]: scopedUserIds.length ? scopedUserIds : [0] };
    }

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: ["id", "firstName", "lastName", "email", "role", "isAccess", "createdAt"],
      limit: limitNum,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json({ data: rows, total: count, page: pageNum, limit: limitNum });
  } catch (error) {
    logger.error("Error in listUsers:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const listTeachers = async (req: Request, res: Response) => {
  try {
    const { search, organizationId, missing, page = "1", limit = "20" } = req.query;

    const where: any = {};
    const organizationIdFilter = parseQueryId(organizationId, "organizationId");
    if (organizationIdFilter) where.organizationId = organizationIdFilter;
    // The data-quality drill-down: only teachers who teach no class.
    if (missing !== undefined && missing !== "") {
      if (missing !== "class") throw new InvalidQueryParamError("missing", "missing must be class");
      where.id = {
        [Op.notIn]: literal("(SELECT `teacherId` FROM `Classes` WHERE `teacherId` IS NOT NULL)"),
      };
    }

    const scope = getAdminScope(req);
    if (scope !== null) where.organizationId = scope;

    const userWhere: any = {};
    if (search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${String(search)}%` } },
        { lastName: { [Op.like]: `%${String(search)}%` } },
        { email: { [Op.like]: `%${String(search)}%` } },
      ];
    }

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const { rows, count } = await Teacher.findAndCountAll({
      where,
      limit: limitNum,
      offset,
      order: [["id", "ASC"]],
      distinct: true,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "email"],
          where: Reflect.ownKeys(userWhere).length ? userWhere : undefined,
          required: !!search,
        },
        {
          model: Organization,
          as: "organization",
          attributes: ["id", "name"],
          required: false,
        },
        {
          model: Class,
          as: "Classes",
          attributes: ["id", "classname", "gradeId", "grade"],
          required: false,
          include: [
            {
              model: Grade,
              as: "GradeEntity",
              attributes: ["id", "name"],
              required: false,
            }
          ]
        },
      ],
    });

    return res.status(200).json({ data: rows, total: count, page: pageNum, limit: limitNum });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in listTeachers:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const listParents = async (req: Request, res: Response) => {
  try {
    const { search, organizationId, page = "1", limit = "20" } = req.query;

    const userWhere: any = {};
    if (search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${String(search)}%` } },
        { lastName: { [Op.like]: `%${String(search)}%` } },
        { email: { [Op.like]: `%${String(search)}%` } },
      ];
    }

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    // A school's parents: those imported into it (Parents.organizationId) and
    // those linked to one of its students. The route is Super Admin only; the
    // `?organizationId=` filter narrows the list to one school.
    const parentScope = getAdminScope(req) ?? parseQueryId(organizationId, "organizationId") ?? null;
    const parentWhere =
      parentScope !== null
        ? {
            [Op.or]: [
              { organizationId: parentScope },
              {
                id: {
                  [Op.in]: literal(
                    `(SELECT \`ParentId\` FROM \`Students\` WHERE \`organizationId\` = ${Number(parentScope)} AND \`ParentId\` IS NOT NULL)`,
                  ),
                },
              },
            ],
          }
        : undefined;

    const { rows, count } = await Parent.findAndCountAll({
      where: parentWhere as any,
      limit: limitNum,
      offset,
      order: [["id", "ASC"]],
      distinct: true,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "email"],
          where: Reflect.ownKeys(userWhere).length ? userWhere : undefined,
          required: !!search,
        },
        {
          model: Student,
          as: "Students",
          attributes: ["id", "organizationId", "classId"],
          // Filtered to one school, only that school's children are listed.
          where:
            parentScope !== null
              ? { organizationId: parentScope }
              : undefined,
          required: false,
          include: [
            { model: User, as: "user", attributes: ["firstName", "lastName"], required: false },
            { model: Class, as: "Class", attributes: ["id", "classname"], required: false },
          ],
        },
      ],
    });

    return res.status(200).json({ data: rows, total: count, page: pageNum, limit: limitNum });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in listParents:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const createUser = async (req: Request, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email: rawEmail,
      role,
      organizationId,
      classId,
      gradeId,
      grade,
    } = req.body;
    // Normalize once (trim + lowercase, as signup does) so validation, the
    // duplicate lookup and the stored value all use the same address.
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;

    if (!firstName || !email || !role) {
      return res.status(400).json({ message: "firstName, email and role are required" });
    }

    const validRoles = ["Student", "Teacher", "Parent", "Admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: `role must be one of ${validRoles.join(", ")}` });
    }

    if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ message: "email must be a valid email address", field: "email" });
    }

    // School admins can only create members of their own school: never admins,
    // and never parents (a parent signs up and links their own children).
    const scope = getAdminScope(req);
    if (scope !== null && role === "Admin") {
      return res
        .status(403)
        .json({ message: "School admins cannot create admin accounts" });
    }
    if (scope !== null && role === "Parent") {
      return res
        .status(403)
        .json({ message: "School admins cannot create parent accounts" });
    }
    const effectiveOrganizationId = scope !== null ? scope : organizationId;

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: "Email already in use" });
    }

    let resolvedOrganizationId: number | undefined;
    if (role === "Student" || role === "Teacher") {
      if (effectiveOrganizationId === undefined) {
        return res.status(400).json({ message: "organizationId is required for this role" });
      }
      const parsedOrganizationId = parseOptionalPositiveId(
        effectiveOrganizationId,
        "organizationId",
      );
      if (parsedOrganizationId == null) {
        return res.status(400).json({ message: "organizationId is required for this role" });
      }
      const organization = await Organization.findByPk(parsedOrganizationId);
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
      resolvedOrganizationId = organization.id;
    }

    // Admin scope lives in the Admins row (AGENTS.md). An organizationId makes
    // a School Admin; the console omits it only when the Super Admin picks the
    // explicit "Super Admin" option, so absent/null/"" means global scope.
    let adminOrganizationId: number | null = null;
    if (role === "Admin") {
      const parsedOrganizationId = parseOptionalPositiveId(organizationId, "organizationId");
      if (parsedOrganizationId != null) {
        const organization = await Organization.findByPk(parsedOrganizationId);
        if (!organization) {
          return res.status(400).json({ message: "Target organization does not exist" });
        }
        adminOrganizationId = organization.id;
      }
    }

    let resolvedClassId: number | null = null;
    let resolvedGradeId: number | null = null;
    let resolvedGradeName: string | null = grade || null;
    if (role === "Student") {
      const parsedClassId = parseOptionalPositiveId(classId, "classId");
      const parsedGradeId = parseOptionalPositiveId(gradeId, "gradeId");
      const relationships = await resolveStudentRelationships({
        organizationId: resolvedOrganizationId ?? null,
        classId: parsedClassId ?? null,
        gradeId: parsedGradeId ?? null,
      });
      resolvedOrganizationId = relationships.organizationId ?? undefined;
      resolvedClassId = relationships.classId;
      resolvedGradeId = relationships.gradeId;
      resolvedGradeName = relationships.gradeName ?? resolvedGradeName;
    }

    const password = generatePassword();
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Every field the role-specific record needs is already validated above,
    // so User + Student/Teacher/Parent are created together — otherwise a
    // failure partway through (e.g. a bad treeProgress FK) after User.create
    // already committed leaves an orphaned user with no role record and an
    // email permanently "taken".
    let userRecord!: User;
    await User.sequelize!.transaction(async (t) => {
      userRecord = await User.create(
        {
          firstName,
          lastName: lastName || "",
          email,
          password: hashedPassword,
          role,
          // Legacy compatibility copy only, kept equal to Admins.organizationId
          // the way the seeder writes it.
          ...(role === "Admin" ? { organizationId: adminOrganizationId } : {}),
          isAccess: true,
          otpVerified: true,
        },
        { transaction: t }
      );

      if (role === "Admin") {
        // Without this row checkAdmin falls back to a null scope, i.e. every
        // "School Admin" created here silently became a Super Admin.
        await Admin.create(
          { userId: userRecord.id, organizationId: adminOrganizationId },
          { transaction: t }
        );
      } else if (role === "Student") {
        const connectCode = await generateUniqueConnectCode();
        const student = await Student.create(
          {
            userId: userRecord.id,
            organizationId: resolvedOrganizationId,
            classId: resolvedClassId,
            gradeId: resolvedGradeId,
            grade: resolvedGradeName,
            treeProgress: 1,
            connectCode,
          },
          { transaction: t }
        );

        const allChallenges = await Challenge.findAll({ transaction: t });
        await StudentChallenge.bulkCreate(
          allChallenges.map((challenge) => ({
            studentId: student.id,
            challengeId: challenge.id,
            completionStatus: "NotCompleted",
          })),
          { transaction: t }
        );
      } else if (role === "Teacher") {
        const teacher = await Teacher.create(
          {
            userId: userRecord.id,
            organizationId: resolvedOrganizationId,
          },
          { transaction: t }
        );

        // Assign classes to the teacher
        if (req.body.classIds && Array.isArray(req.body.classIds)) {
          for (const classId of req.body.classIds) {
            const targetClass = await Class.findByPk(Number(classId), { transaction: t });
            if (targetClass && targetClass.organizationId === resolvedOrganizationId) {
              await targetClass.update({ teacherId: teacher.id }, { transaction: t });
            }
          }
        }
      } else if (role === "Parent") {
        await Parent.create({ userId: userRecord.id }, { transaction: t });
      }
    });

    await recordAdminAction(req, {
      action: "user.create",
      targetType: "user",
      targetId: userRecord.id,
      targetLabel: userLabel(userRecord),
      organizationId: resolvedOrganizationId ?? null,
      details: { role: userRecord.role },
    });

    return res.status(201).json({
      data: {
        id: userRecord.id,
        firstName: userRecord.firstName,
        lastName: userRecord.lastName,
        email: userRecord.email,
        role: userRecord.role,
      },
      password,
    });
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof RelationshipValidationError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Email already in use" });
    }
    if (error?.name === "SequelizeValidationError") {
      const first = Array.isArray(error.errors) ? error.errors[0] : undefined;
      return res.status(400).json({
        message: first?.message || "Invalid account details",
        field: first?.path,
      });
    }
    logger.error("Error in createUser:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Generic update: works for any role. Student/Teacher get their extra
// role-specific fields applied too when the target user has that role.
const updateUser = async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const { firstName, lastName, email, organizationId, classId, gradeId, grade } = req.body;
    const requestedOrganizationId = parseOptionalPositiveId(organizationId, "organizationId");
    const requestedClassId = parseOptionalPositiveId(classId, "classId");
    const requestedGradeId = parseOptionalPositiveId(gradeId, "gradeId");

    // Written to the activity log once the transaction has committed.
    let auditEntry: Parameters<typeof recordAdminAction>[1] | null = null;

    const response = await User.sequelize!.transaction(async (transaction) => {
      const userRecord = await User.findByPk(userId, { transaction });
      if (!userRecord) {
        return res.status(404).json({ message: "User not found" });
      }

      const scope = getAdminScope(req);
      if (scope !== null) {
        // Out-of-school targets (and all Admin accounts) look nonexistent
        const inScope = await isUserInAdminScope(userRecord, scope, transaction);
        if (!inScope) {
          return res.status(404).json({ message: "User not found" });
        }
        if (
          requestedOrganizationId !== undefined &&
          requestedOrganizationId !== scope
        ) {
          return res.status(403).json({
            message: "School admins cannot move users to another organization",
          });
        }
      }

      const userUpdateData: Record<string, any> = {};
      if (firstName) userUpdateData.firstName = firstName;
      if (lastName !== undefined) userUpdateData.lastName = lastName;
      if (email) userUpdateData.email = email;

      // Super admins can assign an Admin account to a school, turning it into
      // a school-scoped admin (or clear it to restore full access).
      if (
        scope === null &&
        userRecord.role === "Admin" &&
        requestedOrganizationId !== undefined
      ) {
        if (requestedOrganizationId !== null) {
          const organization = await Organization.findByPk(requestedOrganizationId, { transaction });
          if (!organization) {
            return res.status(400).json({ message: "Target organization does not exist" });
          }
        }
        // Admins.organizationId is authoritative (AGENTS.md). Write it in this
        // transaction, creating the row for legacy admins that lack one, and
        // keep the Users.organizationId compatibility copy equal to it.
        const [adminRow, createdAdminRow] = await Admin.findOrCreate({
          where: { userId: userRecord.id },
          defaults: { userId: userRecord.id, organizationId: requestedOrganizationId },
          transaction,
        });
        if (!createdAdminRow && adminRow.organizationId !== requestedOrganizationId) {
          await adminRow.update({ organizationId: requestedOrganizationId }, { transaction });
        }
        userUpdateData.organizationId = requestedOrganizationId;
      }

      if (userRecord.role === "Student") {
        const student = await Student.findOne({ where: { userId }, transaction });
        if (!student) {
          return res.status(404).json({ message: "Student record not found for this user" });
        }

        const studentUpdateData: Record<string, any> = {};
        let resolvedRelationships: Awaited<
          ReturnType<typeof resolveStudentRelationships>
        > | null = null;
        const relationshipsWereSubmitted =
          requestedOrganizationId !== undefined ||
          requestedClassId !== undefined ||
          requestedGradeId !== undefined;
        if (relationshipsWereSubmitted) {
          const relationships = await resolveStudentRelationships({
            organizationId:
              requestedOrganizationId !== undefined
                ? requestedOrganizationId
                : student.organizationId ?? null,
            classId:
              requestedClassId !== undefined
                ? requestedClassId
                : requestedOrganizationId === null
                  ? null
                  : student.classId ?? null,
            gradeId:
              requestedGradeId !== undefined
                ? requestedGradeId
                : requestedClassId != null
                  ? null
                : requestedOrganizationId === null
                  ? null
                  : student.gradeId ?? null,
            transaction,
          });
          studentUpdateData.organizationId = relationships.organizationId;
          studentUpdateData.classId = relationships.classId;
          studentUpdateData.gradeId = relationships.gradeId;
          studentUpdateData.grade = relationships.gradeName;
          resolvedRelationships = relationships;
        } else if (grade !== undefined) {
          studentUpdateData.grade = grade === "" ? null : grade;
        }

        if (resolvedRelationships) {
          await persistStudentRelationships(
            student.id,
            resolvedRelationships,
            transaction,
          );
        } else if (Object.keys(studentUpdateData).length > 0) {
          await student.update(studentUpdateData, {
            transaction,
            fields: Object.keys(studentUpdateData),
            omitNull: false,
          });
        }
      } else if (userRecord.role === "Teacher") {
        const teacher = await Teacher.findOne({ where: { userId }, transaction });
        if (!teacher) {
          return res.status(404).json({ message: "Teacher record not found for this user" });
        }

        const resultingOrganizationId = requestedOrganizationId !== undefined
          ? requestedOrganizationId
          : teacher.organizationId;

        if (requestedOrganizationId !== undefined && requestedOrganizationId !== null) {
          const organization = await Organization.findByPk(requestedOrganizationId, { transaction });
          if (!organization) {
            return res.status(400).json({ message: "Target organization does not exist" });
          }
        }

        let requestedClasses: Class[] | undefined;
        if (req.body.classIds !== undefined) {
          if (!Array.isArray(req.body.classIds)) {
            return res.status(400).json({ message: "classIds must be an array" });
          }

          requestedClasses = [];
          for (const rawClassId of req.body.classIds) {
            const parsedClassId = parseOptionalPositiveId(rawClassId, "classIds");
            if (parsedClassId == null) {
              throw new InvalidOptionalIdError("classIds");
            }
            const targetClass = await Class.findByPk(parsedClassId, { transaction });
            if (!targetClass) {
              return res.status(400).json({ message: `Class ${parsedClassId} does not exist` });
            }
            if (targetClass.organizationId !== resultingOrganizationId) {
              return res.status(400).json({ message: `Class ${parsedClassId} does not belong to the selected organization` });
            }
            requestedClasses.push(targetClass);
          }
        }

        if (requestedOrganizationId !== undefined) {
          await teacher.update({ organizationId: resultingOrganizationId }, { transaction });
        }

        if (requestedClasses) {
          await Class.update(
            { teacherId: null },
            { where: { teacherId: teacher.id }, transaction },
          );
          for (const targetClass of requestedClasses) {
            await targetClass.update({ teacherId: teacher.id }, { transaction });
          }
        }
      }

      if (Object.keys(userUpdateData).length > 0) {
        await userRecord.update(userUpdateData, { transaction });
      }

      const submitted = ["firstName", "lastName", "email", "organizationId", "classId", "gradeId", "classIds"].filter(
        (field) => req.body?.[field] !== undefined,
      );
      if (submitted.length > 0) {
        auditEntry = {
          action: "user.update",
          targetType: "user",
          targetId: userRecord.id,
          targetLabel: userLabel(userRecord),
          organizationId: requestedOrganizationId ?? scope ?? userRecord.organizationId ?? null,
          details: { role: userRecord.role, fields: submitted },
        };
      }

      return res.status(200).json({ message: "User updated successfully" });
    });

    if (auditEntry) await recordAdminAction(req, auditEntry);
    return response;
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof RelationshipValidationError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Email already in use" });
    }
    logger.error("Error in updateUser:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Generic delete: works for any role, cascading whatever child rows that
// role owns. Keyed by userId so every admin tab (Users/Students/Teachers/
// Parents/Admins) can use the same endpoint regardless of its list shape.
const deleteUser = async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const userRecord = await User.findByPk(userId);
    if (!userRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    const scope = getAdminScope(req);
    if (scope !== null && !(await isUserInAdminScope(userRecord, scope))) {
      return res.status(404).json({ message: "User not found" });
    }

    // The school the deleted account belonged to, for the activity log.
    let affectedOrganizationId: number | null = scope ?? userRecord.organizationId ?? null;

    if (userRecord.role === "Student") {
      const student = await Student.findOne({ where: { userId } });
      if (student) {
        affectedOrganizationId = student.organizationId ?? affectedOrganizationId;
        await StudentTask.destroy({ where: { studentId: student.id } });
        await StudentChallenge.destroy({ where: { studentId: student.id } });
        await student.destroy();
      }
    } else if (userRecord.role === "Teacher") {
      const teacher = await Teacher.findOne({ where: { userId } });
      affectedOrganizationId = teacher?.organizationId ?? affectedOrganizationId;
      await Teacher.destroy({ where: { userId } });
    } else if (userRecord.role === "Parent") {
      const parent = await Parent.findOne({ where: { userId } });
      if (parent) {
        await Student.update({ ParentId: null } as any, { where: { ParentId: parent.id } });
        await parent.destroy();
      }
    }

    await userRecord.destroy();
    await recordAdminAction(req, {
      action: "user.delete",
      targetType: "user",
      targetId: userRecord.id,
      targetLabel: userLabel(userRecord),
      organizationId: affectedOrganizationId,
      details: { role: userRecord.role },
    });

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    logger.error("Error in deleteUser:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

const listClasses = async (req: Request, res: Response) => {
  try {
    const { search, organizationId, gradeId, missing, page = "1", limit = "20" } = req.query;

    const where: any = {};
    const organizationIdFilter = parseQueryId(organizationId, "organizationId");
    const gradeIdFilter = parseQueryId(gradeId, "gradeId");
    if (organizationIdFilter) where.organizationId = organizationIdFilter;
    if (gradeIdFilter) where.gradeId = gradeIdFilter;
    if (search) where.classname = { [Op.like]: `%${String(search)}%` };
    // The data-quality drill-down: only classes missing a teacher or a grade.
    if (missing !== undefined && missing !== "") {
      if (missing === "teacher") where.teacherId = null;
      else if (missing === "grade") where.gradeId = null;
      else throw new InvalidQueryParamError("missing", "missing must be teacher or grade");
    }

    const scope = getAdminScope(req);
    if (scope !== null) where.organizationId = scope;

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const { rows, count } = await Class.findAndCountAll({
      where,
      limit: limitNum,
      offset,
      order: [["id", "ASC"]],
      distinct: true,
      include: [
        { model: Organization, as: "Organization", attributes: ["id", "name"], required: false },
        {
          model: Teacher,
          as: "Teachers",
          attributes: ["id", "userId"],
          required: false,
          include: [
            { model: User, as: "user", attributes: ["firstName", "lastName"], required: false },
          ],
        },
        { model: Student, as: "Students", attributes: ["id"], required: false },
        { model: Grade, as: "GradeEntity", attributes: ["id", "name"], required: false },
      ],
    });

    return res.status(200).json({ data: rows, total: count, page: pageNum, limit: limitNum });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in listClasses:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const createClass = async (req: Request, res: Response) => {
  try {
    const { classname, gradeId, grade, organizationId, classdescrption } = req.body;

    // School admins always create classes inside their own school
    const scope = getAdminScope(req);
    const effectiveOrganizationId = scope !== null ? scope : organizationId;

    if (!classname || !gradeId || !effectiveOrganizationId) {
      return res.status(400).json({ message: "classname, gradeId and organizationId are required" });
    }

    const parsedOrganizationId = parseOptionalPositiveId(
      effectiveOrganizationId,
      "organizationId",
    );
    const parsedGradeId = parseOptionalPositiveId(gradeId, "gradeId");
    if (parsedOrganizationId == null || parsedGradeId == null) {
      return res.status(400).json({ message: "classname, gradeId and organizationId are required" });
    }

    const organization = await Organization.findByPk(parsedOrganizationId);
    if (!organization) {
      return res.status(400).json({ message: "Target organization does not exist" });
    }

    const gradeRecord = await validateGradeForOrganization(
      parsedGradeId,
      organization.id,
    );

    const newClass = await Class.create({
      classname,
      gradeId: gradeRecord.id,
      grade: gradeRecord.name,
      organizationId: organization.id,
      classdescrption,
    });
    await recordAdminAction(req, {
      action: "class.create",
      targetType: "class",
      targetId: newClass.id,
      targetLabel: String(newClass.classname),
      organizationId: organization.id,
      details: { grade: gradeRecord.name },
    });

    return res.status(201).json({ data: newClass });
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof RelationshipValidationError) {
      return res.status(error.status).json({ message: error.message });
    }
    logger.error("Error in createClass:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const updateClass = async (req: Request, res: Response) => {
  try {
    const classId = Number(req.params.classId);
    if (!classId) {
      return res.status(400).json({ message: "Invalid class id" });
    }

    const targetClass = await Class.findByPk(classId);
    if (!targetClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const { classname, gradeId, grade, organizationId, classdescrption } = req.body;

    const scope = getAdminScope(req);
    if (scope !== null) {
      if (targetClass.organizationId !== scope) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (organizationId !== undefined && Number(organizationId) !== scope) {
        return res.status(403).json({
          message: "School admins cannot move classes to another organization",
        });
      }
    }

    const requestedOrganizationId = parseOptionalPositiveId(
      organizationId,
      "organizationId",
    );
    const requestedGradeId = parseOptionalPositiveId(gradeId, "gradeId");
    const resultingOrganizationId =
      requestedOrganizationId !== undefined
        ? requestedOrganizationId
        : targetClass.organizationId;

    if (resultingOrganizationId == null) {
      return res.status(422).json({ message: "Class must belong to an organization" });
    }

    if (requestedOrganizationId !== undefined) {
      if (requestedOrganizationId === null) {
        return res.status(422).json({ message: "Class must belong to an organization" });
      }
      const organization = await Organization.findByPk(requestedOrganizationId);
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
    }

    const updateData: Record<string, any> = {};
    if (classname) updateData.classname = classname;
    if (requestedGradeId !== undefined) {
      if (requestedGradeId === null) {
        return res.status(422).json({ message: "Class must belong to a grade" });
      }
      const gradeRecord = await validateGradeForOrganization(
        requestedGradeId,
        resultingOrganizationId,
      );
      updateData.gradeId = gradeRecord.id;
      updateData.grade = gradeRecord.name;
    } else if (grade) {
      updateData.grade = grade;
    }
    if (requestedOrganizationId !== undefined) {
      updateData.organizationId = requestedOrganizationId;
    }
    if (classdescrption !== undefined) updateData.classdescrption = classdescrption;

    const relationshipChanged =
      (updateData.organizationId !== undefined &&
        updateData.organizationId !== targetClass.organizationId) ||
      (updateData.gradeId !== undefined && updateData.gradeId !== targetClass.gradeId);
    if (relationshipChanged) {
      const studentCount = await Student.count({ where: { classId } });
      if (studentCount > 0) {
        return res.status(409).json({
          message: "Class has students assigned; reassign them before changing its organization or grade",
          studentCount,
        });
      }
    }

    if (Object.keys(updateData).length > 0) {
      await targetClass.update(updateData);
      await recordAdminAction(req, {
        action: "class.update",
        targetType: "class",
        targetId: targetClass.id,
        targetLabel: String(targetClass.classname),
        organizationId: targetClass.organizationId ?? null,
        details: { fields: Object.keys(updateData) },
      });
    }

    return res.status(200).json({ data: targetClass });
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof RelationshipValidationError) {
      return res.status(error.status).json({ message: error.message });
    }
    logger.error("Error in updateClass:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const deleteClass = async (req: Request, res: Response) => {
  try {
    const classId = Number(req.params.classId);
    if (!classId) {
      return res.status(400).json({ message: "Invalid class id" });
    }

    const targetClass = await Class.findByPk(classId);
    if (!targetClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const scope = getAdminScope(req);
    if (scope !== null && targetClass.organizationId !== scope) {
      return res.status(404).json({ message: "Class not found" });
    }

    const studentCount = await Student.count({ where: { classId } });
    if (studentCount > 0) {
      return res.status(409).json({
        message: "Class has students assigned, reassign or remove them first",
        studentCount,
      });
    }

    await targetClass.destroy();
    await recordAdminAction(req, {
      action: "class.delete",
      targetType: "class",
      targetId: targetClass.id,
      targetLabel: String(targetClass.classname),
      organizationId: targetClass.organizationId ?? null,
    });

    return res.status(200).json({ message: "Class deleted successfully" });
  } catch (error) {
    logger.error("Error in deleteClass:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const resetUserPassword = async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const userRecord = await User.findByPk(userId);
    if (!userRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    const scope = getAdminScope(req);
    if (scope !== null && !(await isUserInAdminScope(userRecord, scope))) {
      return res.status(404).json({ message: "User not found" });
    }

    const hashedPassword = bcrypt.hashSync(DEFAULT_RESET_PASSWORD, 10);
    await userRecord.update({
      password: hashedPassword,
      isAccess: true,
      // A reset re-enables an account an administrator had disabled.
      disabledAt: null,
      otpVerified: true,
      tokenVersion: (userRecord.tokenVersion || 0) + 1,
    } as any);
    await recordAdminAction(req, {
      action: "user.reset_password",
      targetType: "user",
      targetId: userRecord.id,
      targetLabel: userLabel(userRecord),
      details: { role: userRecord.role },
    });

    return res.status(200).json({
      message: "Password reset successfully",
      newPassword: DEFAULT_RESET_PASSWORD,
    });
  } catch (error) {
    logger.error("Error in resetUserPassword:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const listGrades = async (req: Request, res: Response) => {
  try {
    const { search, organizationId, page = "1", limit = "20" } = req.query;

    const where: any = {};
    const organizationIdFilter = parseQueryId(organizationId, "organizationId");
    if (organizationIdFilter) where.organizationId = organizationIdFilter;
    if (search) where.name = { [Op.like]: `%${String(search)}%` };

    // School admins see the shared/global grades plus their own school's
    const scope = getAdminScope(req);
    if (scope !== null) {
      delete where.organizationId;
      where[Op.or] = [{ organizationId: scope }, { organizationId: null }];
    }

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const { rows, count } = await Grade.findAndCountAll({
      where,
      limit: limitNum,
      offset,
      order: [["name", "ASC"]],
      include: [
        { model: Organization, as: "Organization", attributes: ["id", "name"], required: false }
      ]
    });

    return res.status(200).json({
      data: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in listGrades:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const createGrade = async (req: Request, res: Response) => {
  try {
    const { name, organizationId } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ message: "name is required" });
    }

    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
      return res.status(400).json({ message: "name is required" });
    }
    const requestedOrganizationId = parseOptionalPositiveId(
      organizationId,
      "organizationId",
    );
    // School admins always create grades inside their own school, never global
    const scope = getAdminScope(req);
    const resolvedOrganizationId =
      scope !== null ? scope : requestedOrganizationId ?? null;

    if (resolvedOrganizationId !== null) {
      const organization = await Organization.findByPk(resolvedOrganizationId);
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
    }

    const existing = await Grade.findOne({
      where: {
        name: normalizedName,
        organizationId: resolvedOrganizationId,
      },
    });
    if (existing) {
      return res.status(409).json({ message: "Grade already exists in this school" });
    }

    const grade = await Grade.create({
      name: normalizedName,
      organizationId: resolvedOrganizationId,
    });
    await recordAdminAction(req, {
      action: "grade.create",
      targetType: "grade",
      targetId: grade.id,
      targetLabel: grade.name,
      organizationId: grade.organizationId ?? null,
    });
    return res.status(201).json({ data: grade });
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Grade already exists in this school" });
    }
    logger.error("Error in createGrade:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Row-based bulk import (one row per grade name). Used by the admin Import
// Wizard — create-if-missing, no-op (still reported success) if it exists.
const importGrades = async (req: Request, res: Response) => {
  const processedData: any = req.processedData;
  const successfulEntries: any[] = [];
  const failedEntries: ImportFailure[] = [];

  // School admins import grades into their own school only. A Super Admin
  // names the school in the `school` column; with no school the grade is a
  // shared (global) grade. Lookups never cross into another school.
  const scope = getAdminScope(req);
  const orgCache = new Map<string, Promise<Organization | null>>();
  const targetOrganizationIds = new Set<number>();

  try {
    for (const sheet in processedData) {
      const all_data: any[] = Array.isArray(processedData[sheet]) ? processedData[sheet] : [];
      for (let rowIndex = 0; rowIndex < all_data.length; rowIndex += 1) {
        const data = all_data[rowIndex];
        const rowNumber = importRowNumber(data, rowIndex);
        try {
          const gradeName = String(getImportField(data, "name", "grade") ?? "").trim().toLowerCase();
          if (!gradeName) {
            failedEntries.push(rowFailure(rowNumber, "REQUIRED_FIELD_MISSING", "name is required", "name"));
            continue;
          }

          const orgName = String(getImportField(data, "school") ?? "").trim().toLowerCase();
          let organizationId: number | null = scope;
          if (scope !== null) {
            if (orgName) {
              const own = await Organization.findByPk(scope);
              if (!own || own.name.trim().toLowerCase() !== orgName) {
                failedEntries.push(rowFailure(rowNumber, "FORBIDDEN_ORGANIZATION", "school admins can import only into their own school", "school"));
                continue;
              }
            }
          } else if (orgName) {
            if (!orgCache.has(orgName)) {
              orgCache.set(orgName, Organization.findOne({ where: { name: orgName } }));
            }
            const organization = await orgCache.get(orgName)!;
            if (!organization) {
              failedEntries.push(rowFailure(rowNumber, "ORGANIZATION_NOT_FOUND", "school not found; create it before importing", "school"));
              continue;
            }
            organizationId = organization.id;
          }

          let grade = await Grade.findOne({ where: { name: gradeName, organizationId } });
          const alreadyExisted = !!grade;
          if (!grade) {
            grade = await Grade.create({ name: gradeName, organizationId });
          }
          if (organizationId !== null) targetOrganizationIds.add(organizationId);

          successfulEntries.push({
            rowNumber,
            message: alreadyExisted ? "Grade already existed" : "Grade created",
            gradeId: grade.id,
            organizationId,
          });
        } catch (error) {
          failedEntries.push(describeRowError(rowNumber, error));
          logger.error("Grade import row failed", { error, rowNumber });
        }
      }
    }

    await recordImportRun(req, {
      entityType: "grades",
      succeeded: successfulEntries.length,
      failed: failedEntries.length,
      targetOrganizationId:
        targetOrganizationIds.size === 1 ? [...targetOrganizationIds][0] : null,
    });

    res.json({
      message: "Grade import completed",
      total: successfulEntries.length + failedEntries.length,
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
    });
  } catch (error) {
    logger.error("Error processing Excel file (grade import):", { error });
    res.status(500).json({ message: "Internal server error" });
  }
};

const updateGrade = async (req: Request, res: Response) => {
  try {
    const gradeId = Number(req.params.gradeId);
    if (!Number.isInteger(gradeId) || gradeId <= 0) {
      return res.status(400).json({ message: "Invalid grade id" });
    }

    const { name, organizationId } = req.body;

    const grade = await Grade.findByPk(gradeId);
    if (!grade) {
      return res.status(404).json({ message: "Grade not found" });
    }

    const adminScope = getAdminScope(req);
    if (adminScope !== null) {
      if (grade.organizationId === null) {
        return res
          .status(403)
          .json({ message: "School admins cannot modify shared grades" });
      }
      if (grade.organizationId !== adminScope) {
        return res.status(404).json({ message: "Grade not found" });
      }
      if (organizationId !== undefined && Number(organizationId) !== adminScope) {
        return res.status(403).json({
          message: "School admins cannot move grades to another organization",
        });
      }
    }

    const requestedOrganizationId = parseOptionalPositiveId(
      organizationId,
      "organizationId",
    );
    const resolvedOrgId = requestedOrganizationId !== undefined
      ? requestedOrganizationId
      : grade.organizationId;
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({ message: "name must be a non-empty string" });
    }
    const normalizedName = name !== undefined ? name.trim().toLowerCase() : grade.name;

    if (resolvedOrgId) {
      const organization = await Organization.findByPk(resolvedOrgId);
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
    }

    if (name || organizationId !== undefined) {
      const existing = await Grade.findOne({
        where: {
          name: normalizedName,
          organizationId: resolvedOrgId,
        },
      });
      if (existing && existing.id !== gradeId) {
        return res.status(409).json({ message: "Grade name already exists in this school" });
      }
      await grade.update({
        name: normalizedName,
        organizationId: resolvedOrgId,
      });
      await recordAdminAction(req, {
        action: "grade.update",
        targetType: "grade",
        targetId: grade.id,
        targetLabel: grade.name,
        organizationId: grade.organizationId ?? null,
      });
    }

    return res.status(200).json({ data: grade });
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Grade name already exists in this school" });
    }
    logger.error("Error in updateGrade:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const deleteGrade = async (req: Request, res: Response) => {
  try {
    const gradeId = Number(req.params.gradeId);
    if (!gradeId) {
      return res.status(400).json({ message: "Invalid grade id" });
    }

    const grade = await Grade.findByPk(gradeId);
    if (!grade) {
      return res.status(404).json({ message: "Grade not found" });
    }

    const scope = getAdminScope(req);
    if (scope !== null) {
      if (grade.organizationId === null) {
        return res
          .status(403)
          .json({ message: "School admins cannot modify shared grades" });
      }
      if (grade.organizationId !== scope) {
        return res.status(404).json({ message: "Grade not found" });
      }
    }

    const studentCount = await Student.count({ where: { gradeId } });
    const classCount = await Class.count({ where: { gradeId } });

    if (studentCount > 0 || classCount > 0) {
      return res.status(409).json({
        message: "Grade has students or classes assigned, reassign or remove them first",
      });
    }

    await grade.destroy();
    await recordAdminAction(req, {
      action: "grade.delete",
      targetType: "grade",
      targetId: grade.id,
      targetLabel: grade.name,
      organizationId: grade.organizationId ?? null,
    });
    return res.status(200).json({ message: "Grade deleted successfully" });
  } catch (error) {
    logger.error("Error in deleteGrade:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Scores & Gamification Data
// ---------------------------------------------------------------------------

const listScores = async (req: Request, res: Response) => {
  try {
    const {
      search,
      organizationId,
      classId,
      gradeId,
      grade,
      sortBy = "xp",
      sortDir = "desc",
      page = "1",
      limit = "20",
    } = req.query;

    const where: any = {};
    const organizationIdFilter = parseQueryId(organizationId, "organizationId");
    const classIdFilter = parseQueryId(classId, "classId");
    const gradeIdFilter = parseQueryId(gradeId, "gradeId");
    if (organizationIdFilter) where.organizationId = organizationIdFilter;
    if (classIdFilter) where.classId = classIdFilter;
    if (gradeIdFilter) where.gradeId = gradeIdFilter;
    else if (grade) where.grade = String(grade);

    const scope = getAdminScope(req);
    if (scope !== null) where.organizationId = scope;

    const userWhere: any = {};
    if (search) {
      const searchStr = `%${String(search)}%`;
      userWhere[Op.or] = [
        { firstName: { [Op.like]: searchStr } },
        { lastName: { [Op.like]: searchStr } },
        { email: { [Op.like]: searchStr } },
      ];
    }

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const dir = String(sortDir).toUpperCase() === "ASC" ? "ASC" : "DESC";
    let order: any[] = [];

    switch (String(sortBy)) {
      case "level":
        order = [["level", dir], ["xp", "DESC"]];
        break;
      case "medal":
        order = [["medal", dir], ["xp", "DESC"]];
        break;
      case "snabelYellow":
        order = [["snabelYellow", dir]];
        break;
      case "snabelBlue":
        order = [["snabelBlue", dir]];
        break;
      case "snabelRed":
        order = [["snabelRed", dir]];
        break;
      case "treeProgress":
        order = [["treeProgress", dir]];
        break;
      case "totalSanabel":
        order = [["snabelYellow", dir], ["snabelBlue", dir], ["snabelRed", dir]];
        break;
      case "name":
        order = [[{ model: User, as: "user" }, "firstName", dir]];
        break;
      case "xp":
      default:
        order = [["xp", dir]];
        break;
    }

    const includes: any[] = [
      {
        model: User,
        as: "user",
        attributes: ["firstName", "lastName", "email", "profileImg", "gender", "dateOfBirth"],
        where: Reflect.ownKeys(userWhere).length ? userWhere : undefined,
        required: !!search,
      },
      {
        model: Class,
        as: "Class",
        attributes: ["id", "classname", "grade", "gradeId"],
        required: false,
        include: [
          {
            model: Grade,
            as: "GradeEntity",
            attributes: ["id", "name"],
            required: false,
          },
        ],
      },
      {
        model: Grade,
        as: "GradeEntity",
        attributes: ["id", "name"],
        required: false,
      },
      {
        model: Organization,
        as: "organization",
        attributes: ["id", "name"],
        required: false,
      },
      {
        model: Tree,
        as: "Tree",
        attributes: ["id", "stage", "treeProgress"],
        required: false,
      },
    ];

    let rows: any[] = [];
    let count = 0;

    try {
      const result = await Student.findAndCountAll({
        where,
        limit: limitNum,
        offset,
        order,
        distinct: true,
        include: includes,
      });
      rows = result.rows;
      count = result.count;
    } catch (queryErr) {
      logger.warn("listScores query with Tree failed, trying fallback without Tree:", { error: queryErr });
      const fallbackResult = await Student.findAndCountAll({
        where,
        limit: limitNum,
        offset,
        order,
        distinct: true,
        include: includes.filter((inc) => inc.model !== Tree),
      });
      rows = fallbackResult.rows;
      count = fallbackResult.count;
    }

    const [aggResult] = await Student.sequelize!.query(
      `SELECT
        COALESCE(SUM(xp), 0) AS totalXp,
        COALESCE(SUM(snabelYellow + snabelBlue + snabelRed), 0) AS totalSanabel,
        COALESCE(MAX(level), 1) AS maxLevel,
        COALESCE(SUM(CASE WHEN xp > 0 OR snabelYellow > 0 OR snabelBlue > 0 OR snabelRed > 0 OR level > 1 THEN 1 ELSE 0 END), 0) AS playingStudents
      FROM Students
      ${scope !== null ? "WHERE organizationId = :scope" : ""}`,
      {
        type: QueryTypes.SELECT,
        replacements: scope !== null ? { scope } : {},
      },
    );

    const agg = (aggResult as any) || {};
    const totalXp = Number(agg.totalXp || 0);
    const totalSanabel = Number(agg.totalSanabel || 0);
    const maxLevel = Number(agg.maxLevel || 1);
    const playingStudents = Number(agg.playingStudents || 0);

    return res.status(200).json({
      data: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
      stats: {
        totalStudents: count,
        playingStudents,
        totalXp,
        totalSanabel,
        maxLevel,
      },
    });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in listScores:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Task Completion History Log
// ---------------------------------------------------------------------------

const listTaskHistory = async (req: Request, res: Response) => {
  try {
    const {
      search,
      organizationId,
      classId,
      gradeId,
      date,
      page = "1",
      limit = "20",
    } = req.query;

    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    const studentWhere: any = {};
    const organizationIdFilter = parseQueryId(organizationId, "organizationId");
    const classIdFilter = parseQueryId(classId, "classId");
    const gradeIdFilter = parseQueryId(gradeId, "gradeId");
    if (organizationIdFilter) studentWhere.organizationId = organizationIdFilter;
    if (classIdFilter) studentWhere.classId = classIdFilter;
    if (gradeIdFilter) studentWhere.gradeId = gradeIdFilter;

    const scope = getAdminScope(req);
    if (scope !== null) studentWhere.organizationId = scope;

    const taskHistoryWhere: any = {
      completionStatus: "Completed",
    };
    if (date) {
      taskHistoryWhere.date = date;
    }

    let rows: any[] = [];
    let count = 0;

    try {
      const result = await StudentTask.findAndCountAll({
        where: taskHistoryWhere,
        limit: limitNum,
        offset,
        order: [["updatedAt", "DESC"], ["id", "DESC"]],
        distinct: true,
        include: [
          {
            model: Student,
            as: "Student",
            where: Object.keys(studentWhere).length ? studentWhere : undefined,
            required: Object.keys(studentWhere).length > 0,
            include: [
              {
                model: User,
                as: "user",
                attributes: ["firstName", "lastName", "email", "profileImg"],
                required: false,
              },
              {
                model: Class,
                as: "Class",
                attributes: ["id", "classname", "grade"],
                required: false,
              },
              {
                model: Grade,
                as: "GradeEntity",
                attributes: ["id", "name"],
                required: false,
              },
              {
                model: Organization,
                as: "organization",
                attributes: ["id", "name"],
                required: false,
              },
            ],
          },
          {
            model: Task,
            as: "Task",
            attributes: ["id", "title", "description", "type", "xp", "snabelRed", "snabelBlue", "snabelYellow"],
            required: false,
            include: [
              {
                model: TaskCategory,
                as: "category",
                attributes: ["id", "title"],
                required: false,
              },
            ],
          },
          {
            model: Parent,
            as: "Parent",
            required: false,
            include: [
              {
                model: User,
                as: "user",
                attributes: ["firstName", "lastName", "email"],
                required: false,
              },
            ],
          },
          {
            model: Teacher,
            as: "Teacher",
            required: false,
            include: [
              {
                model: User,
                as: "user",
                attributes: ["firstName", "lastName", "email"],
                required: false,
              },
            ],
          },
        ],
      });
      rows = result.rows;
      count = result.count;
    } catch (queryErr) {
      logger.warn("listTaskHistory full query failed, trying simplified query:", { error: queryErr });
      const simplified = await StudentTask.findAndCountAll({
        where: taskHistoryWhere,
        limit: limitNum,
        offset,
        order: [["id", "DESC"]],
        distinct: true,
        include: [
          {
            model: Student,
            as: "Student",
            required: false,
            include: [
              {
                model: User,
                as: "user",
                attributes: ["firstName", "lastName", "email"],
                required: false,
              },
            ],
          },
          {
            model: Task,
            as: "Task",
            attributes: ["id", "title", "xp", "snabelRed", "snabelBlue", "snabelYellow"],
            required: false,
          },
        ],
      });
      rows = simplified.rows;
      count = simplified.count;
    }

    // Filter by search text if provided (student name, email, task title)
    let filteredRows = rows;
    if (search && typeof search === "string" && search.trim() !== "") {
      const q = search.trim().toLowerCase();
      filteredRows = rows.filter((item: any) => {
        const studentUser = item.Student?.user;
        const sName = `${studentUser?.firstName || ""} ${studentUser?.lastName || ""}`.toLowerCase();
        const sEmail = (studentUser?.email || "").toLowerCase();
        const taskTitle = (item.Task?.title || "").toLowerCase();
        return sName.includes(q) || sEmail.includes(q) || taskTitle.includes(q);
      });
    }

    const todayStr = new Date().toISOString().split("T")[0];
    let completedToday = 0;
    try {
      completedToday = await StudentTask.count({
        where: {
          completionStatus: "Completed",
          date: todayStr,
        },
        include:
          scope !== null
            ? [
                {
                  model: Student,
                  as: "Student",
                  where: { organizationId: scope },
                  required: true,
                  attributes: [],
                },
              ]
            : undefined,
      });
    } catch {
      /* silent */
    }

    return res.status(200).json({
      data: filteredRows,
      total: search ? filteredRows.length : count,
      page: pageNum,
      limit: limitNum,
      stats: {
        totalCompleted: count,
        completedToday,
      },
    });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in listTaskHistory:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const createImpersonationHandoff = async (req: Request, res: Response) => {
  try {
    const actingAdmin = (req as Request & { user: JwtPayload | undefined }).user;
    if (!actingAdmin) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const rawId = req.params.studentId || req.params.id || req.body?.studentId || req.body?.userId;
    const targetId = Number(rawId);
    if (!targetId) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    // Try finding by Student.id or User.id
    let student = await Student.findOne({
      where: { id: targetId },
      include: [{ model: User, as: "user" }],
    });

    let targetUser: User | null = null;
    if (student && student.user) {
      targetUser = student.user as unknown as User;
    } else {
      // Check if targetId is User.id with role Student
      targetUser = await User.findOne({
        where: { id: targetId, role: "Student" },
      });
      if (targetUser) {
        student = await Student.findOne({
          where: { userId: targetUser.id },
        });
      }
    }

    if (!targetUser || !student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Enforce school admin scope: if not super admin, check if student belongs to acting admin's school
    const scope = getAdminScope(req);
    if (scope !== null && student.organizationId !== scope) {
      return res.status(403).json({ message: "Forbidden: Student does not belong to your organization" });
    }

    // Generate cryptographic handoff code (32 bytes entropy = 256 bits)
    const code = crypto.randomBytes(32).toString("hex");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const ttlSeconds = 90;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await AdminImpersonationHandoff.create({
      codeHash,
      actorAdminUserId: actingAdmin.id,
      targetUserId: targetUser.id,
      targetStudentId: student.id,
      organizationId: student.organizationId ?? null,
      expiresAt,
      usedAt: null,
    });

    logger.info("ADMIN_IMPERSONATION_STARTED", {
      actorAdminUserId: actingAdmin.id,
      adminEmail: actingAdmin.email,
      targetStudentId: student.id,
      targetUserId: targetUser.id,
      organizationId: student.organizationId,
      expiresAt: expiresAt.toISOString(),
    });

    const studentName = `${targetUser.firstName || ""} ${targetUser.lastName || ""}`.trim() || "Student";
    await recordAdminAction(req, {
      action: "student.impersonate",
      targetType: "student",
      targetId: student.id,
      targetLabel: userLabel(targetUser),
      organizationId: student.organizationId ?? null,
    });

    return res.status(200).json({
      status: 200,
      message: "Impersonation handoff code generated successfully",
      data: {
        code,
        expiresAt: expiresAt.toISOString(),
        ttlSeconds,
        student: {
          id: student.id,
          name: studentName,
        },
      },
    });
  } catch (error) {
    logger.error("Error in createImpersonationHandoff:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const impersonateStudent = createImpersonationHandoff;

// ---------------------------------------------------------------------------
// Import analytics  (GET /admin/import-analytics)
// Gate: checkAdmin - School Admin sees their org only, Super Admin sees all.
// ---------------------------------------------------------------------------
const getImportAnalytics = async (req: Request, res: Response) => {
  try {
    const scope = getAdminScope(req);
    const baseWhere: any = {};
    if (scope !== null) baseWhere.organizationId = scope;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayCount, monthCount, totalsResult, recentRuns] = await Promise.all([
      ImportRun.count({ where: { ...baseWhere, createdAt: { [Op.gte]: todayStart } } }),
      ImportRun.count({ where: { ...baseWhere, createdAt: { [Op.gte]: monthStart } } }),
      ImportRun.findAll({
        where: baseWhere,
        attributes: [
          [ImportRun.sequelize!.fn("SUM", ImportRun.sequelize!.col("totalRows")), "totalRows"],
          [ImportRun.sequelize!.fn("SUM", ImportRun.sequelize!.col("succeeded")), "totalSucceeded"],
          [ImportRun.sequelize!.fn("SUM", ImportRun.sequelize!.col("failed")), "totalFailed"],
        ],
        raw: true,
      }),
      ImportRun.findAll({
        where: baseWhere,
        order: [["createdAt", "DESC"]],
        limit: 10,
        include: [
          { model: User, as: "adminUser", attributes: ["firstName", "lastName", "email"] },
          { model: Organization, as: "organization", attributes: ["name"] },
        ],
      }),
    ]);

    const totals = (totalsResult as any[])[0] || {};

    return res.status(200).json({
      data: {
        todayCount,
        monthCount,
        totalRowsProcessed: Number(totals.totalRows) || 0,
        totalSucceeded: Number(totals.totalSucceeded) || 0,
        totalFailed: Number(totals.totalFailed) || 0,
        granularity: "batch",
        note: IMPORT_RUN_GRANULARITY_NOTE,
        recentRuns: recentRuns.map((r: any) => ({
          id: r.id,
          adminName: `${r.adminUser?.firstName || ""} ${r.adminUser?.lastName || ""}`.trim() || "Admin",
          adminEmail: r.adminUser?.email || "",
          organizationName: r.organization?.name || null,
          entityType: r.entityType,
          totalRows: r.totalRows,
          succeeded: r.succeeded,
          failed: r.failed,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (error) {
    logger.error("Error in getImportAnalytics:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Data quality counters (GET /admin/data-quality)
// Gate: Super Admin only
// ---------------------------------------------------------------------------
const getDataQuality = async (req: Request, res: Response) => {
  try {
    const adminProfileModel = (await import("../models/admin.model")).default;

    const [
      schoolStudentsWithoutClass,
      schoolStudentsWithoutGrade,
      classesWithoutTeacher,
      allAdminUsers,
      allProfiles,
      orphanedStudents,
    ] = await Promise.all([
      Student.count({
        where: {
          organizationId: { [Op.ne]: null },
          classId: null,
        },
      }),
      Student.count({
        where: {
          organizationId: { [Op.ne]: null },
          gradeId: null,
        },
      }),
      Class.count({
        where: {
          teacherId: null,
        },
      }),
      User.findAll({
        where: { role: "Admin" } as any,
        attributes: ["id"],
        raw: true,
      }),
      adminProfileModel.findAll({
        attributes: ["userId"],
        raw: true,
      }),
      Student.sequelize!.query(
        `SELECT COUNT(*) AS cnt FROM Students s LEFT JOIN Users u ON u.id = s.userId WHERE u.id IS NULL`,
        { type: QueryTypes.SELECT }
      ),
    ]);

    const profiledIds = new Set((allProfiles as any[]).map((p) => p.userId));
    const adminUsersWithoutAdminProfile = (allAdminUsers as any[]).filter(
      (u) => !profiledIds.has(u.id)
    ).length;
    const orphanedCount = Number((orphanedStudents as any[])[0]?.cnt) || 0;

    return res.status(200).json({
      data: {
        schoolStudentsWithoutClass,
        schoolStudentsWithoutGrade,
        classesWithoutTeacher,
        adminUsersWithoutAdminProfile,
        orphanedStudents: orphanedCount,
      },
    });
  } catch (error) {
    logger.error("Error in getDataQuality:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Data quality detail (GET /admin/data-quality/detail)
// Gate: Super Admin only
// ---------------------------------------------------------------------------
const getDataQualityDetail = async (req: Request, res: Response) => {
  try {
    const { issue, page = "1", limit = "20", organizationId: orgFilter } = req.query;
    const orgFilterId = parseQueryId(orgFilter, "organizationId");
    const { pageNum, limitNum, offset } = parsePagination(page, limit);

    let rows: any[] = [];
    let total = 0;

    if (issue === "school_student_no_class") {
      const where: any = { organizationId: { [Op.ne]: null }, classId: null };
      if (orgFilterId) where.organizationId = orgFilterId;
      const { rows: found, count } = await Student.findAndCountAll({
        where,
        include: [
          { model: User, as: "user", attributes: ["firstName", "lastName", "email"] },
          { model: Organization, as: "organization", attributes: ["id", "name"] },
        ],
        limit: limitNum,
        offset,
        order: [["id", "DESC"]],
      });
      rows = found;
      total = count;
    } else if (issue === "school_student_no_grade") {
      const where: any = { organizationId: { [Op.ne]: null }, gradeId: null };
      if (orgFilterId) where.organizationId = orgFilterId;
      const { rows: found, count } = await Student.findAndCountAll({
        where,
        include: [
          { model: User, as: "user", attributes: ["firstName", "lastName", "email"] },
          { model: Organization, as: "organization", attributes: ["id", "name"] },
        ],
        limit: limitNum,
        offset,
        order: [["id", "DESC"]],
      });
      rows = found;
      total = count;
    } else if (issue === "class_no_teacher") {
      const where: any = { teacherId: null };
      if (orgFilterId) where.organizationId = orgFilterId;
      const { rows: found, count } = await Class.findAndCountAll({
        where,
        include: [{ model: Organization, as: "organization", attributes: ["id", "name"] }],
        limit: limitNum,
        offset,
        order: [["updatedAt", "DESC"]],
      });
      rows = found;
      total = count;
    } else if (issue === "admin_no_profile") {
      const allAdminUsers = await User.findAll({
        where: { role: "Admin" } as any,
        attributes: ["id", "firstName", "lastName", "email", "createdAt"],
      });
      const adminProfileModel = (await import("../models/admin.model")).default;
      const allProfiles = await adminProfileModel.findAll({ attributes: ["userId"] });
      const profiledIds = new Set(allProfiles.map((a: any) => a.userId));
      const unprofiled = allAdminUsers.filter((u) => !profiledIds.has(u.id));
      total = unprofiled.length;
      rows = unprofiled.slice(offset, offset + limitNum);
    } else {
      return res.status(400).json({ message: "Unknown issue type" });
    }

    return res.status(200).json({ data: rows, total, page: pageNum, limit: limitNum });
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return res.status(400).json({ message: error.message, field: error.field });
    }
    logger.error("Error in getDataQualityDetail:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// School admin dashboard  (GET /admin/school-dashboard)
// Gate: checkAdmin - School Admin gets scoped, Super Admin gets global.
// ---------------------------------------------------------------------------
const getSchoolAdminDashboard = async (req: Request, res: Response) => {
  try {
    const scope = getAdminScope(req);
    const orgWhere: any = scope !== null ? { organizationId: scope } : {};

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Every query below is either a COUNT over one school or a LIMITed feed.
    // Twelve bounded queries in one round trip, so the page needs one request
    // and MySQL sees no unbounded scan.
    const [
      studentCount,
      teacherCount,
      classCount,
      pendingApprovals,
      completionsToday,
      completionsThisWeek,
      importRunCount,
      gradeCount,
      newStudentsToday,
      newStudentsThisWeek,
      assignmentSources,
      recentCompletions,
      recentApprovals,
    ] = await Promise.all([
      Student.count({ where: orgWhere }),
      Teacher.count({ where: orgWhere }),
      Class.count({ where: orgWhere }),
      Student.sequelize!.query(
        scope !== null
          ? `SELECT COUNT(*) AS cnt FROM MissionApprovalRequests mar
             JOIN Students s ON s.id = mar.studentId
             WHERE mar.status = 'pending' AND s.organizationId = :scope`
          : `SELECT COUNT(*) AS cnt FROM MissionApprovalRequests WHERE status = 'pending'`,
        { type: QueryTypes.SELECT, replacements: scope !== null ? { scope } : {} },
      ),
      StudentTask.count({
        where: { createdAt: { [Op.gte]: todayStart } },
        ...(scope !== null
          ? { include: [{ model: Student, as: "Student", where: { organizationId: scope }, attributes: [], required: true }] }
          : {}),
      }),
      StudentTask.count({
        where: { createdAt: { [Op.gte]: weekAgo } },
        ...(scope !== null
          ? { include: [{ model: Student, as: "Student", where: { organizationId: scope }, attributes: [], required: true }] }
          : {}),
      }),
      ImportRun.count({ where: scope !== null ? { organizationId: scope } : {} }),
      // Grades this school administers. The acting admin has no grade of their
      // own; this counts records they manage.
      Grade.count({ where: orgWhere }),
      Student.count({ where: { ...orgWhere, createdAt: { [Op.gte]: todayStart } } as any }),
      Student.count({ where: { ...orgWhere, createdAt: { [Op.gte]: weekAgo } } as any }),
      // Teacher/parent assignment SOURCE rows for this school's students. Same
      // counting unit as the global assignments analytics: an item assigned by
      // both a teacher and a parent is two assignments.
      Student.sequelize!.query(
        scope !== null
          ? `SELECT COUNT(*) AS cnt
             FROM StudentTodoSources sts
             JOIN StudentTodoItems sti ON sti.id = sts.todoItemId
             JOIN Students s ON s.id = sti.studentId
             WHERE sts.sourceType IN ('teacher','parent') AND s.organizationId = :scope`
          : `SELECT COUNT(*) AS cnt
             FROM StudentTodoSources
             WHERE sourceType IN ('teacher','parent')`,
        { type: QueryTypes.SELECT, replacements: scope !== null ? { scope } : {} },
      ),
      // Recent feeds, bounded at ten rows each.
      Student.sequelize!.query(
        `SELECT st.id, st.createdAt, st.completionSource,
                CONCAT_WS(' ', u.firstName, u.lastName) AS studentName,
                t.title AS missionTitle
         FROM StudentTasks st
         JOIN Students s ON s.id = st.studentId
         LEFT JOIN Users u ON u.id = s.userId
         LEFT JOIN Tasks t ON t.id = st.taskId
         WHERE st.completionStatus = 'Completed'
           ${scope !== null ? 'AND s.organizationId = :scope' : ''}
         ORDER BY st.createdAt DESC
         LIMIT 10`,
        { type: QueryTypes.SELECT, replacements: scope !== null ? { scope } : {} },
      ),
      Student.sequelize!.query(
        `SELECT mar.id, mar.status, mar.createdAt, mar.missionDate, mar.approvedByType,
                CONCAT_WS(' ', u.firstName, u.lastName) AS studentName,
                t.title AS missionTitle
         FROM MissionApprovalRequests mar
         JOIN Students s ON s.id = mar.studentId
         LEFT JOIN Users u ON u.id = s.userId
         LEFT JOIN Tasks t ON t.id = mar.missionId
         WHERE 1 = 1
           ${scope !== null ? 'AND s.organizationId = :scope' : ''}
         ORDER BY mar.createdAt DESC
         LIMIT 10`,
        { type: QueryTypes.SELECT, replacements: scope !== null ? { scope } : {} },
      ),
    ]);

    return res.status(200).json({
      data: {
        organizationId: scope,
        students: studentCount,
        teachers: teacherCount,
        classes: classCount,
        grades: gradeCount,
        pendingApprovals: Number((pendingApprovals as any[])[0]?.cnt) || 0,
        completionsToday,
        completionsThisWeek,
        newStudentsToday,
        newStudentsThisWeek,
        // Assignment source rows, not distinct To-Do items. Named so the
        // counting unit travels with the number.
        assignmentSources: Number((assignmentSources as any[])[0]?.cnt) || 0,
        // Import batches of up to 50 rows, not uploaded files.
        totalImportBatches: importRunCount,
        totalImportRuns: importRunCount,
        recentCompletions,
        recentApprovals,
      },
    });
  } catch (error) {
    logger.error("Error in getSchoolAdminDashboard:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// School warnings  (GET /admin/school-data-quality)
// Gate: checkAdmin. Scope: the acting admin's own organization, taken from
// `Admins.organizationId` — never from the request.
//
// This is the School Admin's answer to "what is broken in MY school". It is a
// separate endpoint from the Super Admin's `/admin/data-quality` rather than
// the same one filtered, because filtering a global query in the client is not
// a scope boundary.
//
// What is NOT counted, because it is valid data:
//   - a Solo learner with no organization, class or grade. This endpoint only
//     ever looks inside one organization, so a Solo learner cannot appear in
//     it at all.
//   - the acting admin's own missing grade or class. A School Admin has
//     neither by design; they administer many of both. Nothing here reads or
//     reports an admin's own academic fields.
// ---------------------------------------------------------------------------
const getSchoolDataQuality = async (req: Request, res: Response) => {
  try {
    const scope = getAdminScope(req);

    // A Super Admin has no single school to report on. Sending them the whole
    // platform under a "my school" shape would misrepresent the numbers, so
    // they are pointed at the global endpoint instead.
    if (scope === null) {
      return res.status(400).json({
        message: "This endpoint reports one school. Use /admin/data-quality for the platform view.",
      });
    }

    const staleApprovalDays = 7;
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - staleApprovalDays);

    const [
      studentsWithoutClass,
      studentsWithoutGrade,
      classesWithoutTeacher,
      studentsWithoutUser,
      classesWithoutGrade,
      staleApprovalRows,
      failedImportRows,
    ] = await Promise.all([
      // Enrolled in THIS school and missing a class. `organizationId: scope`
      // is what makes a Solo learner structurally unable to appear here.
      Student.count({ where: { organizationId: scope, classId: null } as any }),
      Student.count({ where: { organizationId: scope, gradeId: null } as any }),
      Class.count({ where: { organizationId: scope, teacherId: null } as any }),
      Student.count({ where: { organizationId: scope, userId: null } as any }),
      Class.count({ where: { organizationId: scope, gradeId: null } as any }),
      Student.sequelize!.query(
        `SELECT COUNT(*) AS cnt FROM MissionApprovalRequests mar
         JOIN Students s ON s.id = mar.studentId
         WHERE mar.status = 'pending'
           AND s.organizationId = :scope
           AND mar.createdAt < :cutoff`,
        { type: QueryTypes.SELECT, replacements: { scope, cutoff: staleCutoff } },
      ),
      // Import batches for this school that refused at least one row. Counts
      // only — `ImportRuns` stores no row contents by design.
      ImportRun.findAll({
        where: { organizationId: scope, failed: { [Op.gt]: 0 } } as any,
        attributes: ["id", "entityType", "totalRows", "succeeded", "failed", "createdAt"],
        order: [["createdAt", "DESC"]],
        limit: 10,
      }),
    ]);

    const oldPendingApprovals = Number((staleApprovalRows as any[])[0]?.cnt) || 0;
    const failedImports = failedImportRows.length;

    const counts = {
      studentsWithoutClass,
      studentsWithoutGrade,
      classesWithoutTeacher,
      classesWithoutGrade,
      studentsWithoutUser,
      oldPendingApprovals,
      failedImportBatches: failedImports,
    };

    return res.status(200).json({
      data: {
        organizationId: scope,
        counts,
        totalWarnings: Object.values(counts).reduce((sum, value) => sum + value, 0),
        staleApprovalThresholdDays: staleApprovalDays,
        recentFailedImports: failedImportRows.map((run: any) => ({
          id: run.id,
          entityType: run.entityType,
          totalRows: run.totalRows,
          succeeded: run.succeeded,
          failed: run.failed,
          createdAt: run.createdAt,
        })),
        notes: {
          soloLearners:
            "Solo learners have no school, class or grade by design and are never counted here.",
          adminAcademics:
            "A School Admin has no grade or class of their own. Admin accounts are not inspected by this endpoint.",
          importGranularity:
            "Failed import entries are batches of up to 50 rows, not uploaded files. Row-level failures are not stored.",
        },
      },
    });
  } catch (error) {
    logger.error("Error in getSchoolDataQuality:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ── Leaderboard settings ─────────────────────────────────────────────────────

/**
 * GET /admin/leaderboard-settings
 * GET /admin/leaderboard-settings/:orgId  (Super Admin only for specific org)
 *
 * School Admin: returns their own organization's settings.
 * Super Admin:  returns all organizations' settings (paginated list) or a
 *               single organization when :orgId is supplied.
 */
const getLeaderboardSettings = async (req: Request, res: Response) => {
  const request = req as Request & { adminOrganizationId?: number | null };
  const schoolOrgId = request.adminOrganizationId;
  const isSchoolAdmin = schoolOrgId !== null && schoolOrgId !== undefined;

  try {
    if (isSchoolAdmin) {
      const org = await Organization.findByPk(schoolOrgId!, {
        attributes: ["id", "name", "leaderboardScope", "leaderboardLimit", "hideZeroXpStudents"],
      });
      if (!org) return res.status(404).json({ message: "Organization not found" });
      return res.status(200).json({ organizations: [org] });
    }

    // Super Admin: list all or fetch one.
    const { orgId } = req.params;
    if (orgId) {
      const org = await Organization.findByPk(orgId, {
        attributes: ["id", "name", "leaderboardScope", "leaderboardLimit", "hideZeroXpStudents"],
      });
      if (!org) return res.status(404).json({ message: "Organization not found" });
      return res.status(200).json({ organizations: [org] });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await Organization.findAndCountAll({
      attributes: ["id", "name", "leaderboardScope", "leaderboardLimit", "hideZeroXpStudents"],
      limit,
      offset,
      order: [["name", "ASC"]],
    });

    return res.status(200).json({
      organizations: rows,
      total: count,
      page,
      limit,
    });
  } catch (error) {
    logger.error("Error in getLeaderboardSettings:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const VALID_SCOPES = ["all_school", "same_grade", "same_class"] as const;

/**
 * PUT /admin/leaderboard-settings/:orgId
 *
 * School Admin can only update their own organization (the server enforces this;
 * the :orgId in the URL is verified against their scope).
 * Super Admin can update any organization.
 *
 * Body fields (all optional — only supplied fields are changed):
 *   leaderboardScope: "all_school" | "same_grade" | "same_class"
 *   leaderboardLimit: number (1–500)
 *   hideZeroXpStudents: boolean
 */
const updateLeaderboardSettings = async (req: Request, res: Response) => {
  const request = req as Request & { adminOrganizationId?: number | null };
  const schoolOrgId = request.adminOrganizationId;
  const isSchoolAdmin = schoolOrgId !== null && schoolOrgId !== undefined;

  const targetOrgId = Number(req.params.orgId);
  if (!targetOrgId || isNaN(targetOrgId)) {
    return res.status(400).json({ message: "Invalid organization id" });
  }

  // School Admin can only edit their own school.
  if (isSchoolAdmin && targetOrgId !== schoolOrgId) {
    return res.status(403).json({ message: "You can only update your own organization's settings." });
  }

  const { leaderboardScope, leaderboardLimit, hideZeroXpStudents } = req.body as {
    leaderboardScope?: string;
    leaderboardLimit?: number;
    hideZeroXpStudents?: boolean;
  };

  const updates: Record<string, unknown> = {};

  if (leaderboardScope !== undefined) {
    if (!(VALID_SCOPES as readonly string[]).includes(leaderboardScope)) {
      return res.status(400).json({
        message: `leaderboardScope must be one of: ${VALID_SCOPES.join(", ")}`,
      });
    }
    updates.leaderboardScope = leaderboardScope;
  }

  if (leaderboardLimit !== undefined) {
    const lim = Number(leaderboardLimit);
    if (!Number.isInteger(lim) || lim < 1 || lim > 500) {
      return res.status(400).json({ message: "leaderboardLimit must be an integer between 1 and 500" });
    }
    updates.leaderboardLimit = lim;
  }

  if (hideZeroXpStudents !== undefined) {
    if (typeof hideZeroXpStudents !== "boolean") {
      return res.status(400).json({ message: "hideZeroXpStudents must be a boolean" });
    }
    updates.hideZeroXpStudents = hideZeroXpStudents;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: "No valid fields supplied for update" });
  }

  try {
    const org = await Organization.findByPk(targetOrgId);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    await org.update(updates);
    await recordAdminAction(req, {
      action: "leaderboard.update",
      targetType: "organization",
      targetId: org.id,
      targetLabel: org.name,
      organizationId: org.id,
      details: updates,
    });

    return res.status(200).json({
      message: "Leaderboard settings updated",
      organization: {
        id: org.id,
        name: org.name,
        leaderboardScope: org.leaderboardScope,
        leaderboardLimit: org.leaderboardLimit,
        hideZeroXpStudents: org.hideZeroXpStudents,
      },
    });
  } catch (error) {
    logger.error("Error in updateLeaderboardSettings:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export {
  getAdminProfile,
  getAdminStats,
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listStudents,
  getStudentDetail,
  updateStudent,
  deleteStudent,
  listUsers,
  listTeachers,
  listParents,
  createUser,
  updateUser,
  deleteUser,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  resetUserPassword,
  listGrades,
  createGrade,
  updateGrade,
  deleteGrade,
  importGrades,
  listScores,
  listTaskHistory,
  impersonateStudent,
  createImpersonationHandoff,
  getImportAnalytics,
  getDataQuality,
  getDataQualityDetail,
  getSchoolAdminDashboard,
  getSchoolDataQuality,
  getLeaderboardSettings,
  updateLeaderboardSettings,
  parsePagination,
};
