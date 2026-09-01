import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Task from "../models/task.model";
import Class from "../models/class.model";
import User from "../models/user.model";
import StudentTodoItem, { TodoItemStatus } from "../models/student-todo-item.model";
import StudentTodoSource from "../models/student-todo-source.model";
import MissionApprovalRequest from "../models/mission-approval-request.model";
import { addOrAssignTodo, utcGameplayDate } from "../services/studentTodoService";
import logger from "../config/logger";

const principal = (req: Request) => (req as Request & { user?: JwtPayload }).user;

export const listMyTodo = async (req: Request, res: Response) => {
  try {
    const user = principal(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });
    if (!student.classId) return res.status(400).json({ message: "Solo User missions use the personal To-Do" });
    const items = await StudentTodoItem.findAll({
      where: { studentId: student.id },
      include: [
        { model: Task, as: "Task" },
        { model: StudentTodoSource, as: "Sources" },
        { model: MissionApprovalRequest, as: "ApprovalRequests", required: false },
      ],
      order: [["createdAt", "DESC"]],
    });
    return res.status(200).json({ data: await serializeTodoItems(items) });
  } catch (error) {
    logger.error("Error listing student To-Do", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const addMyTodo = async (req: Request, res: Response) => {
  try {
    const user = principal(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const taskId = Number(req.body.taskId);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return res.status(400).json({ message: "Invalid taskId parameter" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });
    if (!student.classId) return res.status(400).json({ message: "Solo User missions use the personal To-Do" });
    if (!(await Task.findByPk(taskId))) return res.status(404).json({ message: "Task not found" });
    const result = await Student.sequelize.transaction(async (transaction: any) => {
      await Student.findOne({ where: { id: student.id }, transaction, lock: transaction?.LOCK?.UPDATE });
      return addOrAssignTodo({ studentId: student.id, taskId, sourceType: "student", sourceId: student.id, transaction });
    });
    return res.status(result.status === "created" ? 201 : 200).json({ data: result.todo, ...result });
  } catch (error) {
    logger.error("Error adding student To-Do", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const removeMyTodo = async (req: Request, res: Response) => {
  try {
    const user = principal(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });
    const todo = await StudentTodoItem.findOne({ where: { id: Number(req.params.id), studentId: student.id } });
    if (!todo) return res.status(404).json({ message: "To-Do item not found" });
    if (todo.status !== TodoItemStatus.Todo) return res.status(409).json({ message: "Only an active To-Do item can be removed" });
    const sources = await StudentTodoSource.findAll({ where: { todoItemId: todo.id } });
    if (sources.some((source) => source.sourceType !== "student")) {
      return res.status(403).json({ message: "An assigned mission cannot be removed by the Student" });
    }
    await Student.sequelize.transaction(async (transaction: any) => {
      await StudentTodoSource.destroy({ where: { todoItemId: todo.id }, transaction });
      await todo.destroy({ transaction });
    });
    return res.status(200).json({ message: "To-Do item removed" });
  } catch (error) {
    logger.error("Error removing student To-Do", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const assignTodoAsTeacher = async (req: Request, res: Response) => {
  const user = principal(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const teacher = await Teacher.findOne({ where: { userId: user.id } });
  if (!teacher) return res.status(404).json({ message: "Teacher not found" });
  return runAssignmentBatch(req, res, "teacher", teacher.id, async (student) => {
    if (!student.classId || !teacher.organizationId || student.organizationId !== teacher.organizationId) return false;
    return !!(await Class.findOne({ where: { id: student.classId, teacherId: teacher.id, organizationId: teacher.organizationId } }));
  });
};

export const assignTodoAsParent = async (req: Request, res: Response) => {
  const user = principal(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const parent = await Parent.findOne({ where: { userId: user.id } });
  if (!parent) return res.status(404).json({ message: "Parent not found" });
  return runAssignmentBatch(req, res, "parent", parent.id, async (student) => student.ParentId === parent.id);
};

async function runAssignmentBatch(
  req: Request, res: Response, sourceType: "teacher" | "parent", sourceId: number,
  authorize: (student: Student) => Promise<boolean>,
) {
  const taskId = Number(req.body.taskId);
  const studentIds: number[] = Array.isArray(req.body.studentIds)
    ? [...new Set<number>(req.body.studentIds.map((value: unknown) => Number(value)))]
    : [Number(req.body.studentIds)];
  if (!Number.isSafeInteger(taskId) || taskId <= 0 || studentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ message: "Invalid taskId or studentIds parameter" });
  }
  if (!(await Task.findByPk(taskId))) return res.status(404).json({ message: "Task not found" });
  const results: any[] = [];
  for (const studentId of studentIds) {
    try {
      const student = await Student.findByPk(studentId);
      if (!student) { results.push({ studentId, status: "not_found" }); continue; }
      if (!(await authorize(student))) { results.push({ studentId, status: "unauthorized" }); continue; }
      const result = await Student.sequelize.transaction(async (transaction: any) => {
        const locked = await Student.findByPk(studentId, { transaction, lock: transaction?.LOCK?.UPDATE });
        if (!locked) throw new Error("Student not found");
        return addOrAssignTodo({ studentId, taskId, sourceType, sourceId, transaction });
      });
      results.push({ studentId, status: result.status, alreadyCompletedToday: result.alreadyCompletedToday, rewardsGranted: false });
    } catch (error: any) {
      results.push({ studentId, status: "failed", error: error?.message || "Failed to assign mission" });
    }
  }
  return res.status(200).json({ message: "Mission assignment processed", summary: summarize(results), results });
}

const summarize = (results: any[]) => results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {} as Record<string, number>);

async function serializeTodoItems(items: StudentTodoItem[]) {
  const json = items.map((item: any) => item.toJSON());
  const sources = json.flatMap((item: any) => item.Sources || []);
  const ids = (type: string) => {
    const sourceIds = sources.filter((source: any) => source.sourceType === type).map((source: any) => source.sourceId);
    const completerIds = json.filter((item: any) => item.completedById && String(item.completionSource || "").includes(type))
      .map((item: any) => item.completedById);
    return [...new Set([...sourceIds, ...completerIds])];
  };
  const [students, teachers, parents] = await Promise.all([
    Student.findAll({ where: { id: ids("student") }, include: [{ model: User, as: "user", attributes: ["firstName", "lastName"] }] }),
    Teacher.findAll({ where: { id: ids("teacher") }, include: [{ model: User, as: "user", attributes: ["firstName", "lastName"] }] }),
    Parent.findAll({ where: { id: ids("parent") }, include: [{ model: User, as: "user", attributes: ["firstName", "lastName"] }] }),
  ]);
  const names = new Map<string, string>();
  for (const [type, rows] of [["student", students], ["teacher", teachers], ["parent", parents]] as const) {
    for (const row of rows as any[]) names.set(`${type}:${row.id}`, `${row.user?.firstName || ""} ${row.user?.lastName || ""}`.trim());
  }
  return json.map((item: any) => {
    const completionActorType = String(item.completionSource || "").includes("teacher") ? "teacher"
      : String(item.completionSource || "").includes("parent") ? "parent" : "student";
    return { ...item, completedByName: item.completedById ? names.get(`${completionActorType}:${item.completedById}`) || completionActorType : null,
      Sources: (item.Sources || []).map((source: any) => ({ ...source,
        name: source.sourceType === "student" ? "You" : names.get(`${source.sourceType}:${source.sourceId}`) || source.sourceType,
      })) };
  });
}
