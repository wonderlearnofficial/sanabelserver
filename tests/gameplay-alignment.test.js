const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const model = (name) => require(`../dist/models/${name}.model`).default;
const Student = model("student"), Task = model("task"), StudentTask = model("student-task");
const Teacher = model("teacher"), Parent = model("parent"), Class = model("class");
const Challenge = model("challenge"), StudentChallenge = model("student-challenge");
const Todo = model("student-todo-item"), Day = model("student-todo-day"), Source = model("student-todo-source");
const Approval = model("mission-approval-request"), Event = model("mission-approval-request-event");
const { addPros } = require("../dist/controllers/studentController");
const { requestApproval, approveRequestAsParent } = require("../dist/controllers/missionController");
const { addMyTodo, listMyTodo, assignTodoAsTeacher } = require("../dist/controllers/todoController");
const { addPros: teacherComplete } = require("../dist/controllers/teacherController");
const { utcGameplayDate } = require("../dist/services/studentTodoService");

const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const record = (values) => ({ ...values, async update(next) { Object.assign(this, next); return this; }, async save() {} });
let students, todos, days, completions, approvals, sources, challenge;
const tx = { LOCK: { UPDATE: "UPDATE" } };
beforeEach(() => {
  students = new Map(); todos = []; days = []; completions = []; approvals = []; sources = new Set();
  challenge = record({ id: 8, pointOfStudent: 0, completionStatus: "NotCompleted", challenge: {
    id: 8, category: "alltask", point: 1, xp: 2, snabelRed: 0, snabelBlue: 0, snabelYellow: 0,
  } });
  for (const M of [Student, Approval, Day]) Object.defineProperty(M, "sequelize", {
    configurable: true, value: { transaction: async (fn) => fn(tx), literal: (value) => value },
  });
  Student.findOne = async ({ where }) => where.id ? students.get(where.id) : [...students.values()].find((s) => s.userId === where.userId);
  Student.findByPk = async (id) => students.get(id);
  Student.findAll = Teacher.findAll = Parent.findAll = async () => [];
  Teacher.findOne = async () => ({ id: 5, organizationId: 2 });
  Parent.findOne = async ({ where }) => ({ id: where.userId === 70 ? 7 : 99 });
  Class.findByPk = async () => ({ id: 4, teacherId: 5, organizationId: 2 });
  Class.findOne = async ({ where }) => where.id === 4 && where.teacherId === 5 && where.organizationId === 2 ? { id: 4 } : null;
  Task.findOne = Task.findByPk = async () => ({ id: 3, xp: 5, snabelBlue: 1, snabelRed: 2, snabelYellow: 3, type: "help", taskCategory: { title: "family" } });
  StudentTask.findOne = async ({ where }) => completions.find((c) => c.studentId === where.studentId && c.taskId === where.taskId && c.date === where.date) || null;
  StudentTask.create = async (values) => { const item = record({ id: completions.length + 1, ...values }); completions.push(item); return item; };
  Challenge.findAll = async () => [challenge.challenge];
  StudentChallenge.findAll = async () => challenge.completionStatus === "NotCompleted" ? [challenge] : [];
  Todo.min = async () => null;
  Todo.findOne = async ({ where }) => todos.find((t) => where.activeKey ? t.activeKey === where.activeKey : where.id ? t.id === where.id && t.studentId === where.studentId : t.studentId === where.studentId && t.taskId === where.taskId) || null;
  Todo.create = async (values) => { const item = record({ id: todos.length + 1, createdAt: new Date(), ...values }); todos.push(item); return item; };
  Todo.findAll = async () => [];
  Source.findOrCreate = async ({ where }) => { const key = JSON.stringify(where); const created = !sources.has(key); sources.add(key); return [where, created]; };
  Day.findOne = async ({ where }) => days.find((d) => d.studentId === where.studentId && d.taskId === where.taskId && d.missionDate === where.missionDate) || null;
  Day.bulkCreate = async (values) => { for (const value of values) days.push(record({ id: days.length + 1, ...value })); };
  Day.create = async (values) => { const day = record({ id: days.length + 1, ...values }); days.push(day); return day; };
  Day.findAll = async () => [];
  Day.count = async () => 0;
  Approval.findOne = async ({ where }) => approvals.find((a) => a.studentId === where.studentId && a.missionId === where.missionId && a.missionDate === where.missionDate && a.status === where.status) || null;
  Approval.create = async (values) => { const a = record({ id: approvals.length + 1, ...values }); approvals.push(a); return a; };
  Approval.findByPk = async (id) => approvals.find((a) => a.id === id);
  Approval.update = async (values, { where }) => {
    for (const a of approvals) if (a.studentId === where.studentId && a.missionId === where.missionId && a.missionDate === where.missionDate && a.status === where.status && (!where.id || a.id === where.id)) await a.update(values);
    return [1];
  };
  Event.create = async (values) => values;
});

function student(organizationId, classId, id = 9) {
  const s = record({ id, userId: id * 10, organizationId, classId, ParentId: 7, createdAt: new Date("2026-01-01Z"), xp: 0, snabelBlue: 0, snabelRed: 0, snabelYellow: 0 });
  students.set(id, s); return s;
}

test("Solo self-completion rewards once across retry, including challenge rewards", async () => {
  const s = student(null, null);
  for (const expected of [201, 200]) {
    const response = res(); await addPros({ user: { id: 90 }, body: { taskId: 3, time: "10:00" } }, response);
    assert.equal(response.statusCode, expected);
  }
  assert.equal(s.xp, 7); assert.equal(s.snabelBlue, 1); assert.equal(s.snabelRed, 2); assert.equal(s.snabelYellow, 3);
  assert.equal(completions.length, 1); assert.equal(challenge.pointOfStudent, 1); assert.equal(todos.length, 0);
});

