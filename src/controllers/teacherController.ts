import { Request, Response } from "express";
import logger from "../config/logger";

import { JwtPayload } from "jsonwebtoken";

import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import User from "../models/user.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import Organization from "../models/oraganization.model";
// v7 helpers to match the @sequelize/core v7 models (a v6 where()/fn() is rejected by them).
import { Op, fn, col, literal, Sequelize, QueryTypes, where } from "@sequelize/core";
import Task from "../models/task.model";
import StudentTask from "../models/student-task.model";
import Challenge from "../models/challenge.model";
import TaskCategory from "../models/task-category.model";
import StudentChallenge from "../models/student-challenge.model";
import { CompletionStatus } from "../models/student-challenge.model"; // ✅ Correct Import
import Parent from "../models/parent.model";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { sendEmail } from "../helpers/sendEmail";
import { buildAccountCreatedEmail, getEmailAttachments, getAppUrl } from "../helpers/emailTemplates";
import { generatePassword, generateSixDigitPassword, generateImportPassword } from "../helpers/generatePassword";
import { getImportField } from "../helpers/importFieldLookup";
import {
  ImportFailure,
  describeRowError,
  importRowNumber,
  isValidImportEmail,
  normalizeImportEmail,
  parseImportDate,
  rowFailure,
  runWithConcurrency,
} from "../helpers/importRow";
import { hashPasswordOffThread } from "../helpers/passwordHashPool";
import { buildCategoryCounts } from "../helpers/taskCategoryStats";
import { processDirectCompletionBatch } from "../services/directCompletionService";
import { recordImportRun } from "../helpers/importRunRecorder";
import { PROFILE_USER_ATTRIBUTES, accountCreatedAtIso } from "../helpers/accountIdentity";

declare global {
  namespace Express {
    interface Request {
      processedData?: Record<string, any>;
    }
  }
}

const appearStudent = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  try {
    const teacher = await Teacher.findOne({
      where: { userId: user.id },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["firstName", "lastName", "email","profileImg","gender","dateOfBirth"],
        },
      ],
    });

    if (!teacher) {
      return res.status(404).json({ message: "User or Teacher not found" });
    }

    const myClasses = await Class.findAll({
      where: { teacherId: teacher.id },
      attributes: ["id"]
    });
    const myClassIds = myClasses.map((c) => c.id);

    const students = await Student.findAll({
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "firstName",
            "lastName",
            "email",
            "profileImg",
            "gender",
            "dateOfBirth",
          ],
        },
        {
          model: Class,
          as: "Class",
          attributes: ["id", "classname","grade"],
          required: false,
        },
        {
          model: Organization,
          as: "organization",
          attributes: ["id", "name"],
        },
      ],
      where: {
        organizationId: teacher.organizationId,
        classId: { [Op.in]: myClassIds }
      }
    });

    res.status(200).json({ data: students });
  } catch (error) {
    logger.error("Error in appearStudent (teacher):", { error });
    res.status(500).json({ message: "Error something wrong in Teacher" });
  }
};



const appearclass = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  try {
    const teacher = await Teacher.findOne({
      where: { userId: user.id },
    });

    if (!teacher) {
      return res.status(404).json({ message: "User or Teacher not found" });
    }

    const classes = await Class.findAll({
      where: { teacherId: teacher.id, organizationId: teacher.organizationId },
      include: [
        {
          model: Student,
          as: "Students",
          attributes: ["id"],
        },
        {
          model: Organization,
          as: "Organization",
          attributes: ["id", "name"],
        },
      ],
    });

    const result = classes.map((cls: any) => ({
      studentCount: cls.Students ? cls.Students.length : 0,
      classId: cls.id,
      className: cls.classname,
      // Additive: the class listing shows the grade beside the class name.
      grade: cls.grade || null,
      gradeId: cls.gradeId || null,
      organizationId: cls.Organization?.id || null,
      organizationName: cls.Organization?.name || null,
    }));

    res.status(200).json({ data: result });
  } catch (error) {
    logger.error("Error in appearclass (teacher):", { error });
    res.status(500).json({ message: "Error something wrong in Teacher" });
  }
};


