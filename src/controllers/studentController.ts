import { Request, Response } from "express";
import logger from "../config/logger";

import { JwtPayload } from "jsonwebtoken";
import Student from "../models/student.model";
import User from "../models/user.model";
import bcrypt from "bcryptjs";
import StudentTask from "../models/student-task.model";
import Task from "../models/task.model";
import StudentChallenge from "../models/student-challenge.model";
import Challenge from "../models/challenge.model";
import Organization from "../models/oraganization.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import { generatePassword, generateSixDigitPassword } from "../helpers/generatePassword";
import { sendEmail } from "../helpers/sendEmail";
import { buildAccountCreatedEmail, getEmailAttachments, getAppUrl } from "../helpers/emailTemplates";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import Tree from "../models/tree.model";
import { Sequelize, QueryTypes, where } from "sequelize";
import { Op, fn, col, literal } from "sequelize";
import TaskCategory from "../models/task-category.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import generateUniqueConnectCode from "../helpers/generateRandomconnectcode";
import { getImportField } from "../helpers/importFieldLookup";
import { buildCategoryCounts } from "../helpers/taskCategoryStats";
import {
  computeSanabelCostPerColor,
  computeMissingSanabel,
  hasSufficientSanabel,
} from "../helpers/shopPricing";
import { completeMissionForStudent } from "../helpers/completeMission";
import { utcGameplayDate } from "../services/studentTodoService";

declare global {
  namespace Express {
    interface Request {
      processedData?: Record<string, any>;
    }
  }
}
const studentData = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  try {
    const student = await Student.findOne({
      where: { userId: user.id },
      include: [
        {
          model: User,
          as: "user", // use the alias defined in the association
          attributes: [
            "firstName",
            "lastName",
            "email",
            "profileImg",
            "gender",
            "dateOfBirth",
            "seenGuides",
          ],
        },
        {
          model: Class,
          as: "Class",
          attributes: ["id", "classname", "grade"],
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
          model: Grade,
          as: "GradeEntity",
          attributes: ["id", "name"],
          required: false,
        }
      ],
    });
    if (!student) {
      return res.status(404).json({ message: "User or Student not found" });
    } else {
      const treePoint = await Tree.findOne({
        where: { id: student.treeProgress },
        attributes: ["id", "seeders", "water", "stage", "treeProgress"],
      });
      const missionDate = new Date().toISOString().slice(0, 10);
      const responseData = {
        student,
        treePoint: treePoint || null,
        completedTasks: {
          date: missionDate,
          taskIds: (await StudentTask.findAll({
            where: { studentId: student.id, date: missionDate, completionStatus: "Completed" },
            attributes: ["taskId"],
          })).map((task) => task.taskId),
        },
      };
      res.status(200).json({ data: responseData });
    }
  } catch (error) {
    logger.error("Error fetching student data:", { error, userId: user.id });
    res.status(500).json({ message: "Error fetching student data" });
  }
};

const updateData = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;
  const { firstName, lastName, grade, profileImg } = req.body;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  const student = await Student.findOne({ where: { userId: user.id } });
  const userRecord = await User.findOne({ where: { id: user.id } });

  if (!student || !userRecord) {
    return res.status(404).json({ message: "User or Student not found" });
  }

  const userUpdateData: Record<string, any> = {};
  const studentUpdateData: Record<string, any> = {};

  if (firstName) userUpdateData.firstName = firstName;
  if (lastName) userUpdateData.lastName = lastName;

  if (grade) studentUpdateData.grade = grade;

  if (profileImg && typeof profileImg === "object") {
    // Optional: add shape validation here
    userUpdateData.profileImg = profileImg;
    studentUpdateData.profileImg = profileImg;
  }

  // Update only if there's something to update
  if (Object.keys(userUpdateData).length > 0) {
    await userRecord.update(userUpdateData);
  }

  if (Object.keys(studentUpdateData).length > 0) {
    await student.update(studentUpdateData);
  }

  res
    .status(200)
    .json({ message: "User and Student data updated successfully" });
};

const deleteData = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  const student = await Student.findOne({ where: { userId: user.id } });
  const userRecord = await User.findOne({ where: { id: user.id } });
  if (!student || !userRecord) {
    return res.status(404).json({ message: "User or Student not found" });
  }

  await StudentTask.destroy({ where: { studentId: student?.id } });
  await StudentChallenge.destroy({ where: { studentId: student?.id } });

  // Delete student first, then delete user
  await student.destroy();
  await userRecord.destroy();

  res
    .status(200)
    .json({ message: "User and Student data deleted successfully" });
};
const appearTaskes = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    const taskes = await Task.findAll();
    if (!taskes) {
      return res
        .status(404)
        .json({ message: "taskes data not found in request" });
    } else {
      return res.status(200).json({ data: taskes });
    }
  } catch (error) {
    return res.status(500).json({ error: error });
  }
};

const appearTaskesType = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }

    const [student, teacher, parent] = await Promise.all([
      Student.findOne({ where: { userId: user.id } }),
      Teacher.findOne({ where: { userId: user.id } }),
      Parent.findOne({ where: { userId: user.id } }),
    ]);

    if (!student && !teacher && !parent) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }

    const categoryId = Number(req.params.categoryId);

    if (!categoryId || typeof categoryId !== "number") {
      return res.status(400).json({ message: "Invalid category parameter" });
    }

    const task = await Task.findAll({ where: { categoryId } });

    if (!task || task.length === 0) {
      return res
        .status(404)
        .json({ message: "No tasks found for this category" });
    }

    return res.status(200).json({ data: task });
  } catch (error) {
    logger.error("Error fetching tasks:", { error });
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const appearTaskesTypeandCategory = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }

    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }

    const type = req.params.type;
    const categoryId = Number(req.params.categoryId);

    // Validate categoryId and type
    if (isNaN(categoryId) || !type || typeof type !== "string") {
      return res
        .status(400)
        .json({ message: "Invalid category or type parameter" });
    }

    // Completion DATEONLY is the authoritative UTC gameplay day.
    const missionDate = new Date().toISOString().slice(0, 10);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

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
      return res.status(404).json({
        message: "No tasks found for today in the given category and type",
      });
    }

    // Extract task IDs
    const taskIds = tasks.map((task) => task.id);

    // Fetch completed tasks today
    const completedTasks = await StudentTask.findAll({
      where: {
        studentId: student.id,
        taskId: { [Op.in]: taskIds },
        completionStatus: "Completed",
        ...(student.classId ? { updatedAt: { [Op.between]: [startOfDay, endOfDay] } } : { date: missionDate }),
      },
      attributes: ["taskId"],
      raw: true,
    });

    // Extract completed task IDs
    const completedTaskIds = new Set(completedTasks.map((st) => st.taskId));

    // Merge task data with completion status
    const mergedTasks = tasks.map((task) => ({
      ...task,
      completionStatus: completedTaskIds.has(task.id)
        ? "Completed"
        : "Not Completed",
    }));

    return res.status(200).json({ tasks: mergedTasks });
  } catch (error) {
    logger.error("Error in appearTaskesTypeandCategory:", { error });
    return res.status(500).json({ error: "Internal Server Error" });
  }
};