for (const [name, org, cls] of [["school with class", 2, 4], ["school without class", 2, null], ["inconsistent class-only record", null, 4]]) {
  test(`${name}: direct Student reward is refused without mutation`, async () => {
    const s = student(org, cls); const response = res();
    await addPros({ user: { id: 90 }, body: { taskId: 3, time: "10:00" } }, response);
    assert.equal(response.statusCode, 403); assert.match(response.body.message, /request approval/i);
    assert.equal(s.xp, 0); assert.equal(completions.length, 0); assert.equal(challenge.pointOfStudent, 0);
    assert.equal(s.organizationId, org); assert.equal(s.classId, cls);
  });
}

test("classless School Student can add/list daily missions and request linked Parent approval without reward", async () => {
  const s = student(2, null);
  const added = res(); await addMyTodo({ user: { id: 90 }, body: { taskId: 3 } }, added);
  assert.equal(added.statusCode, 201); assert.equal(days[0].status, "todo");
  const listed = res(); await listMyTodo({ user: { id: 90 }, query: {} }, listed);
  assert.equal(listed.statusCode, 200);
  for (const expected of [201, 200]) {
    const response = res(); await requestApproval({ user: { id: 90 }, body: { taskId: 3, todoItemId: 1, approverId: 7, approverType: "parent" } }, response);
    assert.equal(response.statusCode, expected);
  }
  assert.equal(approvals.length, 1); assert.equal(approvals[0].todoDayId, days[0].id);
  assert.deepEqual(approvals[0].teacherIds, []); assert.deepEqual(approvals[0].parentIds, [7]);
  assert.equal(days[0].status, "pending_approval"); assert.equal(s.xp, 0); assert.equal(completions.length, 0);
});

test("classless School Student cannot select an unrelated adult or complete without an eligible approver", async () => {
  const s = student(2, null);
  for (const [approverType, approverId] of [["parent", 99], ["teacher", 5]]) {
    const response = res(); await requestApproval({ user: { id: 90 }, body: { taskId: 3, approverType, approverId } }, response);
    assert.equal(response.statusCode, 403);
  }
  s.ParentId = null;
  const response = res(); await requestApproval({ user: { id: 90 }, body: { taskId: 3 } }, response);
  assert.equal(response.statusCode, 400); assert.match(response.body.message, /No parent or teacher/);
  assert.equal(approvals.length, 0); assert.equal(s.xp, 0);
});

test("delayed classless-school approval reconciles only the original day and rewards exactly once", async () => {
  const s = student(2, null);
  todos.push(record({ id: 1, studentId: 9, taskId: 3, isActive: true, activeKey: "9:3" }));
  days.push(record({ id: 1, studentId: 9, taskId: 3, missionDate: "2026-09-01", status: "pending_approval" }));
  days.push(record({ id: 2, studentId: 9, taskId: 3, missionDate: utcGameplayDate(), status: "todo" }));
  approvals.push(record({ id: 1, studentId: 9, missionId: 3, missionDate: "2026-09-01", todoItemId: 1, todoDayId: 1, status: "pending", parentIds: [7], teacherIds: [] }));
  const foreign = res(); await approveRequestAsParent({ user: { id: 990 }, body: { requestId: 1 } }, foreign);
  assert.equal(foreign.statusCode, 403); assert.equal(s.xp, 0);
  for (let i = 0; i < 2; i++) {
    const response = res(); await approveRequestAsParent({ user: { id: 70 }, body: { requestId: 1 } }, response);
    assert.equal(response.statusCode, 200);
  }
  assert.equal(s.xp, 7); assert.equal(completions.length, 1); assert.equal(challenge.pointOfStudent, 1);
  assert.equal(completions[0].date, "2026-09-01"); assert.equal(completions[0].completionKey, "9:3:2026-09-01");
  assert.equal(approvals[0].status, "approved"); assert.equal(days[0].status, "completed"); assert.equal(days[1].status, "todo");
});

for (const count of [1, 3, 10, 50]) {
  test(`Teacher assignment of ${count} Students is reward-free and duplicate-safe`, async () => {
    const ids = Array.from({ length: count }, (_, i) => student(2, 4, i + 1).id);
    for (let i = 0; i < 2; i++) {
      const response = res(); await assignTodoAsTeacher({ user: { id: 50 }, body: { taskId: 3, studentIds: [...ids, ids[0]] } }, response);
      assert.equal(response.statusCode, 200); assert.equal(response.body.results.length, count);
      assert.equal(response.body.summary[i === 0 ? "created" : "existing"], count);
      assert.ok(response.body.results.every((r) => r.rewardsGranted === false));
    }
    assert.equal(todos.length, count); assert.equal(days.length, count); assert.equal(sources.size, count);
    assert.equal(completions.length, 0); assert.equal(challenge.pointOfStudent, 0);
    assert.ok([...students.values()].every((s) => s.xp === 0 && s.snabelBlue === 0 && s.snabelRed === 0 && s.snabelYellow === 0));
  });
}

test("Teacher still needs an assigned class; explicit completion retries reward once", async () => {
  const own = student(2, 4); student(2, null, 10); student(99, 4, 11);
  for (let i = 0; i < 2; i++) {
    const response = res(); await teacherComplete({ user: { id: 50 }, body: { taskId: 3, studentIds: [9, 10, 11], time: "10:00" } }, response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.summary.unauthorized, 2);
    assert.equal(response.body.summary[i === 0 ? "completed" : "already_completed"], 1);
  }
  assert.equal(own.xp, 7); assert.equal(completions.length, 1); assert.equal(completions[0].completionSource, "teacher_direct");
});