const appearStudentByclass = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }
  try {
    const teacher = await Teacher.findOne({
      where: { userId: user.id },
    });
    if (!teacher) {
      return res.status(404).json({ message: "User or Teacher not found" });
    } else {
      const classId = /^\d+$/.test(String(req.params.classId ?? "")) ? Number(req.params.classId) : NaN;
      if (!Number.isSafeInteger(classId) || classId <= 0) {
        return res.status(400).json({ message: "Class ID must be a positive integer" });
      }

      // Check authorization
      const classExists = await Class.findOne({
        where: { id: classId, teacherId: teacher.id }
      });
      if (!classExists) {
        return res.status(403).json({ message: "You are not authorized to view students of this class" });
      }

      const students = await Student.findAll({
        where: { classId: classId, organizationId:teacher.organizationId },
        include: [
          {
            model: Class,
            as: "class",
            attributes: ["id", "classname", "grade", "gradeId"],
            include: [
              {
                model: Grade,
                as: "GradeEntity",
                attributes: ["id", "name"],
                required: false,
              }
            ],
            required: false,
          },
          {
            model: User,
            as: "user",
            attributes: ["firstName", "lastName", "email","profileImg","gender","dateOfBirth"],
          },
        ],
      });
      res.status(200).json({ data: students });
    }
  } catch (error) {
    logger.error("Error in appearStudentByclass (teacher):", { error });
    res.status(500).json({ message: "Error something wrong in Teacher" });
  }
};


const appearStudentWithoutClassOrganizationName = async (
  req: Request,
  res: Response
) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }
  try {
    const teacher = await Teacher.findOne({
      where: { userId: user.id },
    });
    if (!teacher) {
      return res.status(404).json({ message: "User or Teacher not found" });
    } else {
      const students = await Student.findAll({
        attributes: ["id", "grade"],
        where: { classId: null },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["firstName", "lastName", "email","profileImg","gender","dateOfBirth"],
          },
        ],
      });
      const organization = await Organization.findAll({
        attributes: ["id", "name"],
      });
      res.status(200).json({ students, organization });
    }
  } catch (error) {
    logger.error("Error in appearStudentWithoutClassOrganizationName (teacher):", { error });
    res.status(500).json({ message: "Error something wrong in Teacher" });
  }
};

const createClass = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) {
      return res
        .status(401)
        .json({ message: "Unauthorized: User data not found in request" });
    }

    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    if (!teacher) {
      return res
        .status(404)
        .json({ message: "Teacher not found for this user" });
    }

    const {
      classname,
      classDescription = "",
      grade,
      organizationId,
    } = req.body;
    if (!classname || !grade) {
      return res
        .status(400)
        .json({
          message: "Missing required fields: classname or grade",
        });
    }

    if (!teacher.organizationId) {
      return res.status(422).json({ message: "Teacher is not assigned to an organization" });
    }
    if (organizationId !== undefined && Number(organizationId) !== teacher.organizationId) {
      return res.status(403).json({ message: "Teachers cannot create classes in another organization" });
    }

    const normalizedGrade = String(grade).trim().toLowerCase();
    const gradeRecord =
      (await Grade.findOne({
        where: { name: normalizedGrade, organizationId: teacher.organizationId },
      })) ??
      (await Grade.findOne({
        where: { name: normalizedGrade, organizationId: null },
      }));
    if (!gradeRecord) {
      return res.status(422).json({ message: "Grade does not exist in the teacher's organization" });
    }

    const duplicate = await Class.findOne({
      where: { classname: String(classname).trim(), organizationId: teacher.organizationId },
    });
    if (duplicate) {
      return res.status(409).json({ message: "Class already exists in this organization" });
    }

    const newClass = await Class.create({
      classname: String(classname).trim(),
      classdescrption: classDescription,
      grade: gradeRecord.name,
      gradeId: gradeRecord.id,
      organizationId: teacher.organizationId,
      teacherId: teacher.id,
    });

    return res
      .status(201)
      .json({ status: "Class created successfully", data: newClass });
  } catch (error) {
    logger.error("Error in createClass (teacher):", { error });
    return res.status(500).json({ message: "Internal server error" });
  }
};

