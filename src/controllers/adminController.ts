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
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Organization, { OrganizationType } from "../models/oraganization.model";
import { QueryTypes } from "sequelize";
import { generatePassword } from "../helpers/generatePassword";
import generateUniqueConnectCode from "../helpers/generateRandomconnectcode";

const DEFAULT_RESET_PASSWORD = "Test1234!";

const getAdminProfile = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;
  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  try {
    const admin = await User.findOne({
      where: { id: user.id, role: "Admin" },
      attributes: ["id", "firstName", "lastName", "email", "role"],
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

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

const listOrganizations = async (req: Request, res: Response) => {
  try {
    const { search, type, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (search) where.name = { [Op.like]: `%${String(search)}%` };
    if (type) where.type = type;

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

    const organization = await Organization.findByPk(organizationId, {
      include: [
        {
          model: Class,
          as: "Classes",
          attributes: ["id", "classname", "category"],
          required: false,
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
      grade,
      page = "1",
      limit = "20",
    } = req.query;

    const where: any = {};
    if (organizationId) where.organizationId = organizationId;
    if (classId) where.classId = classId;
    if (grade) where.grade = grade;

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
          attributes: ["id", "classname", "category"],
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
          attributes: ["id", "classname", "category"],
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

    const finalCategoryCounts = allCategories.reduce((acc, category) => {
      acc[category.title] = categoryCounts[category.title] || 0;
      return acc;
    }, {} as Record<string, number>);

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
    if (!studentId) {
      return res.status(400).json({ message: "Invalid student id" });
    }

    const { firstName, lastName, email, grade, organizationId, classId, profileImg } = req.body;

    const student = await Student.findByPk(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const userRecord = await User.findOne({ where: { id: student.userId } });
    if (!userRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    const resultingOrganizationId =
      organizationId !== undefined ? Number(organizationId) : student.organizationId;

    if (organizationId !== undefined) {
      const organization = await Organization.findByPk(resultingOrganizationId);
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
    }

    if (classId !== undefined) {
      const targetClass = await Class.findByPk(Number(classId));
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
    if (grade) studentUpdateData.grade = grade;
    if (organizationId !== undefined) studentUpdateData.organizationId = resultingOrganizationId;
    if (classId !== undefined) studentUpdateData.classId = Number(classId);

    if (Object.keys(userUpdateData).length > 0) {
      await userRecord.update(userUpdateData);
    }
    if (Object.keys(studentUpdateData).length > 0) {
      await student.update(studentUpdateData);
    }

    return res.status(200).json({ message: "Student updated successfully" });
  } catch (error) {
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

    const userRecord = await User.findOne({ where: { id: student.userId } });
    if (!userRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    await StudentTask.destroy({ where: { studentId: student.id } });
    await StudentChallenge.destroy({ where: { studentId: student.id } });

    await student.destroy();
    await userRecord.destroy();

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
    const { search, role, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (role) where.role = role;
    if (search) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${String(search)}%` } },
        { lastName: { [Op.like]: `%${String(search)}%` } },
        { email: { [Op.like]: `%${String(search)}%` } },
      ];
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
          as: "User",
          attributes: ["id", "firstName", "lastName", "email"],
          where: Object.keys(userWhere).length ? userWhere : undefined,
          required: !!search,
        },
        {
          model: Organization,
          as: "Organization",
          attributes: ["id", "name"],
          required: false,
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
          as: "User",
          attributes: ["id", "firstName", "lastName", "email"],
          where: Object.keys(userWhere).length ? userWhere : undefined,
          required: !!search,
        },
        {
          model: Student,
          as: "Students",
          attributes: ["id"],
          required: false,
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
      grade,
    } = req.body;

    if (!firstName || !email || !role) {
      return res.status(400).json({ message: "firstName, email and role are required" });
    }

    const validRoles = ["Student", "Teacher", "Parent", "Admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: `role must be one of ${validRoles.join(", ")}` });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: "Email already in use" });
    }

    let resolvedOrganizationId: number | undefined;
    if (role === "Student" || role === "Teacher") {
      if (organizationId === undefined) {
        return res.status(400).json({ message: "organizationId is required for this role" });
      }
      const organization = await Organization.findByPk(Number(organizationId));
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

    const password = generatePassword();
    const hashedPassword = bcrypt.hashSync(password, 10);

    const userRecord = await User.create({
      firstName,
      lastName: lastName || "",
      email,
      password: hashedPassword,
      role,
      isAccess: true,
      otpVerified: true,
    });

    if (role === "Student") {
      const connectCode = await generateUniqueConnectCode();
      const student = await Student.create({
        userId: userRecord.id,
        organizationId: resolvedOrganizationId,
        classId: resolvedClassId,
        grade: grade || "",
        treeProgress: 1,
        connectCode,
      });

      const allChallenges = await Challenge.findAll();
      await StudentChallenge.bulkCreate(
        allChallenges.map((challenge) => ({
          studentId: student.id,
          challengeId: challenge.id,
          completionStatus: "NotCompleted",
        }))
      );
    } else if (role === "Teacher") {
      await Teacher.create({
        userId: userRecord.id,
        organizationId: resolvedOrganizationId,
      });
    } else if (role === "Parent") {
      await Parent.create({ userId: userRecord.id });
    }

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
  } catch (error) {
    logger.error("Error in createUser:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Generic update: works for any role. Student/Teacher get their extra
// role-specific fields applied too when the target user has that role.
const updateUser = async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const { firstName, lastName, email, organizationId, classId, grade } = req.body;

    const userRecord = await User.findByPk(userId);
    if (!userRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    const userUpdateData: Record<string, any> = {};
    if (firstName) userUpdateData.firstName = firstName;
    if (lastName !== undefined) userUpdateData.lastName = lastName;
    if (email) userUpdateData.email = email;

    if (userRecord.role === "Student") {
      const student = await Student.findOne({ where: { userId } });
      if (!student) {
        return res.status(404).json({ message: "Student record not found for this user" });
      }

      const resultingOrganizationId =
        organizationId !== undefined ? Number(organizationId) : student.organizationId;

      if (organizationId !== undefined) {
        const organization = await Organization.findByPk(resultingOrganizationId);
        if (!organization) {
          return res.status(400).json({ message: "Target organization does not exist" });
        }
      }

      if (classId !== undefined && classId !== "" && classId !== null) {
        const targetClass = await Class.findByPk(Number(classId));
        if (!targetClass) {
          return res.status(400).json({ message: "Target class does not exist" });
        }
        if (targetClass.organizationId !== resultingOrganizationId) {
          return res.status(400).json({ message: "Target class does not belong to the selected organization" });
        }
      }

      const studentUpdateData: Record<string, any> = {};
      if (grade) studentUpdateData.grade = grade;
      if (organizationId !== undefined) studentUpdateData.organizationId = resultingOrganizationId;
      if (classId !== undefined) studentUpdateData.classId = classId === "" ? null : Number(classId);

      if (Object.keys(studentUpdateData).length > 0) {
        await student.update(studentUpdateData);
      }
    } else if (userRecord.role === "Teacher" && organizationId !== undefined) {
      const teacher = await Teacher.findOne({ where: { userId } });
      if (!teacher) {
        return res.status(404).json({ message: "Teacher record not found for this user" });
      }
      const organization = await Organization.findByPk(Number(organizationId));
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
      await teacher.update({ organizationId: organization.id });
    }

    if (Object.keys(userUpdateData).length > 0) {
      await userRecord.update(userUpdateData);
    }

    return res.status(200).json({ message: "User updated successfully" });
  } catch (error) {
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
    const { search, organizationId, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (organizationId) where.organizationId = organizationId;
    if (search) where.classname = { [Op.like]: `%${String(search)}%` };

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
    const { classname, category, organizationId, classdescrption } = req.body;

    if (!classname || !category || !organizationId) {
      return res.status(400).json({ message: "classname, category and organizationId are required" });
    }

    const organization = await Organization.findByPk(Number(organizationId));
    if (!organization) {
      return res.status(400).json({ message: "Target organization does not exist" });
    }

    const newClass = await Class.create({
      classname,
      category,
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

    const { classname, category, organizationId, classdescrption } = req.body;

    if (organizationId !== undefined) {
      const organization = await Organization.findByPk(Number(organizationId));
      if (!organization) {
        return res.status(400).json({ message: "Target organization does not exist" });
      }
    }

    const updateData: Record<string, any> = {};
    if (classname) updateData.classname = classname;
    if (category) updateData.category = category;
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

export {
  getAdminProfile,
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
};
