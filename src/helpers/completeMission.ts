import { Op } from "sequelize";
import Student from "../models/student.model";
import StudentTask from "../models/student-task.model";
import Task from "../models/task.model";
import TaskCategory from "../models/task-category.model";
import Challenge from "../models/challenge.model";
import StudentChallenge from "../models/student-challenge.model";
import MissionApprovalRequest, { ApprovalStatus } from "../models/mission-approval-request.model";
import logger from "../config/logger";
import { completionKey, findCompletion, reconcileCompletedTodo } from "../services/studentTodoService";

export type MissionCompletionSource = "solo_self" | "approval_teacher" | "approval_parent" | "teacher_direct" | "parent_direct";

interface CompleteMissionParams {
  studentId: number;
  taskId: number;
  missionDate: string;
  source?: MissionCompletionSource;
  approverId?: number | null;
  approverType?: "parent" | "teacher" | null;
  approvalRequestId?: number | null;
  comment?: string;
  recordedAt?: Date;
  transaction: any;
}

// The only reward writer. Callers authorize the actor, then invoke this in a
// transaction. Locking the Student serializes every completion path for that
// student; completionKey is the final database-level idempotency guard.
export async function completeMissionForStudent({
  studentId, taskId, missionDate, source, approverId = null, approverType = null,
  approvalRequestId = null, comment = "", recordedAt = new Date(), transaction,
}: CompleteMissionParams) {
  const completionSource: MissionCompletionSource = source ||
    (approverType === "teacher" ? "approval_teacher" : approverType === "parent" ? "approval_parent" : "solo_self");
  const student = await Student.findOne({ where: { id: studentId }, transaction, lock: transaction?.LOCK?.UPDATE });
  if (!student) throw new Error("Student not found");

  const existing = await findCompletion(studentId, taskId, missionDate, transaction);
  if (existing) {
    const todo = student.classId ? await reconcileCompletedTodo({ studentId, taskId, date: missionDate, studentTask: existing,
      completionSource: existing.completionSource || completionSource,
      completedById: existing.teacherId || existing.parentId || approverId, transaction }) : null;
    if (student.classId) await reconcilePendingRequests(studentId, taskId, missionDate, approverId, approverType, transaction);
    return { student, studentTask: existing, todo, alreadyCompleted: true, rewardsGranted: false };
  }

  const task = await Task.findOne({ where: { id: taskId }, include: [{ model: TaskCategory, as: "taskCategory" }], transaction });
  if (!task) throw new Error("Task not found");
  const studentTask = await StudentTask.create({
    studentId, taskId, completionStatus: "Completed", date: missionDate, createdAt: recordedAt, comment,
    parentId: approverType === "parent" ? approverId : null,
    teacherId: approverType === "teacher" ? approverId : null,
    completionKey: completionKey(studentId, taskId, missionDate), completionSource,
  }, { transaction });

  student.xp = (student.xp || 0) + (task.xp || 0);
  student.snabelRed = (student.snabelRed || 0) + (task.snabelRed || 0);
  student.snabelBlue = (student.snabelBlue || 0) + (task.snabelBlue || 0);
  student.snabelYellow = (student.snabelYellow || 0) + (task.snabelYellow || 0);

  const challenges = await Challenge.findAll({
    where: { [Op.or]: [
      { category: { [Op.in]: ["snabelBlue", "snabelRed", "snabelMixed", "snabelYellow", "xp", "alltask", "task", "tasktype"] } },
      { taskCategory: task.taskCategory?.title || "" }, { tasktype: task.type || "" },
    ] } as any, transaction,
  });
  const rows = await StudentChallenge.findAll({
    where: { studentId, challengeId: challenges.map((c) => c.id), completionStatus: "NotCompleted" },
    include: [{ model: Challenge, as: "challenge" }], transaction, lock: transaction?.LOCK?.UPDATE,
  });
  for (const row of rows) {
    const challenge = row.challenge;
    if (challenge.category === "xp") row.pointOfStudent += task.xp || 0;
    else if (challenge.category === "snabelBlue") row.pointOfStudent += task.snabelBlue || 0;
    else if (challenge.category === "snabelRed") row.pointOfStudent += task.snabelRed || 0;
    else if (challenge.category === "snabelYellow") row.pointOfStudent += task.snabelYellow || 0;
    else if (challenge.category === "snabelMixed") row.pointOfStudent += (task.snabelBlue || 0) + (task.snabelRed || 0) + (task.snabelYellow || 0);
    else if (challenge.taskCategory === task.taskCategory?.title || challenge.category === "alltask") row.pointOfStudent += 1;
    else if (challenge.tasktype && (challenge.tasktype === task.type || challenge.title === task.type)) row.pointOfStudent += 1;
    if (challenge.point != null && row.pointOfStudent >= challenge.point) {
      row.completionStatus = "Completed" as any;
      student.xp = (student.xp || 0) + (challenge.xp || 0);
      student.snabelRed = (student.snabelRed || 0) + (challenge.snabelRed || 0);
      student.snabelBlue = (student.snabelBlue || 0) + (challenge.snabelBlue || 0);
      student.snabelYellow = (student.snabelYellow || 0) + (challenge.snabelYellow || 0);
      student.water = (student.water || 0) + (challenge.water || 0);
      student.seeders = (student.seeders || 0) + (challenge.seeder || 0);
    }
    await row.save({ transaction });
  }
  await student.save({ transaction });
  const todo = student.classId ? await reconcileCompletedTodo({ studentId, taskId, date: missionDate, studentTask,
    completionSource, completedById: approverId, transaction }) : null;
  if (student.classId) await reconcilePendingRequests(studentId, taskId, missionDate, approverId, approverType, transaction, approvalRequestId);
  logger.info("Mission completion committed", { studentId, taskId, missionDate, completionSource });
  return { student, studentTask, todo, alreadyCompleted: false, rewardsGranted: true };
}

async function reconcilePendingRequests(
  studentId: number, taskId: number, missionDate: string, actorId: number | null,
  actorType: "parent" | "teacher" | null, transaction: any, approvalRequestId: number | null = null,
) {
  await MissionApprovalRequest.update({ status: ApprovalStatus.Approved, approvedById: actorId,
    approvedByType: actorType, approvedAt: new Date() }, {
    where: { studentId, missionId: taskId, missionDate, status: ApprovalStatus.Pending,
      ...(approvalRequestId ? { id: approvalRequestId } : {}) }, transaction,
  });
}