const addStudentToClass = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized: Missing user data" });
    }

    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found for this user" });
    }

    const { connectCode, classId } = req.body;

    if (!connectCode || classId === undefined || classId === null || classId === "") {
      return res.status(400).json({ message: "Missing required fields: connectCode, classId" });
    }

    if (isNaN(Number(classId))) {
      return res.status(400).json({ message: "Invalid classId: must be a number" });
    }

    const student = await Student.findOne({ where: { connectCode } });
    if (!student) {
      return res.status(404).json({ message: "Student not found with the provided connectCode" });
    }

    const classExists = await Class.findByPk(classId);
    if (!classExists) {
      return res.status(404).json({ message: "Class not found with the provided classId" });
    }

    if (
      classExists.organizationId !== teacher.organizationId ||
      (classExists as any).teacherId !== teacher.id
    ) {
      return res.status(403).json({ message: "Teacher is not authorized for this class" });
    }
    if (
      student.organizationId != null &&
      student.organizationId !== teacher.organizationId
    ) {
      return res.status(403).json({ message: "Student belongs to another organization" });
    }

    if (student.classId === Number(classId)) {
      return res.status(200).json({ message: "No update needed: student is already in this class" });
    }

    await Student.sequelize!.transaction(async (transaction) => {
      await student.update(
        {
          classId: Number(classId),
          organizationId: teacher.organizationId,
          gradeId: classExists.gradeId ?? null,
          grade: classExists.grade ?? null,
        },
        { transaction },
      );
    });
   

    return res.status(200).json({ message: "Student updated successfully" });

  } catch (error) {
    logger.error("Error in addStudentToClass (teacher):", { error });
    return res.status(500).json({ message: "Internal server error" });
  }
};


