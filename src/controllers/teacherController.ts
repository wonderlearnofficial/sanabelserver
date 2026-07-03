import { Request, Response } from "express";
import logger from "../config/logger";

import { JwtPayload } from "jsonwebtoken";

import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import User from "../models/user.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import Organization from "../models/oraganization.model";
import { Op, fn, col, literal } from "sequelize";
import { Sequelize, QueryTypes, where } from "sequelize";
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
import { generatePassword } from "../helpers/generatePassword";
import { getImportField, DEFAULT_IMPORT_PASSWORD } from "../helpers/importFieldLookup";

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
      where:{organizationId:teacher.organizationId}
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

    // Fetch all students including class and organization info
    const students = await Student.findAll({
      where: { classId: { [Op.ne]: null } },
      include: [
        {
          model: Class,
          as: "class",
          attributes: ["id", "classname"],
        },
        {
          model: Organization,
          as: "organization",
          attributes: ["id", "name"],
        },
      ],
    });

    // Manually group students by class and organization
    const groupedData: Record<string, any> = {};

    students.forEach((student) => {
      if (student.class && student.organization) {
        const key = `${student.class.id}-${student.organization.id}`;

        if (!groupedData[key]) {
          groupedData[key] = {
            studentCount: 0,
            classId: student.class.id,
            className: student.class.classname,
            organizationId: student.organization.id,
            organizationName: student.organization.name,
          };
        }

        groupedData[key].studentCount += 1;
      }
    });

    // Convert grouped object into an array
    const result = Object.values(groupedData);

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
      const classId = req.params.classId;
      if (!classId) {
        return res.status(400).json({ message: "Class ID is required" });
      }
      const students = await Student.findAll({
        
        where: { classId: classId, organizationId:teacher.organizationId
      },
        include: [
          {
            model: Class,
            as: "class",
            attributes: ["id", "classname"],
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
    if (!classname || !grade || !organizationId) {
      return res
        .status(400)
        .json({
          message:
            "Missing required fields: classname, grade, or organizationId",
        });
    }

    const newClass = await Class.create({
      classname,
      classDescription,
      grade,
      organizationId,
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

    if (!connectCode || !classId === undefined) {
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

    if (student.classId === Number(classId)) {
      return res.status(200).json({ message: "No update needed: student is already in this class" });
    }

   await student.update({classId:Number(classId)})
   

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

const addPros = async (req: Request, res: Response) => {
  try {
    // Extract user data
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) return res.status(404).json({ message: "User data not found in request" });

    // Find teacher linked to user
    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    if (!teacher) return res.status(404).json({ message: "Teacher data not found in request" });

    // Extract request data
    let { taskId, studentIds, comment = "", time } = req.body;
    logger.info("teacher addPros request:", req.body);

    // Validate taskId
    if (typeof taskId !== "number") return res.status(400).json({ message: "Invalid taskId parameter" });

    // Convert single studentId to an array if needed
    studentIds = Array.isArray(studentIds) ? studentIds : [studentIds];

    if (!studentIds.every((id: number) => typeof id === "number" && !isNaN(id))) {
      return res.status(400).json({ message: "Invalid studentIds parameter" });
    }

    // Validate time format (ISO string or HH:mm)
    let today: Date;
    if (time && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(time)) {
      today = new Date(time);
    } else if (time && /^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
      today = new Date();
      const [hours, minutes] = time.split(":").map(Number);
      today.setHours(hours + 2, minutes, 0, 0);
    } else {
      return res.status(400).json({ message: "Invalid time format, expected HH:mm or ISO string" });
    }
    // Fetch students who already completed the task today
    const existingRecords = await StudentTask.findAll({
      where: {
        studentId: { [Op.in]: studentIds },
        taskId,
        createdAt: {
          [Op.gte]: new Date().setHours(0, 0, 0, 0),
          [Op.lt]: new Date().setHours(23, 59, 59, 999),
        },
      },
      include: [{ model: Student, as: "student" }],
    });

    const existingStudentIds = existingRecords.map((record) => record.studentId);
    const newStudentIds = studentIds.filter((id: number) => !existingStudentIds.includes(id));

    if (existingStudentIds.length > 0) {
      return res.status(400).json({
        message: "Some students have already completed this task today",
        existingStudents: existingStudentIds,
      });
    }

    // Fetch task details
    const task = await Task.findOne({
      where: { id: taskId },
      include: [{ model: TaskCategory, as: "taskCategory" }],
    });
    if (!task) return res.status(404).json({ message: "Task not found" });
    
    // Fetch challenges related to the task
    const challenges = await Challenge.findAll({
      where: {
        [Op.or]: [
          { category: { [Op.in]: ["snabelBlue", "snabelRed", "snabelMixed", "snabelYellow", "xp", "alltask", "task","tasktype"] } },
          { taskCategory: task.taskCategory?.title || "" },
          { tasktype: task.type || "" },
        ],
      } as any,
    });

    // Fetch student challenges that are not completed
    const studentChallenges = await StudentChallenge.findAll({
      where: {
        studentId: { [Op.in]: newStudentIds },
        challengeId: challenges.map((c) => c.id),
        completionStatus: "NotCompleted",
      },
      include: [{ model: Challenge, as: "challenge" }],
    });

    await Student.sequelize.transaction(async (t) => {
      // Update students and their challenges in a single loop
      for (const studentId of newStudentIds) {
        // Create student task record
        await StudentTask.create(
          {
            studentId,
            taskId,
            completionStatus: "Completed",
            comment,
            createdAt: today,
            teacherId: teacher.id,
            date: today.toISOString().split("T")[0],
          },
          { transaction: t }
        );

        // Fetch student record
        const student = await Student.findOne({ where: { id: studentId } });
        if (!student) continue;

        // Update student's task rewards
        student.xp = (student.xp || 0) + (task.xp || 0);
        student.snabelRed = (student.snabelRed || 0) + (task.snabelRed || 0);
        student.snabelBlue = (student.snabelBlue || 0) + (task.snabelBlue || 0);
        student.snabelYellow = (student.snabelYellow || 0) + (task.snabelYellow || 0);
        await student.save({ transaction: t });

        // Update student's challenge progress
        for (const studentChallenge of studentChallenges) {
          if (studentChallenge.studentId !== studentId) continue;
          const challenge = studentChallenge.challenge;

          // Add points based on challenge category
          if (challenge.category === "xp") studentChallenge.pointOfStudent += (task.xp || 0);
          else if (challenge.category === "snabelBlue") studentChallenge.pointOfStudent += (task.snabelBlue || 0);
          else if (challenge.category === "snabelRed") studentChallenge.pointOfStudent += (task.snabelRed || 0);
          else if (challenge.category === "snabelYellow") studentChallenge.pointOfStudent += (task.snabelYellow || 0);
          else if (challenge.category === "snabelMixed") {
            studentChallenge.pointOfStudent += (task.snabelBlue || 0) + (task.snabelRed || 0) + (task.snabelYellow || 0);
          } else if (challenge.category === "alltask") {
            studentChallenge.pointOfStudent += 1;
          } else if (challenge.taskCategory === task.taskCategory?.title) {
            studentChallenge.pointOfStudent += 1;
          } else if (challenge.tasktype === task.type) {
            studentChallenge.pointOfStudent += 1;
          }

          // Mark challenge as completed if threshold is met
          if (studentChallenge.pointOfStudent >= challenge.point) {
            studentChallenge.completionStatus = CompletionStatus.Completed;

            student.xp = (student.xp || 0) + (challenge.xp || 0);
            student.snabelRed = (student.snabelRed || 0) + (challenge.snabelRed || 0);
            student.snabelBlue = (student.snabelBlue || 0) + (challenge.snabelBlue || 0);
            student.snabelYellow = (student.snabelYellow || 0) + (challenge.snabelYellow || 0);
            student.water = (student.water || 0) + (challenge.water || 0);
            student.seeders = (student.seeders || 0) + (challenge.seeder || 0);
            await student.save({ transaction: t });
          }
          await studentChallenge.save({ transaction: t });
        }
      }
    });

    logger.info("Task recorded successfully for students by teacher:", { studentIds: newStudentIds, teacherId: teacher.id });
    return res.status(201).json({
      message: "Student tasks recorded successfully",
    });
  } catch (error) {
    logger.error("Error in addPros (teacher):", { error });
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
    
    const studentId = Number(req.params.studentId);
    if (!studentId) return res.status(400).json({ message: "Student ID is required" });
    const student = await Student.findOne({
      where: { id: studentId,organizationId:teacher.organizationId },
    
      include: [{
        model: User,
        as: "user", // use the alias defined in the association
        attributes: ["firstName", "lastName", "email","profileImg","gender","dateOfBirth"],
      },
      {model: Class,
        as: "class",
        attributes: ["id", "classname",'grade'],
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
        const finalCategoryCounts = allCategories.reduce((acc, category) => {
          acc[category.title] = categoryCounts[category.title] || 0;
          return acc;
        }, {} as Record<string, number>);
    
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
      include: [{
        model: User,
        as: "user", // use the alias defined in the association
      },
      
    ]
     
    });
    if (!teacher) {
      return res.status(404).json({ message: "User or Student not found" });
    } else {

      res.status(200).json({ data: teacher });
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
  const failedEntries: any[] = [];
  const organizationFiles: Record<string, { workbook: ExcelJS.Workbook; worksheet: ExcelJS.Worksheet }> = {};

  try {
    for (const sheet in processedData) {
      const all_data = processedData[sheet];

      for (const data of all_data) {
        try {
          const firstName = getImportField(data, "FirstName", "firstName", "first_name")?.toString().trim();
          const lastName = getImportField(data, "LastName", "lastName", "last_name")?.toString().trim();
          const email = getImportField(data, "Email", "email")?.toString().trim();
          const gender = getImportField(data, "Gender", "gender")?.toString().trim();
          const orgInput = getImportField(data, "OrganizationName", "organizationName", "school", "School");
          const dateOfBirth = getImportField(data, "DateOfBirth", "dateOfBirth") || null;

          if (!firstName || !lastName || !email || !orgInput) {
            failedEntries.push({ row: data, error: "Missing required fields" });
            continue;
          }

          // Find or auto-create Organization (normalized the same way the
          // standalone org/class Excel importers already store names).
          const orgName = String(orgInput).trim().toLowerCase();
          let organization = await Organization.findOne({ where: { name: orgName } });
          if (!organization) {
            organization = await Organization.create({ name: orgName });
          }

          if (!organizationFiles[organization.name]) {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Teachers");
            worksheet.columns = [
              { header: "Email", key: "email", width: 30 },
              { header: "Password", key: "password", width: 20 },
            ];
            organizationFiles[organization.name] = { workbook, worksheet };
          }

          const { worksheet } = organizationFiles[organization.name];

          if (await User.findOne({ where: { email } })) {
            failedEntries.push({ row: data, error: "Email is already in use" });
            continue;
          }

          const password = DEFAULT_IMPORT_PASSWORD;
          const hashedPassword = bcrypt.hashSync(password, 10);

          const user = await User.create({
            firstName,
            lastName,
            email,
            role: "Teacher",
            password: hashedPassword,
            dateOfBirth,
            gender,
            isAccess: true,
          });

          const new_teacher = await Teacher.create({
            userId: user.id,
            organizationId: organization.id,
          });

          worksheet.addRow({ email, password });

          if (data["Assigned Classes"]) {
            console.warn(
              `Note: 'Assigned Classes' provided for ${firstName} ${lastName}, but no class assignment logic exists.`
            );
          }

          // Best-effort email — a delivery failure shouldn't undo (or mark
          // failed) an account that was already created, since the password
          // is a known default rather than something only the email reveals.
          try {
            await sendEmail({
              to: email,
              subject: "Your Teacher Account in Snabel elahssan",
              text: `Hello ${firstName},\n\nYour teacher account has been created.\n\nEmail: ${email}\nPassword: ${password}\n\nPlease log in and change your password immediately.`,
            });
          } catch (emailError) {
            logger.error("Failed to send onboarding email (non-blocking):", { emailError, email });
          }

          successfulEntries.push({ row: data, message: "Teacher added successfully", teacherId: new_teacher.id });
        } catch (error) {
          failedEntries.push({
            row: data,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Save Excel Files for each organization
    const outputDir = path.resolve(__dirname, "../../output_teacher");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const savedFiles: string[] = [];
    for (const orgName in organizationFiles) {
      const { workbook } = organizationFiles[orgName];
      const safeName = orgName.replace(/[\/\\?%*:|"<>]/g, "_");
      const filePath = path.resolve(outputDir, `${safeName}_Teachers.xlsx`);
      await workbook.xlsx.writeFile(filePath);
      savedFiles.push(filePath);
    }

    res.json({
      message: "Teacher import completed",
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
      files: savedFiles,
    });
  } catch (error) {
    logger.error("Error in addTeacher:", { error });
    res.status(500).json({
      success: false,
      message: "Internal server error during teacher creation",
      error: error instanceof Error ? error.message : JSON.stringify(error),
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

    const classGrades = await Class.findAll({
      where: { organizationId: teacher?.organizationId || student?.organizationId },
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
