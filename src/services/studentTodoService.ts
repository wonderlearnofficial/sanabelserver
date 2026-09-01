import { Op } from "sequelize";
import StudentTask from "../models/student-task.model";
import StudentTodoItem, { TodoItemStatus } from "../models/student-todo-item.model";
import StudentTodoSource, { TodoSourceType } from "../models/student-todo-source.model";

export const utcGameplayDate = () => new Date().toISOString().slice(0, 10);
export const activeTodoKey = (studentId: number, taskId: number) => `${studentId}:${taskId}`;
export const completionKey = (studentId: number, taskId: number, date: string) => `${studentId}:${taskId}:${date}`;

export async function findCompletion(studentId: number, taskId: number, date: string, transaction: any) {
  return StudentTask.findOne({
    where: { studentId, taskId, date, completionStatus: "Completed" },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
}

export async function addTodoSource(todoItemId: number, sourceType: TodoSourceType, sourceId: number, transaction: any) {
  const [source] = await StudentTodoSource.findOrCreate({
    where: { todoItemId, sourceType, sourceId },
    defaults: { todoItemId, sourceType, sourceId },
    transaction,
  });
  return source;
}

export async function addOrAssignTodo({ studentId, taskId, sourceType, sourceId, date = utcGameplayDate(), transaction }: {
  studentId: number; taskId: number; sourceType: TodoSourceType; sourceId: number; date?: string; transaction: any;
}) {
  const completed = await findCompletion(studentId, taskId, date, transaction);
  if (completed) {
    const todo = await reconcileCompletedTodo({ studentId, taskId, date, studentTask: completed,
      completionSource: completed.completionSource || "solo_self",
      completedById: completed.teacherId || completed.parentId || null, transaction });
    return { status: "already_completed" as const, todo, alreadyCompletedToday: true };
  }
  const key = activeTodoKey(studentId, taskId);
  let todo = await StudentTodoItem.findOne({ where: { activeKey: key }, transaction, lock: transaction?.LOCK?.UPDATE });
  const created = !todo;
  if (!todo) {
    todo = await StudentTodoItem.create({ studentId, taskId, status: TodoItemStatus.Todo, activeKey: key, todoDate: date }, { transaction });
  }
  await addTodoSource(todo.id, sourceType, sourceId, transaction);
  return { status: created ? ("created" as const) : ("existing" as const), todo, alreadyCompletedToday: false };
}

export async function reconcileCompletedTodo({ studentId, taskId, date, studentTask, completionSource, completedById, transaction }: {
  studentId: number; taskId: number; date: string; studentTask: StudentTask; completionSource: string; completedById: number | null; transaction: any;
}) {
  const key = activeTodoKey(studentId, taskId);
  let todo = await StudentTodoItem.findOne({ where: { studentTaskId: studentTask.id }, transaction, lock: transaction?.LOCK?.UPDATE });
  if (todo) return todo;
  todo = await StudentTodoItem.findOne({
    where: { activeKey: key, status: { [Op.in]: [TodoItemStatus.Todo, TodoItemStatus.PendingApproval] } },
    transaction, lock: transaction?.LOCK?.UPDATE,
  });
  const values = { status: TodoItemStatus.Completed, activeKey: null, completedAt: new Date(),
    studentTaskId: studentTask.id, completionSource, completedById };
  if (!todo) {
    todo = await StudentTodoItem.create({ studentId, taskId, todoDate: date, ...values }, { transaction });
  } else {
    await todo.update(values, { transaction });
  }
  return todo;
}