const appearTaskesCategory = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }

    const [student, teacher, parent] = await Promise.all([
      Student.findOne({ where: { userId: user.id } }),
      Teacher.findOne({ where: { userId: user.id } }),
      Parent.findOne({ where: { userId: user.id } }),
    ]);

    if (!student && !teacher && !parent) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    const cateogrydata = await TaskCategory.findAll({ order: [["id", "ASC"]] });
    if (cateogrydata.length === 0) {
      return res
        .status(503)
        .json({ message: "Mission catalog is temporarily unavailable" });
    }

    return res.status(200).json({ data: cateogrydata });
  } catch (error) {
    logger.error("Error in appearTaskesCategory:", { error });
    return res
      .status(500)
      .json({ error: "Internal Server Error", details: error });
  }
};

export const ensureStudentChallenges = async (
  studentId: number,
  transaction?: any,
) => {
  const allChallenges = await Challenge.findAll({ transaction });
  if (allChallenges.length === 0) return;

  const existingStudentChallenges = await StudentChallenge.findAll({
    where: { studentId },
    attributes: ["challengeId"],
    transaction,
  });

  const existingChallengeIds = new Set(
    existingStudentChallenges.map((sc) => sc.challengeId),
  );

  const missingChallenges = allChallenges.filter(
    (challenge) => !existingChallengeIds.has(challenge.id),
  );

  if (missingChallenges.length > 0) {
    const newStudentChallenges = missingChallenges.map((challenge) => ({
      studentId,
      challengeId: challenge.id,
      completionStatus: "NotCompleted" as any,
      pointOfStudent: 0,
    }));

    await StudentChallenge.bulkCreate(newStudentChallenges, {
      ignoreDuplicates: true,
      transaction,
    });
  }
};

const appearTrophySecondaireCompleted = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    await ensureStudentChallenges(student.id);
    const challenge = await StudentChallenge.findAll({
      where: {
        studentId: student.id,
        completionStatus: "Completed",
        "$challenge.tasktype$": { [Op.is]: null },
      },
      include: [
        {
          model: Challenge,
          as: "challenge",
          attributes: [
            "title",
            "description",
            "category",
            "point",
            "level",
            "xp",
            "snabelBlue",
            "snabelRed",
            "snabelYellow",
            "tasktype",
            "water",
            "seeder",
            "taskCategory",
          ],
        },
      ],
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "Challenges data not found in request" });
    } else {
      return res.status(200).json({ data: challenge });
    }
  } catch (error) {
    return res.status(500).json({ error: error });
  }
};
const appearTrophySecondaireNotCompleted = async (
  req: Request,
  res: Response
) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    await ensureStudentChallenges(student.id);
    const challenge = await StudentChallenge.findAll({
      where: {
        studentId: student.id,
        completionStatus: "NotCompleted",
        "$challenge.tasktype$": { [Op.is]: null },
      },
      include: [
        {
          model: Challenge,
          as: "challenge",
          attributes: [
            "title",
            "description",
            "category",
            "point",
            "level",
            "xp",
            "snabelBlue",
            "snabelRed",
            "snabelYellow",
            "tasktype",
            "water",
            "seeder",
            "taskCategory",
          ],
        },
      ],
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "Challenges data not found in request" });
    } else {
      return res.status(200).json({ data: challenge });
    }
  } catch (error) {
    return res.status(500).json({ error: error });
  }
};
const appearTrophyPrimaireCompleted = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    await ensureStudentChallenges(student.id);
    const challenge = await StudentChallenge.findAll({
      where: {
        studentId: student.id,
        completionStatus: "Completed",
        "$challenge.tasktype$": { [Op.ne]: null },
      },
      include: [
        {
          model: Challenge,
          as: "challenge",
          attributes: [
            "title",
            "description",
            "category",
            "point",
            "level",
            "xp",
            "water",
            "seeder",
            "snabelBlue",
            "snabelRed",
            "snabelYellow",
            "tasktype",

            "taskCategory",
          ],
        },
      ],
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "Challenges data not found in request" });
    } else {
      return res.status(200).json({ data: challenge });
    }
  } catch (error) {
    return res.status(500).json({ error: error });
  }
};
const appearTrophyPrimaireNotCompleted = async (
  req: Request,
  res: Response
) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    await ensureStudentChallenges(student.id);
    const challenge = await StudentChallenge.findAll({
      where: {
        studentId: student.id,
        completionStatus: "NotCompleted",
        "$challenge.tasktype$": { [Op.ne]: null },
      },
      include: [
        {
          model: Challenge,
          as: "challenge",
          attributes: [
            "title",
            "description",
            "category",
            "point",
            "level",
            "xp",
            "water",
            "seeder",
            "snabelBlue",
            "snabelRed",
            "snabelYellow",
            "tasktype",

            "taskCategory",
          ],
        },
      ],
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "Challenges data not found in request" });
    } else {
      return res.status(200).json({ data: challenge });
    }
  } catch (error) {
    return res.status(500).json({ error: error });
  }
};
const appearTaskCompletedcountToday = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;

    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }

    const student = await Student.findOne({ where: { userId: user.id } });

    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found for the user" });
    }

    // One canonical UTC gameplay day for both branches. This previously read
    // School Student counts from a local-server-midnight window over
    // `updatedAt`, which diverges from the rest of the daily mission system in
    // two ways: it drifts whenever the server timezone is not UTC, and it
    // counts by row-touch time, so a Sunday mission approved on Wednesday was
    // counted as completed on Wednesday. `date` is the mission's own day.
    const tasks = await StudentTask.findAll({
      where: {
        studentId: student.id,
        completionStatus: "Completed",
        date: utcGameplayDate(),
      },
      attributes: ["taskId"],
    });


    return res.status(200).json({
      message: "Completed tasks retrieved successfully",
      completedTasksCount: tasks.length,
    });
  } catch (error) {
    const userId = (req as any).user?.id;
    logger.error("Error fetching completed tasks count today:", { error, userId });
    return res.status(500).json({ error: "An unexpected error occurred" });
  }
};



