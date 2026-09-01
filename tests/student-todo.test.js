const test = require("node:test");
const assert = require("node:assert/strict");

const Student = require("../dist/models/student.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Task = require("../dist/models/task.model").default;
const Class = require("../dist/models/class.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const StudentTodoItem = require("../dist/models/student-todo-item.model").default;
const StudentTodoSource = require("../dist/models/student-todo-source.model").default;
const MissionApprovalRequest = require("../dist/models/mission-approval-request.model").default;
const { addOrAssignTodo } = require("../dist/services/studentTodoService");
const { assignTodoAsTeacher } = require("../dist/controllers/todoController");
const { requestApproval } = require("../dist/controllers/missionController");
const { addPros: studentAddPros } = require("../dist/controllers/studentController");
const { completeMissionForStudent } = require("../dist/helpers/completeMission");

const tx = { LOCK: { UPDATE: "UPDATE" } };
const makeResponse = () => ({ statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
});
Object.defineProperty(Student, "sequelize", {
  value: { transaction: async (work) => work(tx) }, configurable: true,
});

test("adding and assigning the same active mission reuses one To-Do and preserves every source", async () => {
  StudentTask.findOne = async () => null;
  const todo = { id: 41, studentId: 9, taskId: 3 };
  StudentTodoItem.findOne = async () => todo;
  let createCalls = 0;
  StudentTodoItem.create = async () => { createCalls += 1; };
  const sources = [];
  StudentTodoSource.findOrCreate = async ({ where }) => { sources.push(where); return [where, true]; };
  const teacherResult = await addOrAssignTodo({ studentId: 9, taskId: 3, sourceType: "teacher", sourceId: 5, transaction: tx });
  const parentResult = await addOrAssignTodo({ studentId: 9, taskId: 3, sourceType: "parent", sourceId: 7, transaction: tx });
  assert.equal(teacherResult.status, "existing");
  assert.equal(parentResult.status, "existing");
  assert.equal(createCalls, 0);
  assert.deepEqual(sources.map((source) => source.sourceType), ["teacher", "parent"]);
});

test("assigning a mission already completed today returns authoritative completed state without a new active card", async () => {
  const completion = { id: 70, completionSource: "parent_direct", parentId: 7 };
  const completedTodo = { id: 71, studentTaskId: 70, status: "completed" };
  StudentTask.findOne = async () => completion;
  StudentTodoItem.findOne = async ({ where }) => where.studentTaskId === 70 ? completedTodo : null;
  let createCalls = 0;
  StudentTodoItem.create = async () => { createCalls += 1; };
  const result = await addOrAssignTodo({ studentId: 9, taskId: 3, sourceType: "teacher", sourceId: 5, transaction: tx });
  assert.equal(result.status, "already_completed");
  assert.equal(result.alreadyCompletedToday, true);
  assert.equal(createCalls, 0);
});

test("Teacher assignment batch creates authorized work, reports cross-school IDs, and grants no rewards", async () => {
  Teacher.findOne = async () => ({ id: 5, userId: 50, organizationId: 2 });
  Task.findByPk = async () => ({ id: 3 });
  const own = { id: 9, classId: 4, organizationId: 2 };
  const other = { id: 10, classId: 8, organizationId: 99 };
  Student.findByPk = async (id) => id === 9 ? own : other;
  Class.findOne = async ({ where }) => where.id === 4 ? { id: 4 } : null;
  StudentTask.findOne = async () => null;
  StudentTodoItem.findOne = async () => null;
  StudentTodoItem.create = async (values) => ({ id: 60, ...values });
  StudentTodoSource.findOrCreate = async ({ where }) => [where, true];
  const res = makeResponse();
  await assignTodoAsTeacher({ user: { id: 50 }, body: { taskId: 3, studentIds: [9, 10] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.created, 1);
  assert.equal(res.body.summary.unauthorized, 1);
  assert.equal(res.body.results[0].rewardsGranted, false);
});

test("School Student request transitions its own To-Do to pending and duplicate clicks reuse the request", async () => {
  const student = { id: 9, userId: 90, classId: 4, ParentId: 7 };
  const todo = { id: 41, status: "todo", async update(values) { this.status = values.status; } };
  Student.findOne = async () => student;
  Task.findByPk = async () => ({ id: 3 });
  Class.findByPk = async () => ({ id: 4, teacherId: 5 });
  StudentTodoItem.findOne = async () => todo;
  StudentTask.findOne = async () => null;
  let pending = null;
  MissionApprovalRequest.findOne = async () => pending;
  MissionApprovalRequest.create = async (values) => { pending = { id: 100, ...values }; return pending; };
  let res = makeResponse();
  await requestApproval({ user: { id: 90 }, body: { taskId: 3, todoItemId: 41, approverId: 5, approverType: "teacher" } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(todo.status, "pending_approval");
  res = makeResponse();
  await requestApproval({ user: { id: 90 }, body: { taskId: 3, todoItemId: 41, approverId: 5, approverType: "teacher" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.alreadyPending, true);
});

test("School Student cannot self-award through /students/add-pros", async () => {
  Student.findOne = async () => ({ id: 9, userId: 90, classId: 4 });
  const res = makeResponse();
  await studentAddPros({ user: { id: 90 }, body: { taskId: 3, time: "10:00" } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /request approval/i);
});

test("direct completion reconciles active To-Do and pending approval in the same transaction", async () => {
  const student = { id: 9, classId: 4, xp: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0, async save() {} };
  const activeTodo = { id: 41, async update(values) { Object.assign(this, values); } };
  Student.findOne = async () => student;
  StudentTask.findOne = async () => null;
  StudentTask.create = async (values) => ({ id: 72, ...values });
  Task.findOne = async () => ({ id: 3, xp: 5, snabelRed: 1, snabelBlue: 1, snabelYellow: 1,
    type: "help", taskCategory: { title: "community" } });
  Challenge.findAll = async () => [];
  StudentChallenge.findAll = async () => [];
  StudentTodoItem.findOne = async ({ where }) => where.studentTaskId ? null : activeTodo;
  let requestUpdate = null;
  MissionApprovalRequest.update = async (values, options) => { requestUpdate = { values, where: options.where }; return [1]; };
  const result = await completeMissionForStudent({ studentId: 9, taskId: 3, missionDate: "2026-09-01",
    source: "teacher_direct", approverId: 5, approverType: "teacher", transaction: tx });
  assert.equal(result.rewardsGranted, true);
  assert.equal(activeTodo.status, "completed");
  assert.equal(activeTodo.completionSource, "teacher_direct");
  assert.equal(requestUpdate.values.status, "approved");
  assert.equal(requestUpdate.where.status, "pending");
});
