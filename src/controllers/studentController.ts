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
import { generatePassword } from "../helpers/generatePassword";
import { sendEmail } from "../helpers/sendEmail";
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
          ],
        },
      ],
    });
    if (!student) {
      return res.status(404).json({ message: "User or Student not found" });
    } else {
      const treePoint = await Tree.findOne({
        where: { id: student.treeProgress },
        attributes: ["id", "seeders", "water", "stage", "treeProgress"],
      });
      const responseData = {
        student,
        treePoint: treePoint || null,
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

    const student = await Student.findOne({ where: { userId: user.id } });
    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    const parent = await Parent.findOne({ where: { userId: user.id } });

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

    // Get the start and end of today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

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
        updatedAt: { [Op.between]: [today, endOfToday] }, // Filter only today's completed tasks
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

    const student = await Student.findOne({ where: { userId: user.id } });
    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    const parent = await Parent.findOne({ where: { userId: user.id } });

    if (!student && !teacher && !parent) {
      return res
        .status(404)
        .json({ message: "Student data not found in request" });
    }
    const cateogrydata = await TaskCategory.findAll();
    if (!cateogrydata) {
      return res
        .status(404)
        .json({ message: "Category data not found in request" });
    }

    return res.status(200).json({ data: cateogrydata });
  } catch (error) {
    logger.error("Error in appearTaskesCategory:", { error });
    return res
      .status(500)
      .json({ error: "Internal Server Error", details: error });
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

    // Get the current date (without time)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get the end of today (to cover full day range)
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const tasks = await StudentTask.findAll({
      where: {
        studentId: student.id,
        completionStatus: "Completed",
        updatedAt: {
          [Op.between]: [today, endOfToday], // Ensures same-day match
        },
      },
      include: [
        {
          model: Task,
          as: "task",
          attributes: [
            "title",
            "description",
            "categoryId",
            "snabelRed",
            "snabelYellow",
            "snabelBlue",

            "xp",
          ],
        },
      ],
    });

    if (!tasks || tasks.length === 0) {
      return res
        .status(404)
        .json({ message: "No completed tasks found for the student today" });
    }

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
        .status(404)
        .json({ message: "No completed tasks found for the student today" });
    }

    // Format the response to include category title
    const completedTasks = tasks.map((task: any) => ({
      title: task.task.title,
      type: task.task.type,
      createdAt: task.createdAt,
      description: task.task.description,
      categoryId: task.task.categoryId,
      category: task.task.category ? task.task.category.title : "Unknown", // Category title
      tasktype: task.task.tasktype ?? "Unknown",
      snabelRed: task.task.snabelRed,
      snabelYellow: task.task.snabelYellow,
      snabelBlue: task.task.snabelBlue,
      xp: task.task.xp,
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
    const finalCategoryCounts = allCategories.reduce((acc, category) => {
      acc[category.title] = categoryCounts[category.title] || 0;
      return acc;
    }, {} as Record<string, number>);

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
      // If teacher has no organizationId, return empty result
      if (!teacher.organizationId) {
        return res.status(200).json({ students: [] });
      }
      studentFilters.organizationId = teacher.organizationId;
    } else if (student) {
      // For student: if organizationId is null, filter students with organizationId null,
      // else filter by student's organizationId
      if (!student.organizationId) {
        studentFilters.organizationId = null;
      } else {
        studentFilters.organizationId = student.organizationId;
      }
    }

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
    });

    return res.status(200).json({ students });
  } catch (error) {
    logger.error("Error in appearLeaderboard:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};


const buyWaterSeeder = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user)
      return res.status(401).json({ message: "User not authenticated" });

    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });

    logger.info("buyWaterSeeder request body:", req.body);
    const water = Number(req.body.water) || 0;
    const seeders = Number(req.body.seeders) || 0;

    if (water <= 0 && seeders <= 0) {
      logger.warn("buyWaterSeeder returning 400: Add some seeders or water first", { water, seeders });
      return res.status(400).json({ error: "Add some seeders or water first" });
    }

    // Must match the client's per-unit pricing in Shop.tsx (waterCost/fertilizerCost),
    // which discounts the first tree stage — otherwise the amount charged here
    // silently diverges from what the confirmation popup showed the student.
    const waterCost = student.treeProgress === 1 ? 10 : 20;
    const seederCost = student.treeProgress === 1 ? 15 : 30;
    const totalRed = waterCost * water + seederCost * seeders;
    const totalBlue = totalRed;
    const totalYellow = totalRed;

    logger.info("buyWaterSeeder balance check:", { 
      studentBalances: {
        snabelRed: student.snabelRed,
        snabelBlue: student.snabelBlue,
        snabelYellow: student.snabelYellow
      },
      requiredBalances: {
        totalRed,
        totalBlue,
        totalYellow
      }
    });

    if (
      student.snabelRed < totalRed ||
      student.snabelBlue < totalBlue ||
      student.snabelYellow < totalYellow
    ) {
      logger.warn("buyWaterSeeder returning 400: Insufficient snabel balance");
      return res.status(400).json({ error: "Insufficient snabel balance" });
    }

    // update the challagange of water
    if (water) {
      const water_challanges = await StudentChallenge.findAll({
        where: { studentId: student.id },
        include: [
          { model: Challenge, as: "challenge", where: { Category: "water" } },
        ],
      });
      if (water_challanges.length === 0) {
        return res.status(404).json({ message: "No water challenge found" });
      }

      for (const water_challange of water_challanges) {
        if (water_challange.completionStatus === "NotCompleted") {
          await water_challange.update({
            pointOfStudent: water_challange.pointOfStudent + water,
          });
          if (
            water_challange.challenge &&
            water_challange.pointOfStudent + water >=
              water_challange.challenge.point
          ) {
            await water_challange.update({ completionStatus: "Completed" });
            await student.update({
              water: student.water + water_challange.challenge.water,
            });
          }
          await student.save();
          await water_challange.save(); // Save updates
        }
      }
    }
    if (seeders) {
      const seeder_challanges = await StudentChallenge.findAll({
        where: { studentId: student.id },
        include: [
          { model: Challenge, as: "challenge", where: { Category: "seeder" } },
        ],
      });
      if (seeder_challanges.length === 0) {
        return res.status(404).json({ message: "No water challenge found" });
      }

      for (const seeder_challange of seeder_challanges) {
        if (seeder_challange.completionStatus === "NotCompleted") {
          await seeder_challange.update({
            pointOfStudent: seeder_challange.pointOfStudent + seeders,
          });
          if (
            seeder_challange.challenge &&
            seeder_challange.pointOfStudent + seeders >=
              seeder_challange.challenge.point
          ) {
            await seeder_challange.update({ completionStatus: "Completed" });
            await student.update({
              seeders: student.seeders + seeder_challange.challenge.seeder,
            });
          }
          await seeder_challange.save(); // Save updates
          await student.save();
        }
      }
    }
    student.snabelRed -= totalRed;
    student.snabelBlue -= totalBlue;
    student.snabelYellow -= totalYellow;

    student.water += water;
    student.seeders += seeders;

    await student.save(); // Save updates

    res.json({ message: "Updated successfully", student });
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

    // Fetch student and current tree level in parallel
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student)
      return res
        .status(404)
        .json({ message: "Student data not found in request" });

    const [treeLevel, maxTreeLevel] = await Promise.all([
      Tree.findByPk(student.treeProgress),
      Tree.max("id") as Promise<number>, // Explicitly tell TypeScript it's a number
    ]);

    if (!treeLevel)
      return res.status(404).json({ message: "Tree data not found" });
    if (student.treeProgress >= maxTreeLevel)
      return res
        .status(400)
        .json({ message: "You have reached the maximum tree level!" });

    if (student.seeders < treeLevel.seeders || student.water < treeLevel.water)
      return res
        .status(400)
        .json({ message: "Not enough seeders or water to grow the tree" });

    // Deduct resources and update progress
    Object.assign(student, {
      seeders: student.seeders - treeLevel.seeders,
      water: student.water - treeLevel.water,
      treeProgress: student.treeProgress + 1,
    });

    // Fetch all student challenges
    const studentChallenges = await StudentChallenge.findAll({
      where: { studentId: student.id },
      include: [{ model: Challenge, as: "challenge" }],
    });

    const treeLevelChallenges = studentChallenges.filter(
      (ch) => ch.challenge?.category === "treelevel"
    );
    const treeStageChallenges = studentChallenges.filter(
      (ch) => ch.challenge?.category === "treestage"
    );

    // Process tree level challenges
    const challengeUpdates = treeLevelChallenges.map(async (treeChallenge) => {
      if (treeChallenge.completionStatus === "NotCompleted") {
        const newPoints = treeChallenge.pointOfStudent + 1;
        await treeChallenge.update({ pointOfStudent: newPoints });

        if (
          treeChallenge.challenge &&
          newPoints >= treeChallenge.challenge.point
        ) {
          await treeChallenge.update({ completionStatus: "Completed" });
          student.snabelRed += treeChallenge.challenge.snabelRed;
          student.snabelBlue += treeChallenge.challenge.snabelBlue;
          student.snabelYellow += treeChallenge.challenge.snabelYellow;
          student.xp += treeChallenge.challenge.xp;
        }
      }
    });

    // Fetch next tree level only if needed
    if (student.treeProgress <= maxTreeLevel) {
      const treeLevelForChallenge = await Tree.findByPk(student.treeProgress);
      if (!treeLevelForChallenge)
        return res.status(404).json({ message: "Tree data not found" });

      // Process tree stage challenges
      treeStageChallenges.forEach(async (treeChallenge) => {
        if (treeChallenge.completionStatus === "NotCompleted") {
          await treeChallenge.update({
            pointOfStudent: treeLevelForChallenge.stage,
          });

          if (
            treeChallenge.challenge &&
            treeLevelForChallenge.stage === treeChallenge.challenge.point
          ) {
            await treeChallenge.update({ completionStatus: "Completed" });
            student.snabelRed += treeChallenge.challenge.snabelRed;
            student.snabelBlue += treeChallenge.challenge.snabelBlue;
            student.snabelYellow += treeChallenge.challenge.snabelYellow;
            student.xp += treeChallenge.challenge.xp;
          }
        }
      });
    }

    // Execute updates in parallel
    await Promise.all(challengeUpdates);
    await student.save();

    return res
      .status(200)
      .json({ message: "Tree successfully grown!", student });
  } catch (error) {
    logger.error("Error in growing the tree:", { error });
    return res.status(500).json({ error: "Internal Server Error" });
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

  try {
    for (const sheet in processedData) {
      const all_data = processedData[sheet];
      for (const data of all_data) {
        try {
          // ✅ Find Organization
          const organization = await Organization.findOne({
            where: { name: data.OrganizationName },
          });
          if (!organization) {
            failedEntries.push({
              row: data,
              error: "School not found in request",
            });
            continue;
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

          // ✅ Find Class
          const gradeName = String(data.Grade || "").trim().toLowerCase();
          const gradeRecord = await Grade.findOne({ where: { name: gradeName } });

          const class_data = await Class.findOne({
            where: {
              organizationId: organization.id,
              classname: data.ClassName,
              ...(gradeRecord ? { gradeId: gradeRecord.id } : { grade: data.Grade }),
            },
          });
          if (!class_data) {
            failedEntries.push({
              row: data,
              error: "Class not found in request",
            });
            continue;
          }

          // ✅ Check if Email Already Exists
          const email = data.Email;
          if (await User.findOne({ where: { email: email } })) {
            failedEntries.push({ row: data, error: "Email is already in use" });
            continue;
          }

          // ✅ Create User & Student
          const password = generatePassword();
          const hashedPassword = bcrypt.hashSync(password, 10);
          worksheet.addRow({ email, password });

          const new_user = await User.create({
            firstName: data.FirstName,
            lastName: data.LastName,
            email,
            role: "Student",
            password: hashedPassword,
            dateOfBirth: data.DateOfBirth,
            gender: data.Gender,
            isAccess: true,
          });
          const connectCode = await generateUniqueConnectCode();
          const new_student = await Student.create({
            connectCode,
            treeProgress: 1,
            gradeId: gradeRecord ? gradeRecord.id : null,
            grade: data.Grade,
            userId: new_user.id,
            organizationId: organization.id,
            classId: class_data.id,
          });

          // ✅ Send Email with Credentials
          await sendEmail({
            to: email,
            subject: "Your account in Snabel elahssan",
            text: `Your email code is ${email}, and your password is ${password}`,
          });

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
          });
        } catch (error) {
          failedEntries.push({ row: data, error: error });
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


const addPros = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });

    let { taskId, time } = req.body;
    logger.info("student addPros request:", req.body);
    if (typeof taskId !== "number") {
      return res.status(400).json({ message: "Invalid taskId parameter" });
    }

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

    const existingRecord = await StudentTask.findOne({
      where: {
        studentId: student.id,
        taskId,
        createdAt: {
          [Op.gte]: new Date().setHours(0, 0, 0, 0),
          [Op.lt]: new Date().setHours(23, 59, 59, 999),
        },
      },
    });

    if (existingRecord) {
      return res.status(400).json({ message: "Task already completed today" });
    }

    const task = await Task.findOne({
      where: { id: taskId },
      include: [{ model: TaskCategory, as: "taskCategory" }],
    });

    if (!task) return res.status(404).json({ message: "Task not found" });

    const challenges = await Challenge.findAll({
      where: {
        [Op.or]: [
          { category: { [Op.in]: ["snabelBlue", "snabelRed", "snabelMixed", "snabelYellow", "xp", "alltask", "task", "tasktype"] } },
          { taskCategory: task.taskCategory?.title || "" },
          { tasktype: task.type || "" },
        ],
      } as any,
    });

    const studentChallenges = await StudentChallenge.findAll({
      where: {
        studentId: student.id,
        challengeId: challenges.map((c) => c.id),
        completionStatus: "NotCompleted",
      },
      include: [{ model: Challenge, as: "challenge" }],
    });

    await Student.sequelize.transaction(async (t) => {
      // Create student task record
      await StudentTask.create(
        {
          studentId: student.id,
          taskId,
          completionStatus: "Completed",
          date: today.toISOString().split("T")[0],
          createdAt: today,
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
        }

        // Mark challenge as completed if threshold is met
        if (studentChallenge.pointOfStudent >= challenge.point) {
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
    });

    logger.info("Task recorded successfully for student:", { studentId: student.id, taskId });
    return res.status(201).json({ message: "Task recorded successfully", student });
  } catch (error) {
    logger.error("Error in student addPros:", { error, taskId: req.body.taskId });
    return res.status(500).json({ error: "Internal Server Error" });
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
