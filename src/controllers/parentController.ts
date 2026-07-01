import { Request, Response } from "express";
import logger from "../config/logger";

import { JwtPayload } from "jsonwebtoken";

import User from "../models/user.model";
import { Op, fn, col, literal } from "sequelize";
import { Sequelize, QueryTypes, where } from "sequelize";

import TaskCategory from "../models/task-category.model";
import Parent from "../models/parent.model";
import Student from "../models/student.model";
import StudentTask from "../models/student-task.model";
import Task from "../models/task.model";
import Challenge from "../models/challenge.model";
import Class from "../models/class.model"
import Organization from "../models/oraganization.model";
import StudentChallenge, { CompletionStatus } from "../models/student-challenge.model";

const parentData = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  try {
    const parent = await Parent.findOne({
      where: { userId: user.id },
      include: [{
        model: User,
        as: "user", // use the alias defined in the association
      },
      
    ]
     
    });
    if (!parent) {
      return res.status(404).json({ message: "User or Student not found" });
    } else {

      res.status(200).json({ data: parent });
    }
  } catch (error) {
    logger.error("Error fetching parent data:", { error });
    res.status(500).json({ message: "Error fetching parent data" });
  }
};


const updateDataTeacherParent = async (req: Request, res: Response) => {
try {
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
} catch (error) {
    logger.error("Error updating parent/user data:", { error });
    res.status(500).json({ message: "Error updating data" });
    
}
};



const deleteData = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  const parent = await Parent.findOne({ where: { userId: user.id } });
  const userRecord = await User.findOne({ where: { id: user.id } });
  if (!parent || !userRecord) {
    return res.status(404).json({ message: "User or Student not found" });
  }


  // Delete student first, then delete user
  await parent.destroy();
  await userRecord.destroy();


  res
    .status(200)
    .json({ message: "User and Student data deleted successfully" });
  } catch (error) {
    logger.error("Error deleting parent data:", { error });
    res.status(500).json({ message: "Error deleting parent data" });
  }
};


const searchStuentByCode = async (req: Request, res: Response) => {
    try {
        const user = (req as Request & { user: JwtPayload | undefined }).user;

        if (!user) {
          return res.status(404).json({ message: "User data not found in request" });
        }
        const parent = await Parent.findOne({ where: { userId: user.id } });
        if (!parent) {
            return res.status(404).json({ message: "Parent not found" });
        }

        const { code } = req.params;
        const student = await Student.findOne({
            where: {connectCode: code },
            include:[{
                model:User,
                as:"user",
                attributes: ["firstName", "lastName","profileImg","gender","dateOfBirth"]
            }]
        }
        
    );
        return res.status(200).json({ data: student });
    } catch (error) {
        logger.error("Error searching student by code (parent):", { error });
        res.status(500).json({ message: "Error fetching student data" });
        
    }
}

const connectStudentToParent = async (req: Request, res: Response) => {
    try {
        const user = (req as Request & { user: JwtPayload | undefined }).user;

        if (!user) {
          return res.status(404).json({ message: "User data not found in request" });
        }
        const parent = await Parent.findOne({ where: { userId: user.id } });
        if (!parent) {
            return res.status(404).json({ message: "Parent not found" });
        }

        const { code } = req.body;
        const student = await Student.findOne({
            where: {connectCode: code },
            include:[{
                model:User,
                as:"user",
                attributes: ["firstName", "lastName","profileImg","gender","dateOfBirth"]
            }]
        });
        if (!student) {
            return res.status(404).json({ message: "Student not found" });
        }
        await student.update({ ParentId: parent.id });
         
        return res.status(200).json({ message: "Student connected to parent successfully" });
    } catch (error) {
        logger.error("Error connecting student to parent:", { error });
        res.status(500).json({ message: "Error connecting student" });
        
    }
}

