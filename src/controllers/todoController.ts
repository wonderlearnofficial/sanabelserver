import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { Op } from "sequelize";
import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Task from "../models/task.model";
import Class from "../models/class.model";
import User from "../models/user.model";
import StudentTodoItem, { TodoItemStatus } from "../models/student-todo-item.model";
import StudentTodoSource from "../models/student-todo-source.model";
import MissionApprovalRequest from "../models/mission-approval-request.model";
import StudentTodoDay from "../models/student-todo-day.model";
import { addOrAssignTodo, ensureTodoDay, isCanonicalDate, utcGameplayDate, withDeadlockRetry } from "../services/studentTodoService";
import logger from "../config/logger";

const principal = (req: Request) => (req as Request & { user?: JwtPayload }).user;

export const listMyTodo = async (req: Request, res: Response) => {
  try {
    const user = principal(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });
    if (!student.classId) return res.status(400).json({ message: "Solo User missions use the personal To-Do" });
    const selectedDate = typeof req.query.date === "string" ? req.query.date : utcGameplayDate();
    const serverToday = utcGameplayDate();
    if (!isCanonicalDate(selectedDate)) return res.status(400).json({ message: "Invalid date; use YYYY-MM-DD" });
    if (selectedDate > serverToday) return res.status(400).json({ message: "Future mission dates are not available" });
    const earliestDate = utcGameplayDate((student as any).createdAt);
    if (selectedDate < earliestDate) return res.status(400).json({ message: "Date predates this account" });
    const selectedEnd = new Date(`${selectedDate}T23:59:59.999Z`);
    const memberships = await StudentTodoItem.findAll({
      // Active membership is eligible today. A removed membership is eligible
      // only for dates before its removal. Inactive migration-only legacy rows
      // have removedAt=NULL and must never materialize duplicate occurrences.
      where: { studentId: student.id, createdAt: { [Op.lte]: selectedEnd }, [Op.or]: [{ isActive: true }, { removedAt: { [Op.gt]: selectedEnd } }] } as any,
      include: [
        { model: Task, as: "Task" },
        { model: StudentTodoSource, as: "Sources", required: true },
      ],
      order: [[Student.sequelize.literal("`StudentTodoItem`.`position` IS NULL"), "ASC"], ["position", "ASC"], ["createdAt", "DESC"]],
    });
    await withDeadlockRetry(() => Student.sequelize.transaction(async (transaction: any) => {
      for (const membership of memberships) await ensureTodoDay(membership, selectedDate, transaction);
    }));
    const days = await StudentTodoDay.findAll({
      where: { studentId: student.id, missionDate: selectedDate },
      include: [{ model: StudentTodoItem, as: "TodoItem", required: true, include: [
        { model: Task, as: "Task" }, { model: StudentTodoSource, as: "Sources" },
      ] }, { model: MissionApprovalRequest, as: "ApprovalRequests", required: false }],
      order: [[Student.sequelize.literal("`TodoItem`.`position` IS NULL"), "ASC"], [{ model: StudentTodoItem, as: "TodoItem" }, "position", "ASC"]],
    });
    const items = await serializeTodoDays(days);
    const counts = items.reduce((result: any, item: any) => { result.total += 1; result[item.status] += 1; return result; },
      { total: 0, todo: 0, pending_approval: 0, completed: 0 });
    const historicalPendingCount = await StudentTodoDay.count({ where: { studentId: student.id, status: TodoItemStatus.PendingApproval, missionDate: { [Op.lt]: serverToday } } });
    const oldestPending = await StudentTodoDay.findOne({ where: { studentId: student.id, status: TodoItemStatus.PendingApproval, missionDate: { [Op.lt]: serverToday } }, order: [["missionDate", "ASC"]] });
    return res.status(200).json({ data: { selectedDate, serverToday, isToday: selectedDate === serverToday,
      earliestDate, items, counts, historicalPendingCount,
      oldestHistoricalPendingDate: oldestPending?.missionDate || null } });
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
    const result = await withDeadlockRetry(() => Student.sequelize.transaction(async (transaction: any) => {
      await Student.findOne({ where: { id: student.id }, transaction, lock: transaction?.LOCK?.UPDATE });
      return addOrAssignTodo({ studentId: student.id, taskId, sourceType: "student", sourceId: student.id, transaction });
    }));
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
    if (!todo.isActive) return res.status(409).json({ message: "Only an active To-Do item can be removed" });
    const sources = await StudentTodoSource.findAll({ where: { todoItemId: todo.id } });
    if (sources.some((source) => source.sourceType !== "student")) {
      return res.status(403).json({ message: "An assigned mission cannot be removed by the Student" });
    }
    await Student.sequelize.transaction(async (transaction: any) => {
      const today = await ensureTodoDay(todo, utcGameplayDate(), transaction);
      if (today.status !== TodoItemStatus.Todo) throw Object.assign(new Error("Only today's open item can be removed"), { status: 409 });
      await todo.update({ isActive: false, activeKey: null, removedAt: new Date() }, { transaction });
    });
    return res.status(200).json({ message: "To-Do item removed" });
  } catch (error) {
    logger.error("Error removing student To-Do", { error });
    const status = Number((error as any)?.status) || 500;
    return res.status(status).json({ message: status === 409 ? (error as any).message : "Internal Server Error" });
  }
};

