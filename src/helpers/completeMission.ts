import { Op } from "sequelize";
import Student from "../models/student.model";
import StudentTask from "../models/student-task.model";
import Task from "../models/task.model";
import TaskCategory from "../models/task-category.model";
import Challenge from "../models/challenge.model";
import StudentChallenge from "../models/student-challenge.model";
import logger from "../config/logger";

interface CompleteMissionParams {
  studentId: number;
  taskId: number;
  missionDate: string; // yyyy-mm-dd — the day the mission was actually done
  approverId?: number | null;
  approverType?: "parent" | "teacher" | null;
  transaction: any;
}

// Shared reward-granting logic used whenever a mission actually gets marked
// complete for a student — today that's only the approval-grant path, but it
// mirrors the same StudentTask + xp/snabel + challenge-cascade shape used by
// the pre-existing (untouched) student/teacher/parent addPros endpoints, so
// "recent activity", leaderboards, etc. all see approval-driven completions
// exactly like any other completion.
export async function completeMissionForStudent({
  studentId,
  taskId,
  missionDate,
  approverId = null,
  approverType = null,
  transaction,
}: CompleteMissionParams) {
  const student = await Student.findByPk(studentId, { transaction });
  if (!student) throw new Error("Student not found");

  const task = await Task.findOne({
    where: { id: taskId },
    include: [{ model: TaskCategory, as: "taskCategory" }],
    transaction,
  });
  if (!task) throw new Error("Task not found");

  await StudentTask.create(
    {
      studentId,
      taskId,
      completionStatus: "Completed",
      date: missionDate,
      parentId: approverType === "parent" ? approverId : null,
      teacherId: approverType === "teacher" ? approverId : null,
    },
    { transaction }
  );

  student.xp = (student.xp || 0) + (task.xp || 0);
  student.snabelRed = (student.snabelRed || 0) + (task.snabelRed || 0);
  student.snabelBlue = (student.snabelBlue || 0) + (task.snabelBlue || 0);
  student.snabelYellow = (student.snabelYellow || 0) + (task.snabelYellow || 0);
  await student.save({ transaction });

  const challenges = await Challenge.findAll({
    where: {
      [Op.or]: [
        { category: { [Op.in]: ["snabelBlue", "snabelRed", "snabelMixed", "snabelYellow", "xp", "alltask", "task", "tasktype"] } },
        { taskCategory: task.taskCategory?.title || "" },
        { tasktype: task.type || "" },
      ],
    } as any,
    transaction,
  });

  const studentChallenges = await StudentChallenge.findAll({
    where: {
      studentId,
      challengeId: challenges.map((c) => c.id),
      completionStatus: "NotCompleted",
    },
    include: [{ model: Challenge, as: "challenge" }],
    transaction,
  });

  for (const studentChallenge of studentChallenges) {
    const challenge = studentChallenge.challenge;

    if (challenge.category === "xp") studentChallenge.pointOfStudent += task.xp || 0;
    else if (challenge.category === "snabelBlue") studentChallenge.pointOfStudent += task.snabelBlue || 0;
    else if (challenge.category === "snabelRed") studentChallenge.pointOfStudent += task.snabelRed || 0;
    else if (challenge.category === "snabelYellow") studentChallenge.pointOfStudent += task.snabelYellow || 0;
    else if (challenge.category === "snabelMixed") {
      studentChallenge.pointOfStudent += (task.snabelBlue || 0) + (task.snabelRed || 0) + (task.snabelYellow || 0);
    } else if (challenge.taskCategory === task.taskCategory?.title || challenge.category === "alltask") {
      studentChallenge.pointOfStudent += 1;
    }

    if (studentChallenge.pointOfStudent >= challenge.point) {
      studentChallenge.completionStatus = "Completed" as any;
      student.xp = (student.xp || 0) + (challenge.xp || 0);
      student.snabelRed = (student.snabelRed || 0) + (challenge.snabelRed || 0);
      student.snabelBlue = (student.snabelBlue || 0) + (challenge.snabelBlue || 0);
      student.snabelYellow = (student.snabelYellow || 0) + (challenge.snabelYellow || 0);
      student.water = (student.water || 0) + (challenge.water || 0);
      student.seeders = (student.seeders || 0) + (challenge.seeder || 0);
      await student.save({ transaction });
    }
    await studentChallenge.save({ transaction });
  }

  logger.info("Mission completed via approval:", { studentId, taskId, missionDate, approverId, approverType });
  return student;
}