const appearStudentbyparent = async (req: Request, res: Response) => {
    try {
        const user = (req as Request & { user: JwtPayload | undefined }).user;

        if (!user) {
          return res.status(404).json({ message: "User data not found in request" });
        }
        const parent = await Parent.findOne({ where: { userId: user.id } });
        if (!parent) {
            return res.status(404).json({ message: "Parent not found" });
        }
        const student = await Student.findAll({
            where: {parentId: parent.id },
            include: [{
              model: User,
              as: "user", // use the alias defined in the association
              attributes: ["firstName", "lastName", "email","profileImg","gender","dateOfBirth"],
            },
            {model: Class,
              as: "class",
              attributes: ["id", "classname",'category'],
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
        if (!student) {
            return res.status(404).json({ message: "Student not found" });
        }

        return res.status(200).json({ data: student });
    } catch (error) {
        logger.error("Error in appearStudentbyparent:", { error });
        res.status(500).json({ message: "Error fetching student data" });
        
    }
}

const addPros = async (req: Request, res: Response) => {
    try {
        // Extract user data from request
        const user = (req as Request & { user?: { id: number } }).user;
        if (!user) return res.status(404).json({ message: "User data not found in request" });
    
        // Find the parent linked to the user
        const parent = await Parent.findOne({ where: { userId: user.id } });
        if (!parent) return res.status(404).json({ message: "Parent data not found in request" });
    
        // Extract request data
        let { taskId, studentIds, comment = "", time } = req.body;
        logger.info("parent addPros request:", req.body);
    
        // Validate taskId
        if (typeof taskId !== "number") {
          return res.status(400).json({ message: "Invalid taskId parameter" });
        }
    
        // Ensure studentIds is an array of numbers
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
    
        // Fetch students from the database
        const students = await Student.findAll({
          where: { id: { [Op.in]: studentIds } },
        });
    
        // Extract found student IDs
        const foundStudentIds = students.map((student) => student.id);
    
        // Check if all provided student IDs exist
        const missingStudents = studentIds.filter((id: number) => !foundStudentIds.includes(id));
        if (missingStudents.length > 0) {
          return res.status(404).json({
            message: "Some students were not found",
            missingStudents,
          });
        }
    
        // Ensure all students belong to the requesting parent
        const invalidStudents = students.filter((student) => student.ParentId !== parent.id);
        if (invalidStudents.length > 0) {
          return res.status(403).json({
            message: "Some students do not belong to the requesting parent",
            invalidStudentIds: invalidStudents.map((student) => student.id),
          });
        }
    
        // Check if students have already completed the task today
        const existingRecords = await StudentTask.findAll({
          where: {
            studentId: { [Op.in]: studentIds },
            taskId,
            createdAt: {
              [Op.gte]: new Date().setHours(0, 0, 0, 0), // Start of today
              [Op.lt]: new Date().setHours(23, 59, 59, 999), // End of today
            },
          },
          attributes: ["studentId"],
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
              { category: { [Op.in]: ["snabelBlue", "snabelRed", "snabelMixed", "snabelYellow", "xp", "alltask", "task"] } },
              { taskCategory: task.taskCategory?.title || "" },
            ],
          } as any, // Explicit cast to fix TypeScript errors
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
          // Process each student
          for (const studentId of newStudentIds) {
            // Create student task record
            await StudentTask.create(
              {
                studentId,
                taskId,
                completionStatus: CompletionStatus.Completed,
                comment,
                createdAt: today,
                parentId: parent.id,
                date: today.toISOString().split("T")[0],
              },
              { transaction: t }
            );

            // Fetch student record
            const student = students.find((s) => s.id === studentId);
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
              } else if (challenge.taskCategory === task.taskCategory?.title || challenge.category === "alltask") {
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
    
        logger.info("Task recorded successfully for students by parent:", { studentIds: newStudentIds, parentId: parent.id });
        return res.status(201).json({ message: "Student tasks recorded successfully" });
      } catch (error) {
        logger.error("Error in addPros (parent):", { error });
        return res.status(500).json({ error: "Internal Server Error" });
      }
    };


    const appearStudentInDetails = async (req: Request, res: Response) => {
      try {
        // Extract user data
        const user = (req as Request & { user: JwtPayload | undefined }).user;
        if (!user) return res.status(404).json({ message: "User data not found in request" });
    
        const parent = await Parent.findOne({ where: { userId: user.id } });
        if (!parent) return res.status(404).json({ message: "parent data not found in request" });
        
        const studentId = Number(req.params.studentId);
        if (!studentId) return res.status(400).json({ message: "Student ID is required" });
        const student = await Student.findOne({
          where: { id: studentId},
        
          include: [{
            model: User,
            as: "user", // use the alias defined in the association
            attributes: ["firstName", "lastName", "email","profileImg","gender","dateOfBirth"],
          },
          {model: Class,
            as: "class",
            attributes: ["id", "classname",'category'],
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
        logger.error("Error in appearStudentInDetails (parent):", { error });
        return res.status(500).json({ message: "Internal server error" });
      }
    }

    const parentLeaderboard = async (req: Request, res: Response) => {
      try {
        const user = (req as Request & { user?: JwtPayload }).user;
        if (!user) return res.status(401).json({ message: "Unauthorized" });
    
        const parent = await Parent.findOne({ where: { userId: user.id } });
        if (!parent) {
          return res.status(403).json({ message: "Access denied. Only for parents." });
        }
    
        const { gender } = req.query;
    
        const userFilters: any = {};
        if (gender) {
          if (typeof gender !== "string" || !["Male", "Female"].includes(gender)) {
            return res.status(400).json({ message: "Invalid gender filter" });
          }
          userFilters.gender = gender;
        }
    
        const students = await Student.findAll({
          where: {
            organizationId: null, 
          },
          include: [
            {
              model: User,
              as: "user",
              where: userFilters,
              attributes: ["firstName", "lastName", "email", "profileImg", "gender"],
            },
          ],
          order: [["xp", "DESC"]],
        });
    
        return res.status(200).json({ students });
      } catch (error) {
        logger.error("Error in parentLeaderboard:", { error });
        return res.status(500).json({ message: "Internal Server Error" });
      }
    };

    
    
export { parentData, updateDataTeacherParent, deleteData, searchStuentByCode, connectStudentToParent, appearStudentbyparent, addPros,parentLeaderboard,appearStudentInDetails };
