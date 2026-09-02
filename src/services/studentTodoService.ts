import { Op } from "sequelize";
import StudentTask from "../models/student-task.model";
import StudentTodoItem, { TodoItemStatus } from "../models/student-todo-item.model";
import StudentTodoDay from "../models/student-todo-day.model";
import StudentTodoSource, { TodoSourceType } from "../models/student-todo-source.model";
import MissionApprovalRequest from "../models/mission-approval-request.model";
import logger from "../config/logger";

// Existing production behavior is UTC. Keep this boundary centralized until
// the product chooses an organization-specific gameplay timezone.
export const utcGameplayDate = (value = new Date()) => value.toISOString().slice(0, 10);
export const activeTodoKey = (studentId: number, taskId: number) => `${studentId}:${taskId}`;
export const completionKey = (studentId: number, taskId: number, date: string) => `${studentId}:${taskId}:${date}`;
const dailyModelReady = () => { try { return Boolean(StudentTodoDay.sequelize); } catch { return false; } };

export function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && utcGameplayDate(date) === value;
}

// Every write path below is a check-then-insert inside a transaction
// (StudentTodoDay's first-load INSERT IGNORE, MissionApprovalRequest's
// pending-check-then-create): MySQL cannot express the partial-unique index
// that would let the database itself reject a concurrent duplicate, so two
// identical concurrent requests (a double-tap, a client retry, two students'
// first load of the same new day) can hit a genuine InnoDB ER_LOCK_DEADLOCK.
// A deadlock aborts the whole transaction, not one statement, so the retry
// must re-run the entire transaction from its outermost caller.
//
// Deliberately narrow. This is not a general-purpose retry:
//  - ER_LOCK_DEADLOCK only. A lock-wait timeout is excluded on purpose: it
//    only rolls back the statement under the default
//    innodb_rollback_on_timeout=OFF, and re-waiting would stack another full
//    50s timeout onto a request that is already slow.
//  - Business outcomes are never retried. The controllers return validation,
//    authorization and conflict outcomes (400/403/404/409) as ordinary
//    resolved values, so only a thrown transient database error reaches here;
//    any other thrown error propagates on the first attempt.
//  - `run` MUST open its own transaction (`() => sequelize.transaction(...)`)
//    so each attempt gets a fresh one. A managed transaction rolls itself
//    back when its callback rejects, so the failed attempt leaves nothing
//    behind and the retry re-observes committed state — a concurrent winner's
//    row is then found by the same pre-checks, which is why a retry cannot
//    duplicate a request row or its audit event.
//  - `run` must therefore have no side effect outside that transaction.
// Exhausting the attempts rethrows the original error, which each caller
// already converts into its own clean 500.
export async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error: any) {
      if (attempt >= attempts || error?.cause?.code !== "ER_LOCK_DEADLOCK") throw error;
      // Metadata only: never the row payload, and never a credential.
      logger.warn("Retrying transaction after InnoDB deadlock", { attempt, attempts });
    }
  }
}

export async function findCompletion(studentId: number, taskId: number, date: string, transaction: any) {
  return StudentTask.findOne({ where: { studentId, taskId, date, completionStatus: "Completed" }, order: [["id", "ASC"]], transaction, lock: transaction?.LOCK?.UPDATE });
}

export async function addTodoSource(todoItemId: number, sourceType: TodoSourceType, sourceId: number, transaction: any) {
  const [source] = await StudentTodoSource.findOrCreate({ where: { todoItemId, sourceType, sourceId }, defaults: { todoItemId, sourceType, sourceId }, transaction });
  return source;
}

export async function ensureTodoDay(todo: StudentTodoItem, date: string, transaction: any) {
  if (!dailyModelReady()) return todo as any;
  const dayKey = { studentId: todo.studentId, taskId: todo.taskId, missionDate: date };
  let day = await StudentTodoDay.findOne({ where: dayKey, transaction, lock: transaction?.LOCK?.UPDATE });
  const completed = await findCompletion(todo.studentId, todo.taskId, date, transaction);
  const pending = completed ? null : await MissionApprovalRequest.findOne({
    where: { studentId: todo.studentId, missionId: todo.taskId, missionDate: date, status: "pending" },
    order: [["createdAt", "ASC"]], transaction, lock: transaction?.LOCK?.UPDATE,
  });
  const values: any = completed ? {
    status: TodoItemStatus.Completed, studentTaskId: completed.id,
    completedAt: completed.createdAt, completionSource: completed.completionSource || "solo_self",
    completedById: completed.teacherId || completed.parentId || null,
  } : { status: pending ? TodoItemStatus.PendingApproval : TodoItemStatus.Todo };
  if (!day) {
    // The initial read cannot lock a row that does not exist. INSERT IGNORE is
    // therefore the concurrency boundary: simultaneous first loads may both
    // reach this branch, but the database admits exactly one occurrence and
    // neither request fails with a transient unique-key error.
    await StudentTodoDay.bulkCreate([
      { studentTodoItemId: todo.id, ...dayKey, ...values },
    ], { ignoreDuplicates: true, transaction });
    day = await StudentTodoDay.findOne({ where: dayKey, transaction, lock: transaction?.LOCK?.UPDATE });
    if (!day) throw new Error("Failed to materialize daily mission occurrence");
  } else if (completed || (pending && day.status === TodoItemStatus.Todo)) {
    await day.update(values, { transaction });
  }
  if (pending && !pending.todoDayId) await pending.update({ todoDayId: day.id, todoItemId: todo.id }, { transaction });
  return day;
}