const appearTaskesTypeandCategories = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }

    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    const parent = await Parent.findOne({ where: { userId: user.id } });

    if (!teacher && !parent) {
      return res
        .status(404)
        .json({ message: "Teacher or Parent data not found in request" });
    }

    const type = req.params.type;
    const categoryId = Number(req.params.categoryId);

    // Validate categoryId and type
    if (isNaN(categoryId) || !type || typeof type !== "string") {
      return res
        .status(400)
        .json({ message: "Invalid category or type parameter" });
    }

    // Get the start and end of today

    // Fetch all tasks matching the given categoryId and type
    const tasks = await Task.findAll({
      where: { categoryId, type },
      attributes: [
        "id",
        "title",
        "description",
        "categoryId",
        "snabelRed",
        "snabelBlue",
        "snabelYellow",
        "xp",
        "kind",
        "timeToDo",
        "type",
      ],
      raw: true,
    });

    if (tasks.length === 0) {
      return res
        .status(404)
        .json({
          message: "No tasks found for today in the given category and type",
        });
    } else {
      return res.status(200).json({ data: tasks });
    }
  } catch (error) {
    logger.error("Error in appearTaskesTypeandCategories (teacher):", { error });
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const appearStudentInDetails = async (req: Request, res: Response) => {
  try {
    // Extract user data
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) return res.status(404).json({ message: "User data not found in request" });

    // Find teacher linked to user
    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    if (!teacher) return res.status(404).json({ message: "Teacher data not found in request" });
    
    // A teacher without an organization has no students; never let a null
    // organizationId match unaffiliated (Solo User) profiles.
    if (!teacher.organizationId) {
      return res.status(403).json({ message: "Teacher is not assigned to an organization" });
    }

    const studentId = Number(req.params.studentId);
    if (!studentId) return res.status(400).json({ message: "Student ID is required" });

    // Same rule as addPros/appearStudentByclass: the student must be in a
    // class this teacher teaches (Classes.teacherId) in the teacher's org.
    const teacherClasses = await Class.findAll({
      where: { teacherId: teacher.id, organizationId: teacher.organizationId },
      attributes: ["id"],
    });
    const teacherClassIds = teacherClasses.map((cls: any) => cls.id);
    if (teacherClassIds.length === 0) return res.status(404).json({ message: "Student not found" });

    const student = await Student.findOne({
      where: {
        id: studentId,
        organizationId: teacher.organizationId,
        classId: { [Op.in]: teacherClassIds },
      },
    
      include: [{
        model: User,
        as: "user", // use the alias defined in the association
        attributes: ["firstName", "lastName", "email","profileImg","gender","dateOfBirth"],
      },
      {model: Class,
        as: "class",
        attributes: ["id", "classname", "grade", "gradeId"],
        include: [
          {
            model: Grade,
            as: "GradeEntity",
            attributes: ["id", "name"],
            required: false,
          }
        ],
        required: false,
      }
      ,{model: Organization,
        as: "organization",
        attributes: ["id", "name"],
      },
      
      {
        model: StudentChallenge,
        as: "challengeStudent",
        attributes: [ "challengeId", "CompletionStatus", "updatedAt"],
        where: {
          CompletionStatus: CompletionStatus.Completed,
        },
        required: false,
        include: [{
          model: Challenge,
          as: "challenge",
          attributes: ["id", "title", "description", "category", "point", "xp", "snabelRed", "snabelBlue", "snabelYellow", "water","seeder","point","taskCategory","tasktype"],
        }],
      },
      {
        model: StudentTask,
        as: "TasksStudents",
        attributes: ["id", "taskId", "CompletionStatus", "updatedAt"],
        where: {
          CompletionStatus: CompletionStatus.Completed,
        },
        required: false,
        include: [{
          model: Task,
          as: "task",
          attributes: ["id", "title", "type", "description", "xp", "snabelRed", "snabelBlue", "snabelYellow"],
          include: [{
            model: TaskCategory,
            as: "taskCategory",
            attributes: ["id", "title"],
          }],
        }],
      },

    ],}
    );
    if (!student) return res.status(404).json({ message: "Student not found" });
    const allCategories = await TaskCategory.findAll({
          attributes: ["id", "title"], // ✅ Get categoryId and title
          raw: true,
        });
    
        // Fetch completed task counts grouped by categoryId
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
    
        // Convert the query result into an object mapping category titles to counts
        const categoryCounts = completedTasks.reduce((acc: Record<string, number>, row: any) => {
          acc[row["title"]] = Number(row["count"]) || 0;
          return acc;
        }, {} as Record<string, number>);
    
        // Ensure all unique categories appear in the final response (even if count is 0)
        const finalCategoryCounts = buildCategoryCounts(
          allCategories.map((category) => category.title),
          categoryCounts,
        );
    
        // Calculate total completed tasks
        const totalCompletedTasks = (Object.values(finalCategoryCounts) as number[]).reduce(
          (sum: number, count: number) => sum + count,
          0
        );
        return res.status(200).json({
          student,
          totalCompletedTasks,
          categoryCounts: finalCategoryCounts,
        });
  }
  
  catch (error) {
    logger.error("Error in appearStudentInDetails (teacher):", { error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

const teacherData = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  try {
    const teacher = await Teacher.findOne({
      where: { userId: user.id },
      include: [
        {
          model: User,
          as: "user", // use the alias defined in the association
          // Explicit allowlist. Including the whole User row returned the
          // password hash, the OTP fields, tokenVersion, the push subscription
          // and the stored location to the client. The allowlist is exactly
          // what `StudentUserProvider` reads for a Teacher, plus createdAt for
          // the account-age field below.
          attributes: [...PROFILE_USER_ATTRIBUTES],
        },
      ],
    });
    if (!teacher) {
      return res.status(404).json({ message: "User or Student not found" });
    } else {
      // Same field, same format, same provenance as the Student profile:
      // `Users.createdAt`, ISO, or null. Tutorial V2 eligibility parses it.
      res.status(200).json({
        data: {
          ...teacher.toJSON(),
          accountCreatedAt: accountCreatedAtIso((teacher as any).user?.createdAt),
        },
      });
    }
  } catch (error) {
    logger.error("Error fetching teacher data:", { error });
    res.status(500).json({ message: "Error fetching teacher data" });
  }
};


const updateDataTeacher = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;
  const { firstName, lastName,email } = req.body;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  const userRecord = await User.findOne({ where: { id: user.id } });

  if ( !userRecord) {
    return res.status(404).json({ message: "User or Student not found" });
  }

  await userRecord.update({ firstName, lastName });
  

  res
    .status(200)
    .json({ message: "User and Student data updated successfully" });
};


const deleteData = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  const teacher = await Teacher.findOne({ where: { userId: user.id } });
  const userRecord = await User.findOne({ where: { id: user.id } });
  if (!teacher || !userRecord) {
    return res.status(404).json({ message: "User or Student not found" });
  }


  // Delete student first, then delete user
  await teacher.destroy();
  await userRecord.destroy();


  res
    .status(200)
    .json({ message: "User and Student data deleted successfully" });
};

const addTeacher = async (req: Request, res: Response) => {
  if (!req.processedData) {
    return res.status(400).json({
      success: false,
      message: "No processed data available",
      error: "File was not processed correctly",
    });
  }

  const processedData = req.processedData;
  const successfulEntries: any[] = [];
  const failedEntries: ImportFailure[] = [];
  const adminScope = (
    req as Request & { adminOrganizationId?: number | null }
  ).adminOrganizationId ?? null;
  const fail = (rowNumber: number, email: string, code: string, message: string, column?: string) =>
    failedEntries.push(rowFailure(rowNumber, code, message, column, email));

  const orgCache = new Map<string, Promise<Organization | null>>();
  const findOrganization = (key: string, load: () => Promise<Organization | null>) => {
    if (!orgCache.has(key)) orgCache.set(key, load());
    return orgCache.get(key)!;
  };
  const firstRowOfEmail = new Map<string, number>();
  const targetOrganizationIds = new Set<number>();
  const pendingEmails: Array<{ entry: any; firstName: string; email: string; password: string; userId: number }> = [];

  try {
    for (const sheet in processedData) {
      const all_data: any[] = Array.isArray(processedData[sheet]) ? processedData[sheet] : [];

      for (let rowIndex = 0; rowIndex < all_data.length; rowIndex += 1) {
        const data = all_data[rowIndex];
        const rowNumber = importRowNumber(data, rowIndex);
        let email = "";
        try {
          const firstName = String(getImportField(data, "firstName") ?? "").trim();
          const lastName = String(getImportField(data, "lastName") ?? "").trim();
          email = normalizeImportEmail(getImportField(data, "email"));
          const gender = getImportField(data, "gender")?.toString().trim() || null;
          const orgName = String(getImportField(data, "school") ?? "").trim().toLowerCase();

          if (!firstName) {
            fail(rowNumber, email, "REQUIRED_FIELD_MISSING", "firstName is required", "firstName");
            continue;
          }
          if (!lastName) {
            fail(rowNumber, email, "REQUIRED_FIELD_MISSING", "lastName is required", "lastName");
            continue;
          }
          if (!email) {
            fail(rowNumber, email, "REQUIRED_FIELD_MISSING", "email is required", "email");
            continue;
          }
          if (!isValidImportEmail(email)) {
            fail(rowNumber, email, "INVALID_EMAIL", "email format is invalid", "email");
            continue;
          }
          if (!orgName) {
            fail(rowNumber, email, "ORGANIZATION_REQUIRED", "school is required", "school");
            continue;
          }
          const earlierRow = firstRowOfEmail.get(email);
          if (earlierRow !== undefined) {
            fail(rowNumber, email, "DUPLICATE_EMAIL_IN_FILE", `email repeats row ${earlierRow} of this file`, "email");
            continue;
          }
          firstRowOfEmail.set(email, rowNumber);

          const dateOfBirth = parseImportDate(getImportField(data, "DateOfBirth"));
          if (dateOfBirth === null) {
            fail(rowNumber, email, "INVALID_DATE", "DateOfBirth is not a valid date (use YYYY-MM-DD)", "DateOfBirth");
            continue;
          }

          const organization = adminScope !== null
            ? await findOrganization(`id:${adminScope}`, () => Organization.findByPk(adminScope))
            : await findOrganization(`name:${orgName}`, () => Organization.findOne({ where: { name: orgName } }));
          if (!organization) {
            fail(rowNumber, email, "ORGANIZATION_NOT_FOUND", "school not found; create it before importing", "school");
            continue;
          }
          if (
            adminScope !== null &&
            organization.name.trim().toLowerCase() !== orgName
          ) {
            fail(rowNumber, email, "FORBIDDEN_ORGANIZATION", "school admins can import only into their own school", "school");
            continue;
          }
          targetOrganizationIds.add(organization.id);

          if (await User.findOne({ where: { email }, attributes: ["id"] })) {
            fail(rowNumber, email, "EMAIL_CONFLICT", "email is already in use", "email");
            continue;
          }

          const password = generateImportPassword();
          const hashedPassword = await hashPasswordOffThread(password, 10);

          // User + Teacher must be created together — otherwise a failure
          // in Teacher.create after User.create already committed leaves an
          // orphaned user (no teacher record, email permanently "taken").
          let user!: User;
          let new_teacher!: Teacher;
          await User.sequelize!.transaction(async (t) => {
            user = await User.create(
              {
                firstName,
                lastName,
                email,
                role: "Teacher",
                password: hashedPassword,
                dateOfBirth: (dateOfBirth ?? null) as any,
                gender,
                isAccess: true,
                otpVerified: true,
              },
              { transaction: t }
            );

            new_teacher = await Teacher.create(
              {
                userId: user.id,
                organizationId: organization.id,
              },
              { transaction: t }
            );
          });

          const entry = {
            rowNumber,
            email,
            message: "Teacher added successfully",
            teacherId: new_teacher.id,
            emailSent: false,
          };
          successfulEntries.push(entry);
          pendingEmails.push({ entry, firstName, email, password, userId: user.id });
        } catch (error) {
          failedEntries.push(describeRowError(rowNumber, error, email));
          logger.error("Teacher import row failed", { error, sheet, rowNumber });
        }
      }
    }

    // Credentials are delivered only by email: no plaintext workbook is
    // written to disk and no server path is returned. `emailSent` per row lets
    // the UI flag accounts whose email failed.
    await runWithConcurrency(pendingEmails, 5, async ({ entry, firstName, email, password, userId }) => {
      try {
        await sendEmail({
          to: email,
          userId,
          purpose: "ADMIN_INVITE",
          subject: "Your Teacher Account in Snabel elahssan",
          text: `Hello ${firstName},\n\nYour teacher account has been created.\n\nEmail: ${email}\nPassword: ${password}\n\nLog in at ${getAppUrl()}\n\nPlease change your password immediately.`,
          html: buildAccountCreatedEmail({
            firstName,
            email,
            password,
            roleLabel: "teacher",
          }),
          attachments: getEmailAttachments(),
        });
        entry.emailSent = true;
      } catch (emailError) {
        logger.error("Failed to send onboarding email (non-blocking):", { emailError, teacherId: entry.teacherId });
      }
    });

    // Import telemetry. Recorded after the rows are written and deliberately
    // non-fatal: see `helpers/importRunRecorder` for why one row is one
    // submitted batch rather than one uploaded file.
    await recordImportRun(req, {
      entityType: "teachers",
      succeeded: successfulEntries.length,
      failed: failedEntries.length,
      targetOrganizationId:
        targetOrganizationIds.size === 1 ? [...targetOrganizationIds][0] : null,
    });

    res.json({
      message: "Teacher import completed",
      total: successfulEntries.length + failedEntries.length,
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
    });
  } catch (error) {
    logger.error("Error in addTeacher:", { error });
    res.status(500).json({
      success: false,
      message: "Internal server error during teacher creation",
    });
  }
};

const appearClassGrade =  async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;

    if (!user) {
      return res.status(404).json({ message: "User data not found in request" });
    }

    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    const student = await Student.findOne({ where: { userId: user.id } });

    if (!teacher && !student) {
      return res.status(403).json({ message: "Access denied. Not a teacher or student." });
    }

    let organizationId = teacher?.organizationId || student?.organizationId;
    if (!organizationId && teacher) {
      const firstClass = await Class.findOne({ where: { teacherId: teacher.id, organizationId: { [Op.ne]: null } } });
      if (firstClass) {
        organizationId = firstClass.organizationId;
      }
    }

    const classGrades = await Class.findAll({
      where: { organizationId },
      attributes: ["gradeId", "grade"],
      group: ["gradeId", "grade"],
      include: [
        {
          model: Grade,
          as: "GradeEntity",
          attributes: ["id", "name"],
          required: false,
        }
      ]
    });

    const grades = classGrades.map((cls) => {
      if (cls.GradeEntity) {
        return { id: cls.GradeEntity.id, name: cls.GradeEntity.name };
      }
      return { id: cls.gradeId || null, name: cls.grade };
    });

    return res.status(200).json({ grades });
  } catch (error) {
    logger.error("Error in appearClassGrade (teacher):", { error });
    return res.status(500).json({ message: "Internal server error" });
  }
};