const appearTaskCompleted = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;

    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }

    const student = await Student.findOne({ where: { userId: user.id } });

    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found for the user" });
    }

    const tasks = await StudentTask.findAll({
      where: {
        studentId: student.id,
        completionStatus: "Completed",
      },
      include: [
        {
          model: Task,
          as: "task",
          attributes: [
            "title",
            "type",
            "description",
            "categoryId",

            "snabelRed",
            "snabelYellow",
            "snabelBlue",
            "xp",
          ],
          include: [
            {
              model: TaskCategory, // Include TaskCategory table
              as: "category", // Make sure this alias matches your Sequelize association
              attributes: ["title"], // Fetch the category title
            },
          ],
        },
      ],
    });

    if (!tasks || tasks.length === 0) {
      return res
        .status(200)
        .json({ message: "No completed tasks found", completedTasksCount: 0, completedTasks: [] });
    }

    // Format the response to include category title
    const completedTasks = tasks.map((task: any) => ({
      id: task.taskId,
      taskId: task.taskId,
      title: task.task ? task.task.title : "",
      type: task.task ? task.task.type : "",
      createdAt: task.createdAt,
      missionDate: task.date,
      description: task.task ? task.task.description : "",
      categoryId: task.task ? task.task.categoryId : null,
      category: task.task?.category ? task.task.category.title : "Unknown", // Category title
      tasktype: task.task?.tasktype ?? "Unknown",
      snabelRed: task.task?.snabelRed ?? 0,
      snabelYellow: task.task?.snabelYellow ?? 0,
      snabelBlue: task.task?.snabelBlue ?? 0,
      xp: task.task?.xp ?? 0,
      updatedAt: task.updatedAt,
    }));

    return res.status(200).json({
      message: "Completed tasks retrieved successfully",
      completedTasksCount: completedTasks.length,
      completedTasks,
    });
  } catch (error) {
    const userId = (req as any).user?.id;
    logger.error("Error fetching completed tasks:", { error, userId });
    return res.status(500).json({ error: "An unexpected error occurred" });
  }
};




const calculateCompletedTasksByCategory = async (
  req: Request,
  res: Response
) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized: User not found." });
    }

    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    // Fetch all unique categories from TaskCategory (to get titles)
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
    const categoryCounts = completedTasks.reduce(
      (acc: Record<string, number>, row: any) => {
        acc[row["title"]] = Number(row["count"]) || 0;
        return acc;
      },
      {} as Record<string, number>
    );

    // Ensure all unique categories appear in the final response (even if count is 0)
    const finalCategoryCounts = buildCategoryCounts(
      allCategories.map((category) => category.title),
      categoryCounts,
    );

    // Calculate total completed tasks
    const totalCompletedTasks = (
      Object.values(finalCategoryCounts) as number[]
    ).reduce((sum: number, count: number) => sum + count, 0);
    return res.status(200).json({
      totalCompletedTasks,
      categoryCounts: finalCategoryCounts,
    });
  } catch (error: any) {
    const userId = (req as any).user?.id;
    logger.error("Error calculating completed tasks by category:", { error: error.message || error, userId });
    return res.status(500).json({
      error: "Internal Server Error",
      details: error.message || "Unknown error",
    });
  }
};




const appearChallangesSecondaire = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    await ensureStudentChallenges(student.id);
    const challenge = await StudentChallenge.findAll({
      where: {
        studentId: student.id,
        "$challenge.tasktype$": { [Op.is]: null },
      },
      include: [
        {
          model: Challenge,
          as: "challenge",
          attributes: [
            "title",
            "description",
            "category",
            "point",
            "level",
            "xp",
            "water",
            "seeder",
            "snabelBlue",
            "snabelRed",
            "snabelYellow",
            "taskCategory",
            "tasktype",
          ],
        },
      ],
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "Challenges data not found in request" });
    } else {
      return res.status(200).json({ data: challenge });
    }
  } catch (error) {
    logger.error("Error in appearChallangesSecondaire:", { error });
    return res.status(500).json({ error: error });
  }
};

const appearChallangesPrimaire = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) {
      return res
        .status(404)
        .json({ message: "User data not found in request" });
    }
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    await ensureStudentChallenges(student.id);
    const challenge = await StudentChallenge.findAll({
      where: {
        studentId: student.id,
        "$challenge.tasktype$": { [Op.ne]: null },
      },
      include: [
        {
          model: Challenge,
          as: "challenge",
          attributes: [
            "title",
            "description",
            "category",
            "point",
            "level",
            "xp",
            "water",
            "seeder",
            "snabelBlue",
            "snabelRed",
            "snabelYellow",
            "taskCategory",
            "tasktype",
          ],
        },
      ],
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "Challenges data not found in request" });
    } else {
      return res.status(200).json({ data: challenge });
    }
  } catch (error) {
    logger.error("Error in appearChallangesPrimaire:", { error });
    return res.status(500).json({ error: error });
  }
};

