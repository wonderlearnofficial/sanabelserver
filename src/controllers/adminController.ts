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
import { QueryTypes } from "sequelize";
import { signAccessToken, signRefreshToken } from "../helpers/tokens";
import { generatePassword } from "../helpers/generatePassword";
import generateUniqueConnectCode from "../helpers/generateRandomconnectcode";
import { getImportField } from "../helpers/importFieldLookup";
import {
  InvalidOptionalIdError,
  parseOptionalPositiveId,
} from "../helpers/optionalId";
import { buildCategoryCounts } from "../helpers/taskCategoryStats";

const DEFAULT_RESET_PASSWORD = "changeme123";

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
  if (userRecord.role === "Parent") {
    const parent = await Parent.findOne({
      where: { userId: userRecord.id },
      transaction,
    });
    if (!parent) return false;
    const count = await Student.count({
      where: { ParentId: parent.id, organizationId: scope } as any,
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

    return res.status(200).json({ data: admin });
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
      // School admin: everything counted within their organization only
      const [students, teachers, classes, parentLinks] = await Promise.all([
        Student.count({ where: { organizationId: scope } }),
        Teacher.count({ where: { organizationId: scope } }),
        Class.count({ where: { organizationId: scope } }),
        Student.findAll({
          where: { organizationId: scope, ParentId: { [Op.ne]: null } } as any,
          attributes: ["ParentId"],
          raw: true,
        }),
      ]);
      const parents = new Set(parentLinks.map((r: any) => r.ParentId)).size;

      return res.status(200).json({
        data: {
          users: students + teachers + parents,
          students,
          teachers,
          parents,
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
    if (type) where.type = type;

    // School admins only ever see their own school
    const scope = getAdminScope(req);
    if (scope !== null) where.id = scope;

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

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
      await organization.update(updateData);
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
      page = "1",
      limit = "20",
    } = req.query;

    const where: any = {};
    if (organizationId) where.organizationId = organizationId;
    if (classId) where.classId = classId;
    if (gradeId) where.gradeId = gradeId;
    else if (grade) where.grade = grade;

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

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

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
          where: Object.keys(userWhere).length ? userWhere : undefined,
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
      ],
    });

    return res.status(200).json({
      data: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
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

    const { firstName, lastName, email, gradeId, grade, organizationId, classId, profileImg } = req.body;
    const requestedOrganizationId = parseOptionalPositiveId(organizationId, "organizationId");
    const requestedClassId = parseOptionalPositiveId(classId, "classId");
    const requestedGradeId = parseOptionalPositiveId(gradeId, "gradeId");

    return await User.sequelize!.transaction(async (transaction) => {
      const student = await Student.findByPk(studentId, { transaction });
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const scope = getAdminScope(req);
      if (scope !== null) {
        if (student.organizationId !== scope) {
          return res.status(404).json({ message: "Student not found" });
        }
        // A school admin can never move a student out of their school
        if (requestedOrganizationId !== undefined && requestedOrganizationId !== scope) {
          return res.status(403).json({
            message: "School admins cannot move students to another organization",
          });
        }
      }

      const userRecord = student.userId
        ? await User.findOne({ where: { id: student.userId }, transaction })
        : null;

      const resultingOrganizationId = requestedOrganizationId !== undefined
        ? requestedOrganizationId
        : student.organizationId;

      if (requestedOrganizationId !== undefined && requestedOrganizationId !== null) {
        const organization = await Organization.findByPk(requestedOrganizationId, { transaction });
        if (!organization) {
          return res.status(400).json({ message: "Target organization does not exist" });
        }
      }

      if (requestedClassId !== undefined && requestedClassId !== null) {
        const targetClass = await Class.findByPk(requestedClassId, { transaction });
        if (!targetClass) {
          return res.status(400).json({ message: "Target class does not exist" });
        }
        if (targetClass.organizationId !== resultingOrganizationId) {
          return res.status(400).json({
            message: "Target class does not belong to the student's organization",
          });
        }
      }

      const userUpdateData: Record<string, any> = {};
      if (firstName) userUpdateData.firstName = firstName;
      if (lastName) userUpdateData.lastName = lastName;
      if (email) userUpdateData.email = email;
      if (profileImg && typeof profileImg === "object") userUpdateData.profileImg = profileImg;

      const studentUpdateData: Record<string, any> = {};
      if (requestedGradeId !== undefined) {
        if (requestedGradeId === null) {
          studentUpdateData.gradeId = null;
          studentUpdateData.grade = null;
        } else {
          const gradeRecord = await Grade.findByPk(requestedGradeId, { transaction });
          if (!gradeRecord) {
            return res.status(400).json({ message: "Target grade does not exist" });
          }
          studentUpdateData.gradeId = gradeRecord.id;
          studentUpdateData.grade = gradeRecord.name;
        }
      } else if (grade !== undefined) {
        studentUpdateData.grade = grade === "" ? null : grade;
      }
      if (requestedOrganizationId !== undefined) {
        studentUpdateData.organizationId = resultingOrganizationId;
        if (resultingOrganizationId === null) studentUpdateData.classId = null;
      }
      if (requestedClassId !== undefined) studentUpdateData.classId = requestedClassId;

      if (userRecord && Object.keys(userUpdateData).length > 0) {
        await userRecord.update(userUpdateData, { transaction });
      }
      if (Object.keys(studentUpdateData).length > 0) {
        await Student.update(studentUpdateData, {
          where: { id: student.id },
          transaction,
          // Avoid Sequelize v7 alpha instance dirty-state dropping explicit
          // null/empty relationship clears. The fields were normalized and
          // relationship-validated above, and remain in this transaction.
          fields: Object.keys(studentUpdateData),
        });
      }

      return res.status(200).json({ message: "Student updated successfully" });
    });
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
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
    if (role) where.role = role;
    if (verified === "true") where.isAccess = true;
    if (search) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${String(search)}%` } },
        { lastName: { [Op.like]: `%${String(search)}%` } },
        { email: { [Op.like]: `%${String(search)}%` } },
      ];
    }

    // School admins only see users belonging to their school: its students
    // and teachers, plus parents linked to its students. Admin accounts are
    // never visible to them.
    const scope = getAdminScope(req);
    if (scope !== null) {
      const [studentRows, teacherRows] = await Promise.all([
        Student.findAll({
          where: { organizationId: scope },
          attributes: ["userId", "ParentId"],
          raw: true,
        }),
        Teacher.findAll({
          where: { organizationId: scope },
          attributes: ["userId"],
          raw: true,
        }),
      ]);
      const parentIds = Array.from(
        new Set(studentRows.map((r: any) => r.ParentId).filter(Boolean)),
      );
      const parentRows = parentIds.length
        ? await Parent.findAll({
            where: { id: parentIds },
            attributes: ["userId"],
            raw: true,
          })
        : [];
      const scopedUserIds = [
        ...studentRows.map((r: any) => r.userId),
        ...teacherRows.map((r: any) => r.userId),
        ...parentRows.map((r: any) => r.userId),
      ].filter(Boolean);
      // [0] keeps the IN clause valid when the school has no members yet
      where.id = { [Op.in]: scopedUserIds.length ? scopedUserIds : [0] };
    }

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

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
    const { search, organizationId, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (organizationId) where.organizationId = organizationId;

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

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

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
          where: Object.keys(userWhere).length ? userWhere : undefined,
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
    logger.error("Error in listTeachers:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const listParents = async (req: Request, res: Response) => {
  try {
    const { search, page = "1", limit = "20" } = req.query;

    const userWhere: any = {};
    if (search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${String(search)}%` } },
        { lastName: { [Op.like]: `%${String(search)}%` } },
        { email: { [Op.like]: `%${String(search)}%` } },
      ];
    }

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    const { rows, count } = await Parent.findAndCountAll({
      limit: limitNum,
      offset,
      order: [["id", "ASC"]],
      distinct: true,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "email"],
          where: Object.keys(userWhere).length ? userWhere : undefined,
          required: !!search,
        },
        {
          model: Student,
          as: "Students",
          attributes: ["id"],
          // School admins only see parents linked to their school's students
          where:
            getAdminScope(req) !== null
              ? { organizationId: getAdminScope(req) }
              : undefined,
          required: getAdminScope(req) !== null,
        },
      ],
    });

    return res.status(200).json({ data: rows, total: count, page: pageNum, limit: limitNum });
  } catch (error) {
    logger.error("Error in listParents:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const createUser = async (req: Request, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email,
      role,
      organizationId,
      classId,
      gradeId,
      grade,
    } = req.body;

    if (!firstName || !email || !role) {
      return res.status(400).json({ message: "firstName, email and role are required" });
    }

    const validRoles = ["Student", "Teacher", "Parent", "Admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: `role must be one of ${validRoles.join(", ")}` });
    }

    // School admins can only create members of their own school, never admins
    const scope = getAdminScope(req);
    if (scope !== null && role === "Admin") {
      return res
        .status(403)
        .json({ message: "School admins cannot create admin accounts" });
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
      const organization = await Organization.findByPk(Number(effectiveOrganizationId));
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
      resolvedOrganizationId = organization.id;
    }

    let resolvedClassId: number | undefined;
    if (role === "Student" && classId !== undefined && classId !== "") {
      const targetClass = await Class.findByPk(Number(classId));
      if (!targetClass) {
        return res.status(400).json({ message: "Target class does not exist" });
      }
      if (targetClass.organizationId !== resolvedOrganizationId) {
        return res.status(400).json({ message: "Target class does not belong to the selected organization" });
      }
      resolvedClassId = targetClass.id;
    }

    let resolvedGradeId: number | undefined;
    let resolvedGradeName: string | undefined = grade;
    if (role === "Student" && gradeId !== undefined && gradeId !== "" && gradeId !== null) {
      const gradeRecord = await Grade.findByPk(Number(gradeId));
      if (!gradeRecord) {
        return res.status(400).json({ message: "Target grade does not exist" });
      }
      resolvedGradeId = gradeRecord.id;
      resolvedGradeName = gradeRecord.name;
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
          isAccess: true,
          otpVerified: true,
        },
        { transaction: t }
      );

      if (role === "Student") {
        const connectCode = await generateUniqueConnectCode();
        const student = await Student.create(
          {
            userId: userRecord.id,
            organizationId: resolvedOrganizationId,
            classId: resolvedClassId,
            gradeId: resolvedGradeId,
            grade: resolvedGradeName || "",
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
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Email already in use" });
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

    return await User.sequelize!.transaction(async (transaction) => {
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
        userUpdateData.organizationId = requestedOrganizationId;
      }

      if (userRecord.role === "Student") {
        const student = await Student.findOne({ where: { userId }, transaction });
        if (!student) {
          return res.status(404).json({ message: "Student record not found for this user" });
        }

        const resultingOrganizationId = requestedOrganizationId !== undefined
          ? requestedOrganizationId
          : student.organizationId;

        if (requestedOrganizationId !== undefined && requestedOrganizationId !== null) {
          const organization = await Organization.findByPk(requestedOrganizationId, { transaction });
          if (!organization) {
            return res.status(400).json({ message: "Target organization does not exist" });
          }
        }

        if (requestedClassId !== undefined && requestedClassId !== null) {
          const targetClass = await Class.findByPk(requestedClassId, { transaction });
          if (!targetClass) {
            return res.status(400).json({ message: "Target class does not exist" });
          }
          if (targetClass.organizationId !== resultingOrganizationId) {
            return res.status(400).json({ message: "Target class does not belong to the selected organization" });
          }
        }

        const studentUpdateData: Record<string, any> = {};
        if (requestedGradeId !== undefined) {
          if (requestedGradeId === null) {
            studentUpdateData.gradeId = null;
            studentUpdateData.grade = null;
          } else {
            const gradeRecord = await Grade.findByPk(requestedGradeId, { transaction });
            if (!gradeRecord) {
              return res.status(400).json({ message: "Target grade does not exist" });
            }
            studentUpdateData.gradeId = gradeRecord.id;
            studentUpdateData.grade = gradeRecord.name;
          }
        } else if (grade !== undefined) {
          studentUpdateData.grade = grade === "" ? null : grade;
        }

        if (requestedOrganizationId !== undefined) {
          studentUpdateData.organizationId = resultingOrganizationId;
          if (resultingOrganizationId === null) studentUpdateData.classId = null;
        }
        if (requestedClassId !== undefined) studentUpdateData.classId = requestedClassId;

        if (Object.keys(studentUpdateData).length > 0) {
          await Student.update(studentUpdateData, {
            where: { id: student.id },
            transaction,
            fields: Object.keys(studentUpdateData),
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

      return res.status(200).json({ message: "User updated successfully" });
    });
  } catch (error: any) {
    if (error instanceof InvalidOptionalIdError) {
      return res.status(400).json({ message: error.message });
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

    if (userRecord.role === "Student") {
      const student = await Student.findOne({ where: { userId } });
      if (student) {
        await StudentTask.destroy({ where: { studentId: student.id } });
        await StudentChallenge.destroy({ where: { studentId: student.id } });
        await student.destroy();
      }
    } else if (userRecord.role === "Teacher") {
      await Teacher.destroy({ where: { userId } });
    } else if (userRecord.role === "Parent") {
      const parent = await Parent.findOne({ where: { userId } });
      if (parent) {
        await Student.update({ ParentId: null } as any, { where: { ParentId: parent.id } });
        await parent.destroy();
      }
    }

    await userRecord.destroy();

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
    const { search, organizationId, gradeId, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (organizationId) where.organizationId = organizationId;
    if (gradeId) where.gradeId = gradeId;
    if (search) where.classname = { [Op.like]: `%${String(search)}%` };

    const scope = getAdminScope(req);
    if (scope !== null) where.organizationId = scope;

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    const { rows, count } = await Class.findAndCountAll({
      where,
      limit: limitNum,
      offset,
      order: [["id", "ASC"]],
      distinct: true,
      include: [
        { model: Organization, as: "Organization", attributes: ["id", "name"], required: false },
        { model: Teacher, as: "Teachers", attributes: ["id", "userId"], required: false },
        { model: Student, as: "Students", attributes: ["id"], required: false },
        { model: Grade, as: "GradeEntity", attributes: ["id", "name"], required: false },
      ],
    });

    return res.status(200).json({ data: rows, total: count, page: pageNum, limit: limitNum });
  } catch (error) {
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

    if (!classname || (!gradeId && !grade) || !effectiveOrganizationId) {
      return res.status(400).json({ message: "classname, gradeId and organizationId are required" });
    }

    const organization = await Organization.findByPk(Number(effectiveOrganizationId));
    if (!organization) {
      return res.status(400).json({ message: "Target organization does not exist" });
    }

    let resolvedGradeId: number | undefined;
    let resolvedGradeName: string | undefined = grade;

    if (gradeId) {
      const gradeRecord = await Grade.findByPk(Number(gradeId));
      if (!gradeRecord) {
        return res.status(400).json({ message: "Target grade does not exist" });
      }
      resolvedGradeId = gradeRecord.id;
      resolvedGradeName = gradeRecord.name;
    }

    const newClass = await Class.create({
      classname,
      gradeId: resolvedGradeId,
      grade: resolvedGradeName || "",
      organizationId: organization.id,
      classdescrption,
    });

    return res.status(201).json({ data: newClass });
  } catch (error) {
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

    if (organizationId !== undefined) {
      const organization = await Organization.findByPk(Number(organizationId));
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
    }

    const updateData: Record<string, any> = {};
    if (classname) updateData.classname = classname;
    if (gradeId !== undefined) {
      if (gradeId === null || gradeId === "") {
        updateData.gradeId = null;
        updateData.grade = null;
      } else {
        const gradeRecord = await Grade.findByPk(Number(gradeId));
        if (!gradeRecord) {
          return res.status(400).json({ message: "Target grade does not exist" });
        }
        updateData.gradeId = gradeRecord.id;
        updateData.grade = gradeRecord.name;
      }
    } else if (grade) {
      updateData.grade = grade;
    }
    if (organizationId !== undefined) updateData.organizationId = Number(organizationId);
    if (classdescrption !== undefined) updateData.classdescrption = classdescrption;

    if (Object.keys(updateData).length > 0) {
      await targetClass.update(updateData);
    }

    return res.status(200).json({ data: targetClass });
  } catch (error) {
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
    await userRecord.update({ password: hashedPassword, isAccess: true, otpVerified: true });

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
    if (organizationId) where.organizationId = organizationId;
    if (search) where.name = { [Op.like]: `%${String(search)}%` };

    // School admins see the shared/global grades plus their own school's
    const scope = getAdminScope(req);
    if (scope !== null) {
      delete where.organizationId;
      where[Op.or] = [{ organizationId: scope }, { organizationId: null }];
    }

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

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
  const failedEntries: any[] = [];

  // School admins import grades into their own school only
  const scope = getAdminScope(req);

  try {
    for (const sheet in processedData) {
      const all_data = processedData[sheet];
      for (const data of all_data) {
        try {
          const nameInput = getImportField(data, "name", "Name");
          const gradeName = String(nameInput || "").trim().toLowerCase();
          if (!gradeName) {
            failedEntries.push({ row: data, error: "Missing grade name" });
            continue;
          }

          let grade = await Grade.findOne({
            where:
              scope !== null
                ? { name: gradeName, organizationId: scope }
                : { name: gradeName },
          });
          const alreadyExisted = !!grade;
          if (!grade) {
            grade = await Grade.create({
              name: gradeName,
              organizationId: scope,
            });
          }

          successfulEntries.push({
            row: data,
            message: alreadyExisted ? "Grade already existed" : "Grade created",
            gradeId: grade.id,
          });
        } catch (error) {
          failedEntries.push({
            row: data,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    res.json({
      message: "Grade import completed",
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
    });
  } catch (error) {
    logger.error("Error processing Excel file (grade import):", { error });
    res.status(500).json({ message: "Internal server error", error });
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
      return res.status(400).json({
        message: "Grade has students or classes assigned, reassign or remove them first",
      });
    }

    await grade.destroy();
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
    if (organizationId) where.organizationId = organizationId;
    if (classId) where.classId = classId;
    if (gradeId) where.gradeId = gradeId;
    else if (grade) where.grade = grade;

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

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

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
        where: Object.keys(userWhere).length ? userWhere : undefined,
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

    const allStudents = await Student.findAll({
      attributes: ["xp", "snabelYellow", "snabelBlue", "snabelRed", "level"],
      where: scope !== null ? { organizationId: scope } : undefined,
      raw: true,
    });

    let totalXp = 0;
    let totalSanabel = 0;
    let maxLevel = 0;
    let playingStudents = 0;

    for (const s of allStudents) {
      const xpVal = Number(s.xp || 0);
      const yellow = Number(s.snabelYellow || 0);
      const blue = Number(s.snabelBlue || 0);
      const red = Number(s.snabelRed || 0);
      const lvl = Number(s.level || 1);

      totalXp += xpVal;
      totalSanabel += yellow + blue + red;
      if (lvl > maxLevel) maxLevel = lvl;
      if (xpVal > 0 || yellow > 0 || blue > 0 || red > 0 || lvl > 1) {
        playingStudents++;
      }
    }

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

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    const studentWhere: any = {};
    if (organizationId) studentWhere.organizationId = organizationId;
    if (classId) studentWhere.classId = classId;
    if (gradeId) studentWhere.gradeId = gradeId;

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
    logger.error("Error in listTaskHistory:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const impersonateStudent = async (req: Request, res: Response) => {
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

    // Sign student JWT access token and refresh token
    const token = signAccessToken({
      id: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
    });
    const refreshToken = signRefreshToken({
      id: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
      tokenVersion: targetUser.tokenVersion,
    });

    logger.info("Admin impersonated student", {
      adminId: actingAdmin.id,
      adminEmail: actingAdmin.email,
      studentId: student.id,
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
    });

    return res.status(200).json({
      status: 200,
      message: "Impersonation token generated successfully",
      data: {
        token,
        refreshToken,
        user: {
          id: targetUser.id,
          studentId: student.id,
          email: targetUser.email,
          role: targetUser.role,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          profileImg: targetUser.profileImg,
        },
      },
    });
  } catch (error) {
    logger.error("Error in impersonateStudent:", { error });
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
};