const getClassesByGrade = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    const { grade, gradeId } = req.query;

    if (!user) {
      return res.status(404).json({ message: "User data not found in request" });
    }

    if ((!grade || typeof grade !== "string") && (!gradeId || typeof gradeId !== "string")) {
      return res.status(400).json({ message: "Missing or invalid 'grade' or 'gradeId' in URL parameters" });
    }
    if (gradeId && !/^\d+$/.test(String(gradeId))) {
      return res.status(400).json({ message: "gradeId must be a positive integer" });
    }

    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    const student = await Student.findOne({ where: { userId: user.id } });

    if (!teacher && !student) {
      return res.status(403).json({ message: "Access denied. Not a teacher or student." });
    }
    const organizationId = teacher?.organizationId ?? student?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ message: "Organization ID not found for user" });
    }
    const classes = await Class.findAll({
      where: {
        organizationId,
        ...(gradeId ? { gradeId } : { grade }),
      },
      attributes: ["id", "classname"],
    });

    return res.status(200).json({ classes });
  } catch (error) {
    logger.error("Error in getClassesByGrade (teacher):", { error });
    return res.status(500).json({ message: "Internal server error" });
  }
};

const addPros = async (req: Request, res: Response) => {
  const user = (req as Request & { user?: JwtPayload }).user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const teacher = await Teacher.findOne({ where: { userId: user.id } });
  if (!teacher) return res.status(404).json({ message: "Teacher not found" });
  const taskId = Number(req.body.taskId);
  const studentIds: number[] = Array.isArray(req.body.studentIds) ? req.body.studentIds.map(Number) : [Number(req.body.studentIds)];
  if (!Number.isSafeInteger(taskId) || taskId <= 0 || studentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ message: "Invalid taskId or studentIds parameter" });
  }
  const result = await processDirectCompletionBatch({ taskId, studentIds, actorId: teacher.id,
    actorType: "teacher", source: "teacher_direct", comment: String(req.body.comment || ""),
    authorize: async (student) => {
      if (!teacher.organizationId || !student.classId || student.organizationId !== teacher.organizationId) return false;
      return !!(await Class.findOne({ where: { id: student.classId, teacherId: teacher.id, organizationId: teacher.organizationId } }));
    },
  });
  return res.status(result.httpStatus).json(result.body);
};


export {
  appearStudent,
  appearclass,
  appearStudentByclass,
  appearStudentWithoutClassOrganizationName,
  createClass,
  appearTaskesTypeandCategories,
  addPros,
  appearStudentInDetails,
  teacherData,
  updateDataTeacher,
  deleteData,
  addStudentToClass,
  addTeacher,
  appearClassGrade,
  getClassesByGrade
};