// PATCH /mission/todo/reorder — persist the student's manual order.
// Reordering changes nothing but `position`: no rewards, no status change,
// no source mutation, and repeating the same payload is a no-op.
export const reorderMyTodo = async (req: Request, res: Response) => {
  try {
    const user = principal(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });

    const items: Array<{ id: number; position: number }> = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0 || items.length > 200) {
      return res.status(400).json({ message: "Invalid items payload" });
    }
    const ids = items.map((item) => Number(item?.id));
    const positions = items.map((item) => Number(item?.position));
    if (
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      positions.some((position) => !Number.isSafeInteger(position) || position < 0 || position > 100000) ||
      new Set(ids).size !== ids.length
    ) {
      return res.status(400).json({ message: "Invalid items payload" });
    }

    // Ownership and state are checked from the database, never trusted from
    // the client: every id must be this student's own actionable item.
    const rows = await StudentTodoItem.findAll({ where: { id: ids, studentId: student.id } });
    if (rows.length !== ids.length) {
      return res.status(403).json({ message: "One or more items do not belong to your To-Do list" });
    }
    if (rows.some((row) => row.isActive === false || (row.isActive == null && row.status === TodoItemStatus.Completed))) {
      return res.status(409).json({ message: "Inactive missions cannot be reordered" });
    }

    await Student.sequelize.transaction(async (transaction: any) => {
      for (const item of items) {
        await StudentTodoItem.update(
          { position: Number(item.position) },
          { where: { id: Number(item.id), studentId: student.id }, transaction },
        );
      }
    });
    return res.status(200).json({ message: "Order saved" });
  } catch (error) {
    logger.error("Error reordering student To-Do", { error });
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
      const result = await withDeadlockRetry(() => Student.sequelize.transaction(async (transaction: any) => {
        const locked = await Student.findByPk(studentId, { transaction, lock: transaction?.LOCK?.UPDATE });
        if (!locked) throw new Error("Student not found");
        return addOrAssignTodo({ studentId, taskId, sourceType, sourceId, transaction });
      }));
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

async function serializeTodoDays(days: StudentTodoDay[]) {
  const json = days.map((day: any) => {
    const value = day.toJSON();
    return { ...value.TodoItem, ...value, id: value.TodoItem.id, dayId: value.id, Task: value.TodoItem.Task,
      Sources: value.TodoItem.Sources, ApprovalRequests: value.ApprovalRequests, TodoItem: undefined };
  });
  const sources = json.flatMap((item: any) => item.Sources || []);
  const pendingRequests = json.flatMap((item: any) =>
    (item.ApprovalRequests || []).filter((request: any) => request.status === "pending"));
  const ids = (type: string) => {
    const sourceIds = sources.filter((source: any) => source.sourceType === type).map((source: any) => source.sourceId);
    const completerIds = json.filter((item: any) => item.completedById && String(item.completionSource || "").includes(type))
      .map((item: any) => item.completedById);
    // A pending request's current targets, so the card can say who the
    // student is waiting for by name.
    const requestTargets = pendingRequests.flatMap((request: any) =>
      (type === "teacher" ? request.teacherIds : type === "parent" ? request.parentIds : []) || []);
    return [...new Set([...sourceIds, ...completerIds, ...requestTargets])];
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
      })),
      ApprovalRequests: (item.ApprovalRequests || []).map((request: any) => ({
        ...request,
        pendingWith: request.status === "pending"
          ? [
              ...((request.teacherIds || []) as number[]).map((id: number) => ({
                type: "teacher", id, name: names.get(`teacher:${id}`) || "teacher",
              })),
              ...((request.parentIds || []) as number[]).map((id: number) => ({
                type: "parent", id, name: names.get(`parent:${id}`) || "parent",
              })),
            ]
          : undefined,
      })) };
  });
}