export async function addOrAssignTodo({ studentId, taskId, sourceType, sourceId, date = utcGameplayDate(), transaction }: {
  studentId: number; taskId: number; sourceType: TodoSourceType; sourceId: number; date?: string; transaction: any;
}) {
  if (!dailyModelReady()) {
    const completed = await findCompletion(studentId, taskId, date, transaction);
    if (completed) {
      const todo = await reconcileCompletedTodo({ studentId, taskId, date, studentTask: completed,
        completionSource: completed.completionSource || "solo_self", completedById: completed.teacherId || completed.parentId || null, transaction });
      return { status: "already_completed" as const, todo, day: todo, alreadyCompletedToday: true };
    }
  }
  const key = activeTodoKey(studentId, taskId);
  let todo = await StudentTodoItem.findOne({ where: { activeKey: key, isActive: true }, transaction, lock: transaction?.LOCK?.UPDATE });
  const created = !todo;
  if (!todo) {
    const topmost = await StudentTodoItem.min("position", { where: { studentId, isActive: true }, transaction });
    const position = typeof topmost === "number" && Number.isFinite(topmost) ? topmost - 1 : 0;
    todo = await StudentTodoItem.create({ studentId, taskId, status: TodoItemStatus.Todo, activeKey: key, todoDate: date, position, isActive: true }, { transaction });
  }
  await addTodoSource(todo.id, sourceType, sourceId, transaction);
  const day = await ensureTodoDay(todo, date, transaction);
  return { status: created ? ("created" as const) : ("existing" as const), todo, day, alreadyCompletedToday: day.status === TodoItemStatus.Completed };
}

export async function reconcileCompletedTodo({ studentId, taskId, date, studentTask, completionSource, completedById, transaction }: {
  studentId: number; taskId: number; date: string; studentTask: StudentTask; completionSource: string; completedById: number | null; transaction: any;
}) {
  if (!dailyModelReady()) {
    let legacy = await StudentTodoItem.findOne({ where: { studentTaskId: studentTask.id }, transaction, lock: transaction?.LOCK?.UPDATE });
    if (legacy) return legacy;
    legacy = await StudentTodoItem.findOne({ where: { activeKey: activeTodoKey(studentId, taskId), status: { [Op.in]: [TodoItemStatus.Todo, TodoItemStatus.PendingApproval] } }, transaction, lock: transaction?.LOCK?.UPDATE });
    const values = { status: TodoItemStatus.Completed, activeKey: null, completedAt: new Date(), studentTaskId: studentTask.id, completionSource, completedById };
    if (!legacy) return StudentTodoItem.create({ studentId, taskId, todoDate: date, ...values }, { transaction });
    await legacy.update(values, { transaction });
    return legacy;
  }
  const endOfDay = new Date(`${date}T23:59:59.999Z`);
  const todo = await StudentTodoItem.findOne({
    where: { studentId, taskId, [Op.or]: [{ isActive: true }, { createdAt: { [Op.lte]: endOfDay }, removedAt: { [Op.gt]: endOfDay } }] } as any,
    order: [["isActive", "DESC"], ["id", "ASC"]], transaction, lock: transaction?.LOCK?.UPDATE,
  });
  if (!todo) return null;
  let day = await StudentTodoDay.findOne({ where: { studentId, taskId, missionDate: date }, transaction, lock: transaction?.LOCK?.UPDATE });
  const values = { status: TodoItemStatus.Completed, completedAt: new Date(), studentTaskId: studentTask.id, completionSource, completedById };
  if (!day) day = await StudentTodoDay.create({ studentTodoItemId: todo.id, studentId, taskId, missionDate: date, ...values }, { transaction });
  else await day.update(values, { transaction });
  return day;
}