// GET /leaderboard?grade=5&gender=Female
const appearLeaderboard = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { className, grade, gender } = req.query;
    if (className && !grade ) {
      return res.status(400).json({
        message:
          "If 'className' is provided, 'grade' must also be included.",
      });
    }

    const currentUser = await User.findByPk(user.id);
    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    const student = await Student.findOne({ where: { userId: user.id } });

    if (!teacher && !student) {
      return res
        .status(403)
        .json({ message: "Access denied. Not a teacher or student." });
    }

    const userFilters: any = {};
    const classFilters: any = {};
    const studentFilters: any = {};

    if (gender) userFilters.gender = gender;
    if (className) classFilters.classname = className;
    if (grade) classFilters.grade = grade;

    if (teacher) {
      let orgId = teacher.organizationId;
      if (!orgId) {
        // Fallback: look up the teacher's classes to resolve organizationId
        const firstClass = await Class.findOne({
          where: { teacherId: teacher.id },
          attributes: ["organizationId"],
        });
        if (firstClass) {
          orgId = firstClass.organizationId;
        }
      }
      if (!orgId) {
        return res.status(200).json({ students: [] });
      }
      studentFilters.organizationId = orgId;
    } else if (student) {
      // For student: if organizationId is null, filter students with organizationId null,
      // else filter by student's organizationId
      if (!student.organizationId) {
        studentFilters.organizationId = null;
      } else {
        studentFilters.organizationId = student.organizationId;
      }
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const students = await Student.findAll({
      where: studentFilters,
      include: [
        {
          model: User,
          as: "user",
          where: userFilters,
          attributes: [
            "firstName",
            "lastName",
            "email",
            "profileImg",
            "gender",
          ],
        },
        {
          model: Class,
          as: "class",
          where: classFilters,
          attributes: ["classname", "grade"],
        },
      ],
      order: [["xp", "DESC"]],
      limit,
      offset,
    });

    return res.status(200).json({ students });
  } catch (error) {
    logger.error("Error in appearLeaderboard:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};


const mutationResult = (status: number, body: Record<string, any>) => ({ status, body });

const buyWaterSeeder = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user)
      return res.status(401).json({ message: "User not authenticated" });

    logger.info("buyWaterSeeder request body:", req.body);
    const quantity = (value: unknown) => value === undefined ? 0
      : (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) ? Number(value) : NaN;
    const water = quantity(req.body.water);
    const seeders = quantity(req.body.seeders);

    if (!Number.isSafeInteger(water) || !Number.isSafeInteger(seeders) || water < 0 || seeders < 0) {
      logger.warn("buyWaterSeeder returning 400: invalid quantities", { water, seeders });
      return res.status(400).json({ error: "Invalid water or seeders quantity" });
    }

    if (water === 0 && seeders === 0) {
      logger.warn("buyWaterSeeder returning 400: Add some seeders or water first", { water, seeders });
      return res.status(400).json({ error: "Add some seeders or water first" });
    }

    const result = await Student.sequelize.transaction(async (t) => {
      const student = await Student.findOne({ where: { userId: user.id }, transaction: t, lock: true });
      if (!student) return mutationResult(404, { message: "Student not found" });

      const totalPerColor = computeSanabelCostPerColor(
        water,
        seeders,
        student.treeProgress,
      );
      const available = {
        snabelRed: student.snabelRed,
        snabelBlue: student.snabelBlue,
        snabelYellow: student.snabelYellow,
      };
      const required = {
        snabelRed: totalPerColor,
        snabelBlue: totalPerColor,
        snabelYellow: totalPerColor,
      };

      logger.info("buyWaterSeeder balance check:", { available, required });

      if (!hasSufficientSanabel(totalPerColor, available)) {
        const missing = computeMissingSanabel(totalPerColor, available);
        logger.warn("buyWaterSeeder returning 400: Insufficient snabel balance", {
          required,
          available,
          missing,
        });
        // The client renders `missing` directly in the insufficient-funds popup,
        // so the amounts shown always match what this endpoint actually charges.
        return mutationResult(400, {
          error: "Insufficient snabel balance",
          required,
          available,
          missing,
        });
      }

      // Water/seeder challenge progress is a side effect of the purchase — a
      // student with no such challenge rows must still be able to buy.
      const purchases = [
        { category: "water", amount: water },
        { category: "seeder", amount: seeders },
      ].filter((p) => p.amount > 0);


      for (const { category, amount } of purchases) {
        const challengeRows = await StudentChallenge.findAll({
          where: { studentId: student.id, completionStatus: "NotCompleted" },
          include: [{ model: Challenge, as: "challenge", where: { category } }],
          transaction: t,
        });

        for (const row of challengeRows) {
          const newPoints = row.pointOfStudent + amount;
          row.pointOfStudent = newPoints;
          if (row.challenge && row.challenge.point != null && newPoints >= row.challenge.point) {
            row.completionStatus = "Completed" as any;
            student.xp = (student.xp || 0) + (row.challenge.xp || 0);
            student.snabelRed = (student.snabelRed || 0) + (row.challenge.snabelRed || 0);
            student.snabelBlue = (student.snabelBlue || 0) + (row.challenge.snabelBlue || 0);
            student.snabelYellow = (student.snabelYellow || 0) + (row.challenge.snabelYellow || 0);
            student.water = (student.water || 0) + (row.challenge.water || 0);
            student.seeders = (student.seeders || 0) + (row.challenge.seeder || 0);
          }
          await row.save({ transaction: t });
        }
      }

      student.snabelRed -= totalPerColor;
      student.snabelBlue -= totalPerColor;
      student.snabelYellow -= totalPerColor;
      student.water += water;
      student.seeders += seeders;

      await student.save({ transaction: t });

      return mutationResult(200, { message: "Updated successfully", student });
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error in buyWaterSeeder:", { error });
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const growTheTree = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user)
      return res
        .status(404)
        .json({ message: "User data not found in request" });

    // Serialize gameplay changes before reading balances or inventory.
    const result = await Student.sequelize.transaction(async (t) => {
      const student = await Student.findOne({ where: { userId: user.id }, transaction: t, lock: true });
      if (!student)
        return mutationResult(404, { message: "Student data not found in request" });

      const [treeLevel, maxTreeLevel] = await Promise.all([
        Tree.findByPk(student.treeProgress, { transaction: t }),
        Tree.max("id", { transaction: t }) as Promise<number>, // Explicitly tell TypeScript it's a number
      ]);

      if (!treeLevel)
        return mutationResult(404, { message: "Tree data not found" });
      if (student.treeProgress >= maxTreeLevel)
        return mutationResult(400, { message: "You have reached the maximum tree level!" });

      if (student.seeders < treeLevel.seeders || student.water < treeLevel.water)
        return mutationResult(400, { message: "Not enough seeders or water to grow the tree" });

      // Deduct resources and update progress
      Object.assign(student, {
        seeders: student.seeders - treeLevel.seeders,
        water: student.water - treeLevel.water,
        treeProgress: student.treeProgress + 1,
      });

      // Fetch all open student challenges
      const studentChallenges = await StudentChallenge.findAll({
        where: { studentId: student.id, completionStatus: "NotCompleted" },
        include: [{ model: Challenge, as: "challenge" }],
        transaction: t,
      });

      const treeLevelChallenges = studentChallenges.filter(
        (ch) => ch.challenge?.category === "treelevel"
      );
      const treeStageChallenges = studentChallenges.filter(
        (ch) => ch.challenge?.category === "treestage"
      );

      // The new tree row the student just advanced to; drives stage challenges.
      const nextTreeLevel =
        student.treeProgress <= maxTreeLevel
          ? await Tree.findByPk(student.treeProgress, { transaction: t })
          : null;


      for (const treeChallenge of treeLevelChallenges) {
        const newPoints = treeChallenge.pointOfStudent + 1;
        treeChallenge.pointOfStudent = newPoints;

        if (
          treeChallenge.challenge && treeChallenge.challenge.point != null &&
          newPoints >= treeChallenge.challenge.point
        ) {
          treeChallenge.completionStatus = "Completed" as any;
          student.snabelRed += treeChallenge.challenge.snabelRed;
          student.snabelBlue += treeChallenge.challenge.snabelBlue;
          student.snabelYellow += treeChallenge.challenge.snabelYellow;
          student.xp += treeChallenge.challenge.xp;
        }
        await treeChallenge.save({ transaction: t });
      }

      if (nextTreeLevel) {
        for (const treeChallenge of treeStageChallenges) {
          treeChallenge.pointOfStudent = nextTreeLevel.stage;

          // ">=" not "===": if a stage milestone is ever skipped over, the
          // challenge must still complete instead of being stuck forever.
          if (
            treeChallenge.challenge && treeChallenge.challenge.point != null &&
            nextTreeLevel.stage >= treeChallenge.challenge.point
          ) {
            treeChallenge.completionStatus = "Completed" as any;
            student.snabelRed += treeChallenge.challenge.snabelRed;
            student.snabelBlue += treeChallenge.challenge.snabelBlue;
            student.snabelYellow += treeChallenge.challenge.snabelYellow;
            student.xp += treeChallenge.challenge.xp;
          }
          await treeChallenge.save({ transaction: t });
        }
      }

      await student.save({ transaction: t });

      return mutationResult(200, { message: "Tree successfully grown!", student, treePoint: nextTreeLevel });
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error in growing the tree:", { error });
    return res.status(500).json({ error: "Internal Server Error" });
  }
};


// Retained temporarily as reference for credential-workbook compatibility.
// The active importer below applies tenant scope and relationship validation.
const addStudentLegacy = async (req: Request, res: Response) => {
  const processedData: any = req.processedData;
  const successfulEntries: any[] = [];
  const failedEntries: any[] = [];
  const organizationFiles: Record<
    string,
    { workbook: ExcelJS.Workbook; worksheet: ExcelJS.Worksheet }
  > = {};

  try {
    for (const sheet in processedData) {
      const all_data = processedData[sheet];
      for (const data of all_data) {
        try {
          const firstName = getImportField(data, "FirstName", "firstName", "first_name");
          const lastName = getImportField(data, "LastName", "lastName", "last_name");
          const email = getImportField(data, "Email", "email");
          const gradeInput = getImportField(data, "Grade", "grade");
          const orgInput = getImportField(data, "OrganizationName", "organizationName", "school", "School");
          const classInput = getImportField(data, "ClassName", "className", "class", "Class");
          const dateOfBirth = getImportField(data, "DateOfBirth", "dateOfBirth");
          const gender = getImportField(data, "Gender", "gender");

          if (!firstName || !lastName || !email) {
            failedEntries.push({ row: data, error: "Missing firstName, lastName, or email" });
            continue;
          }

          // ✅ Find or auto-create Organization (normalized the same way
          // the standalone org/class Excel importers already store names)
          const orgName = String(orgInput || "").trim().toLowerCase();
          if (!orgName) {
            failedEntries.push({ row: data, error: "Missing school/organization name" });
            continue;
          }
          let organization = await Organization.findOne({ where: { name: orgName } });
          if (!organization) {
            organization = await Organization.create({ name: orgName });
          }

          // ✅ Manage Excel Files for Organizations
          if (!organizationFiles[organization.name]) {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Users");
            worksheet.columns = [
              { header: "Email", key: "email", width: 30 },
              { header: "Password", key: "password", width: 20 },
            ];
            organizationFiles[organization.name] = { workbook, worksheet };
          }

          const { worksheet } = organizationFiles[organization.name];

          // ✅ Find or auto-create Grade
          const gradeName = String(gradeInput || "").trim().toLowerCase();
          let gradeRecord = gradeName ? await Grade.findOne({ where: { name: gradeName } }) : null;
          if (!gradeRecord && gradeName) {
            gradeRecord = await Grade.create({ name: gradeName });
          }

          // ✅ Find or auto-create Class
          const className = String(classInput || "").trim();
          if (!className) {
            failedEntries.push({ row: data, error: "Missing class name" });
            continue;
          }
          let class_data = await Class.findOne({
            where: { organizationId: organization.id, classname: className },
          });
          if (!class_data) {
            class_data = await Class.create({
              classname: className,
              organizationId: organization.id,
              gradeId: gradeRecord ? gradeRecord.id : null,
              grade: gradeRecord ? gradeRecord.name : gradeName || null,
            });
          }

          // ✅ Check if Email Already Exists
          if (await User.findOne({ where: { email } })) {
            failedEntries.push({ row: data, error: "Email is already in use" });
            continue;
          }

          // ✅ Create User & Student
          const password = generateSixDigitPassword();
          const hashedPassword = bcrypt.hashSync(password, 10);
          worksheet.addRow({ email, password });

          // User + Student must be created together — if Student.create
          // throws (e.g. a bad treeProgress FK) after User.create already
          // committed, the user row is orphaned (no student record, but the
          // email is permanently "taken" so the row can never be retried).
          const connectCode = await generateUniqueConnectCode();
          let new_user!: User;
          let new_student!: Student;
          await User.sequelize!.transaction(async (t) => {
            new_user = await User.create(
              {
                firstName,
                lastName,
                email,
                role: "Student",
                password: hashedPassword,
                dateOfBirth: dateOfBirth || null,
                gender: gender || null,
                isAccess: true,
                otpVerified: true,
              },
              { transaction: t }
            );
            new_student = await Student.create(
              {
                connectCode,
                treeProgress: 1,
                gradeId: gradeRecord ? gradeRecord.id : null,
                grade: gradeRecord ? gradeRecord.name : gradeName || null,
                userId: new_user.id,
                organizationId: organization.id,
                classId: class_data.id,
              },
              { transaction: t }
            );
            await ensureStudentChallenges(new_student.id, t);
          });

          // ✅ Best-effort email — a delivery failure shouldn't undo (or
          // mark failed) an account that was already created, since the
          // password is a known default rather than something only the
          // email reveals. Tracked per-row so the organizer can see which
          // accounts may need their credentials shared another way.
          let emailSent = false;
          try {
            await sendEmail({
              to: email,
              subject: "Your account in Snabel elahssan",
              text: `Your email is ${email}, and your password is ${password}. Log in at ${getAppUrl()}`,
              html: buildAccountCreatedEmail({
                firstName,
                email,
                password,
                roleLabel: "student",
              }),
              attachments: getEmailAttachments(),
            });
            emailSent = true;
          } catch (emailError) {
            logger.error("Failed to send onboarding email (non-blocking):", { emailError, email });
          }

          // ✅ Assign Tasks & Challenges After Email
          const allChallenges = await Challenge.findAll();

          const studentChallenges = allChallenges.map((challenge) => ({
            studentId: new_student.id,
            challengeId: challenge.id,
            completionStatus: "NotCompleted",
          }));

          await StudentChallenge.bulkCreate(studentChallenges);

          // ✅ Update Success Entries & Excel File
          successfulEntries.push({
            row: data,
            message: "Student added successfully",
            studentId: new_student.id,
            connectCode,
            emailSent,
          });
        } catch (error) {
          failedEntries.push({
            row: data,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // ✅ Save the organization's Excel File
    const outputDir = path.resolve(__dirname, "../../output"); // Adjust path
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const savedFiles: string[] = [];
    for (const orgName in organizationFiles) {
      const { workbook } = organizationFiles[orgName];
      const sanitizedOrgName = orgName.replace(/[\/\\?%*:|"<>]/g, "_"); // Sanitize filename
      const filePath = path.resolve(
        outputDir,
        `${sanitizedOrgName}_Users.xlsx`
      );

      await workbook.xlsx.writeFile(filePath);
      savedFiles.push(filePath);
    }

    // ✅ Response with Summary
    res.json({
      message: "Excel file processing completed",
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
      files: savedFiles,
    });
  } catch (error) {
    logger.error("Error processing Excel file (student upload):", { error });
    res.status(500).json({ message: "Internal server error", error: error });
  }
};


const addStudent = async (req: Request, res: Response) => {
  const processedData: any = req.processedData;
  const successfulEntries: any[] = [];
  const failedEntries: any[] = [];
  const organizationFiles: Record<
    string,
    { workbook: ExcelJS.Workbook; worksheet: ExcelJS.Worksheet }
  > = {};
  const adminScope = (
    req as Request & { adminOrganizationId?: number | null }
  ).adminOrganizationId ?? null;

  const fail = (
    rowNumber: number,
    email: string,
    code: string,
    message: string,
  ) => failedEntries.push({ rowNumber, email: email || null, code, message });

  if (!processedData || typeof processedData !== "object") {
    return res.status(400).json({ message: "No processed import data found" });
  }

  try {
    for (const sheet in processedData) {
      const rows = Array.isArray(processedData[sheet]) ? processedData[sheet] : [];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const data = rows[rowIndex];
        const rowNumber = rowIndex + 2;
        let email = "";

        try {
          const firstName = String(
            getImportField(data, "FirstName", "firstName", "first_name") || "",
          ).trim();
          const lastName = String(
            getImportField(data, "LastName", "lastName", "last_name") || "",
          ).trim();
          email = String(getImportField(data, "Email", "email") || "")
            .trim()
            .toLowerCase();
          const orgName = String(
            getImportField(
              data,
              "OrganizationName",
              "organizationName",
              "school",
              "School",
            ) || "",
          )
            .trim()
            .toLowerCase();
          const gradeName = String(
            getImportField(data, "Grade", "grade") || "",
          )
            .trim()
            .toLowerCase();
          const className = String(
            getImportField(data, "ClassName", "className", "class", "Class") || "",
          ).trim();

          if (!firstName || !lastName || !email) {
            fail(
              rowNumber,
              email,
              "REQUIRED_FIELD_MISSING",
              "firstName, lastName and email are required",
            );
            continue;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            fail(rowNumber, email, "INVALID_EMAIL", "Email format is invalid");
            continue;
          }

          let organization: Organization | null = null;
          if (adminScope !== null) {
            organization = await Organization.findByPk(adminScope);
            if (!organization) {
              fail(
                rowNumber,
                email,
                "ADMIN_SCOPE_INVALID",
                "The administrator's organization no longer exists",
              );
              continue;
            }
            if (orgName && organization.name.trim().toLowerCase() !== orgName) {
              fail(
                rowNumber,
                email,
                "FORBIDDEN_ORGANIZATION",
                "School admins cannot import students into another organization",
              );
              continue;
            }
          } else {
            if (!orgName) {
              fail(
                rowNumber,
                email,
                "ORGANIZATION_REQUIRED",
                "School/organization is required",
              );
              continue;
            }
            organization = await Organization.findOne({ where: { name: orgName } });
            if (!organization) {
              fail(
                rowNumber,
                email,
                "ORGANIZATION_NOT_FOUND",
                "Organization does not exist; create it before importing students",
              );
              continue;
            }
          }

          let gradeRecord: Grade | null = null;
          if (gradeName) {
            gradeRecord = await Grade.findOne({
              where: { name: gradeName, organizationId: organization.id },
            });
            if (!gradeRecord) {
              gradeRecord = await Grade.findOne({
                where: { name: gradeName, organizationId: null },
              });
            }
            if (!gradeRecord) {
              fail(
                rowNumber,
                email,
                "GRADE_NOT_FOUND",
                "Grade does not exist in this organization",
              );
              continue;
            }
          }

          let classRecord: Class | null = null;
          if (className) {
            classRecord = await Class.findOne({
              where: {
                organizationId: organization.id,
                [Op.and]: where(
                  fn("LOWER", col("classname")),
                  className.toLowerCase(),
                ),
              } as any,
            });
            if (!classRecord) {
              fail(
                rowNumber,
                email,
                "CLASS_NOT_FOUND",
                "Class does not exist in this organization",
              );
              continue;
            }
            if (
              gradeRecord &&
              classRecord.gradeId != null &&
              classRecord.gradeId !== gradeRecord.id
            ) {
              fail(
                rowNumber,
                email,
                "CLASS_GRADE_MISMATCH",
                "Class does not belong to the supplied grade",
              );
              continue;
            }
            if (!gradeRecord && classRecord.gradeId != null) {
              gradeRecord = await Grade.findByPk(classRecord.gradeId);
            }
          }

          if (await User.findOne({ where: { email } })) {
            fail(rowNumber, email, "EMAIL_CONFLICT", "Email is already in use");
            continue;
          }

          const password = generateSixDigitPassword();
          const hashedPassword = bcrypt.hashSync(password, 10);
          const connectCode = await generateUniqueConnectCode();
          let newStudent!: Student;

          await User.sequelize!.transaction(async (transaction) => {
            const newUser = await User.create(
              {
                firstName,
                lastName,
                email,
                role: "Student",
                password: hashedPassword,
                dateOfBirth:
                  getImportField(data, "DateOfBirth", "dateOfBirth") || null,
                gender: getImportField(data, "Gender", "gender") || null,
                isAccess: true,
                otpVerified: true,
              },
              { transaction },
            );
            newStudent = await Student.create(
              {
                connectCode,
                treeProgress: 1,
                gradeId: gradeRecord?.id ?? null,
                grade: gradeRecord?.name ?? null,
                userId: newUser.id,
                organizationId: organization!.id,
                classId: classRecord?.id ?? null,
              },
              { transaction },
            );
            await ensureStudentChallenges(newStudent.id, transaction);
          });

          if (!organizationFiles[organization.name]) {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Users");
            worksheet.columns = [
              { header: "Email", key: "email", width: 30 },
              { header: "Password", key: "password", width: 20 },
            ];
            organizationFiles[organization.name] = { workbook, worksheet };
          }
          organizationFiles[organization.name].worksheet.addRow({ email, password });

          let emailSent = false;
          try {
            await sendEmail({
              to: email,
              subject: "Your account in Snabel elahssan",
              text: `Your email is ${email}, and your password is ${password}. Log in at ${getAppUrl()}`,
              html: buildAccountCreatedEmail({
                firstName,
                email,
                password,
                roleLabel: "student",
              }),
              attachments: getEmailAttachments(),
            });
            emailSent = true;
          } catch (emailError) {
            logger.error("Failed to send student onboarding email (non-blocking)", {
              emailError,
              studentId: newStudent.id,
            });
          }

          successfulEntries.push({
            rowNumber,
            email,
            message: "Student added successfully",
            studentId: newStudent.id,
            connectCode,
            emailSent,
            needsReview: !classRecord || !gradeRecord,
          });
        } catch (error: any) {
          const conflict = error?.name === "SequelizeUniqueConstraintError";
          fail(
            rowNumber,
            email,
            conflict ? "DUPLICATE_VALUE" : "ROW_FAILED",
            conflict
              ? "A unique value is already in use"
              : "The row could not be imported",
          );
          logger.error("Student import row failed", { error, sheet, rowNumber });
        }
      }
    }

    const outputDir = path.resolve(__dirname, "../../output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const files: string[] = [];
    for (const orgName in organizationFiles) {
      const safeName = orgName.replace(/[\/\\?%*:|"<>]/g, "_");
      const filePath = path.resolve(outputDir, `${safeName}_Users.xlsx`);
      await organizationFiles[orgName].workbook.xlsx.writeFile(filePath);
      files.push(path.basename(filePath));
    }

    return res.status(200).json({
      message: "Student import completed",
      total: successfulEntries.length + failedEntries.length,
      created: successfulEntries.length,
      failed: failedEntries.length,
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
      files,
    });
  } catch (error) {
    logger.error("Error processing student import", { error });
    return res.status(500).json({ message: "Internal server error" });
  }
};

const updateProfileImage = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;
  const { profileImg } = req.body;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  if (!profileImg || typeof profileImg !== "object") {
    return res.status(400).json({ message: "Invalid profile image data" });
  }

  try {
    const userRecord = await User.findOne({ where: { id: user.id } });
    if (!userRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    await userRecord.update({ profileImg });

    const student = await Student.findOne({ where: { userId: user.id } });
    if (student) {
      await student.update({ profileImg });
    }

    return res
      .status(200)
      .json({ message: "Profile image updated successfully" });
  } catch (error) {
    logger.error("Error updating profile image:", { error });
    return res
      .status(500)
      .json({ message: "Failed to update profile image", error });
  }
};


const legacyAddPros = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const result = await Student.sequelize.transaction(async (t) => {
      const student = await Student.findOne({ where: { userId: user.id }, transaction: t, lock: true });
      if (!student) return mutationResult(404, { message: "Student not found" });

      let { taskId, time } = req.body;
      logger.info("student addPros request:", req.body);
      if (!Number.isSafeInteger(taskId) || taskId <= 0) {
        return mutationResult(400, { message: "Invalid taskId parameter" });
      }

      const recordedAt = new Date();
      const missionDate = recordedAt.toISOString().slice(0, 10);
      let today: Date;
      if (time && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time)) {
        today = new Date(time);
      } else if (time && /^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
        today = new Date();
        const [hours, minutes] = time.split(":").map(Number);
        if (hours > 23 || minutes > 59) return mutationResult(400, { message: "Invalid time format, expected HH:mm or ISO string" });
        today.setHours(hours, minutes, 0, 0);
      } else {
        return mutationResult(400, { message: "Invalid time format, expected HH:mm or ISO string" });
      }

      if (!Number.isFinite(today.getTime())) return mutationResult(400, { message: "Invalid time format, expected HH:mm or ISO string" });

      const existingRecord = await StudentTask.findOne({
        where: {
          studentId: student.id,
          taskId,
          date: missionDate,
          completionStatus: "Completed",
        },
        transaction: t,
      });

      if (existingRecord) {
        return mutationResult(200, { message: "Task already completed today", alreadyCompleted: true, student, completion: { taskId, date: missionDate, completionStatus: "Completed" } });
      }

      const task = await Task.findOne({
        where: { id: taskId },
        include: [{ model: TaskCategory, as: "taskCategory" }],
        transaction: t,
      });

      if (!task) return mutationResult(404, { message: "Task not found" });

      const challenges = await Challenge.findAll({
        where: {
          [Op.or]: [
            { category: { [Op.in]: ["snabelBlue", "snabelRed", "snabelMixed", "snabelYellow", "xp", "alltask", "task", "tasktype"] } },
            { taskCategory: task.taskCategory?.title || "" },
            { tasktype: task.type || "" },
          ],
        } as any,
        transaction: t,
      });

      const studentChallenges = await StudentChallenge.findAll({
        where: {
          studentId: student.id,
          challengeId: challenges.map((c) => c.id),
          completionStatus: "NotCompleted",
        },
        include: [{ model: Challenge, as: "challenge" }],
        transaction: t,
      });


      // Create student task record
      await StudentTask.create(
        {
          studentId: student.id,
          taskId,
          completionStatus: "Completed",
          date: missionDate,
          createdAt: recordedAt,
        },
        { transaction: t }
      );
      logger.debug(`tastdata : ${task}`)

      // Update student's task rewards
      student.xp = (student.xp || 0) + (task.xp || 0);
      student.snabelRed = (student.snabelRed || 0) + (task.snabelRed || 0);
      student.snabelBlue = (student.snabelBlue || 0) + (task.snabelBlue || 0);
      student.snabelYellow = (student.snabelYellow || 0) + (task.snabelYellow || 0);
      await student.save({ transaction: t });

      for (const studentChallenge of studentChallenges) {
        if (studentChallenge.studentId !== student.id) continue;
        const challenge = studentChallenge.challenge;

        // Add points based on challenge category
        if (challenge.category === "xp") studentChallenge.pointOfStudent += (task.xp || 0);
        else if (challenge.category === "snabelBlue") studentChallenge.pointOfStudent += (task.snabelBlue || 0);
        else if (challenge.category === "snabelRed") studentChallenge.pointOfStudent += (task.snabelRed || 0);
        else if (challenge.category === "snabelYellow") studentChallenge.pointOfStudent += (task.snabelYellow || 0);
        else if (challenge.category === "snabelMixed") {
          studentChallenge.pointOfStudent += (task.snabelBlue || 0) + (task.snabelRed || 0) + (task.snabelYellow || 0);
        } else if (challenge.taskCategory === task.taskCategory?.title || challenge.category === "alltask") {
          studentChallenge.pointOfStudent += 1;
        } else if (challenge.tasktype && (challenge.tasktype === task.type || challenge.title === task.type)) {
          studentChallenge.pointOfStudent += 1;
        }

        // Mark challenge as completed if threshold is met. A null point
        // threshold means "not configured" and must never auto-complete —
        // `pointOfStudent >= null` coerces to `>= 0`, which is always true.
        if (challenge.point != null && studentChallenge.pointOfStudent >= challenge.point) {
          studentChallenge.completionStatus = "Completed" as any;
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

      logger.info("Task recorded successfully for student:", { studentId: student.id, taskId });
      return mutationResult(201, { message: "Task recorded successfully", student, completion: { taskId, date: missionDate, completionStatus: "Completed" } });
    });
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    // Defensive handling for other completion writers using the unique index.
    if (error?.name === "SequelizeUniqueConstraintError") {
      logger.warn("student addPros hit a unique constraint (treated as already-completed)", {
        error,
        taskId: req.body.taskId,
      });
      return res.status(409).json({ message: "Task already completed today" });
    }
    logger.error("Error in student addPros:", { error, taskId: req.body.taskId });
    // Must include `message` — the client displays this text directly, and
    // an error-only body renders as a blank alert (the reported production bug).
    return res.status(500).json({ message: "Internal Server Error", error: "Internal Server Error" });
  }
};

const addPros = async (req: Request, res: Response) => {
  const user = (req as Request & { user?: JwtPayload }).user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const taskId = Number(req.body.taskId);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return res.status(400).json({ message: "Invalid taskId parameter" });
  const time = req.body.time;
  if (typeof time !== "string" || (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time))) {
    return res.status(400).json({ message: "Invalid time format, expected HH:mm or ISO string" });
  }
  try {
    const result = await Student.sequelize.transaction(async (transaction: any) => {
      const student = await Student.findOne({ where: { userId: user.id }, transaction, lock: transaction?.LOCK?.UPDATE });
      if (!student) return mutationResult(404, { message: "Student not found" });
      if (student.classId) return mutationResult(403, { message: "School Students must request approval for mission completion" });
      const completion = await completeMissionForStudent({ studentId: student.id, taskId,
        missionDate: utcGameplayDate(), source: "solo_self", recordedAt: new Date(), transaction });
      return mutationResult(completion.alreadyCompleted ? 200 : 201, {
        message: completion.alreadyCompleted ? "Task already completed today" : "Task recorded successfully",
        alreadyCompleted: completion.alreadyCompleted,
        student: completion.student,
        completion: { taskId, date: utcGameplayDate(), completionStatus: "Completed" },
      });
    });
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    if (error?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Task already completed today" });
    }
    logger.error("Error in student addPros", { error, taskId });
    return res.status(500).json({ message: "Internal Server Error", error: "Internal Server Error" });
  }
};

export {
  addStudent,
  addPros,
  studentData,

  updateData,
  deleteData,
  appearTaskes,
  appearTrophySecondaireCompleted,
  appearTrophySecondaireNotCompleted,
  appearTrophyPrimaireCompleted,
  appearTrophyPrimaireNotCompleted,
  appearTaskCompleted,
  appearTaskCompletedcountToday,
  calculateCompletedTasksByCategory,
  appearTaskesCategory,
  appearChallangesSecondaire,
  appearChallangesPrimaire,
  appearLeaderboard,
  appearTaskesType,
  appearTaskesTypeandCategory,
  buyWaterSeeder,
  growTheTree,
  updateProfileImage,
};
