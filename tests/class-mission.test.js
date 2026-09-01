const test = require("node:test");
const assert = require("node:assert/strict");

const Student = require("../dist/models/student.model").default;
const Task = require("../dist/models/task.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const StudentTodoItem = require("../dist/models/student-todo-item.model").default;
const MissionApprovalRequest = require("../dist/models/mission-approval-request.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Class = require("../dist/models/class.model").default;
const { addPros: teacherAddPros } = require("../dist/controllers/teacherController");

const makeResponse = () => ({ statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("teacher mixed completion batch completes new students and safely reports an existing completion", async () => {
  const students = new Map([101, 102, 103, 104].map((id) => [id, {
    id, classId: 8, organizationId: 2, xp: id, snabelRed: 0, snabelBlue: 0, snabelYellow: 0,
    async save() {},
  }]));
  const task = { id: 12, xp: 20, snabelRed: 1, snabelBlue: 2, snabelYellow: 3,
    type: "cooperation", taskCategory: { title: "community" } };

  Teacher.findOne = async () => ({ id: 3, userId: 55, organizationId: 2 });
  Class.findOne = async () => ({ id: 8, teacherId: 3, organizationId: 2 });
  Task.findOne = async () => task;
  Student.findOne = async ({ where }) => students.get(where.id);
  Challenge.findAll = async () => [];
  StudentChallenge.findAll = async () => [];
  StudentTask.findOne = async ({ where }) => where.studentId === 104
    ? { id: 900, studentId: 104, taskId: 12, completionSource: "parent_direct", parentId: 7 }
    : null;
  let createdId = 1000;
  StudentTask.create = async (data) => ({ id: createdId++, ...data });

  const reconciled = [];
  StudentTodoItem.findOne = async ({ where }) => {
    if (where.studentTaskId) return where.studentTaskId === 900 ? { id: 700 } : null;
    if (where.activeKey && /101:12|102:12/.test(where.activeKey)) {
      return { id: Number(where.activeKey.split(":")[0]), async update(values) { reconciled.push({ id: this.id, ...values }); } };
    }
    return null;
  };
  StudentTodoItem.create = async (values) => { reconciled.push(values); return { id: 800 + reconciled.length, ...values }; };
  MissionApprovalRequest.update = async () => [1];
  Object.defineProperty(Student, "sequelize", {
    value: { transaction: async (work) => work({ LOCK: { UPDATE: "UPDATE" } }) }, configurable: true,
  });

  const res = makeResponse();
  await teacherAddPros({ user: { id: 55 }, body: { taskId: 12, studentIds: [101, 102, 103, 104], time: "10:30" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.completed, 3);
  assert.equal(res.body.summary.already_completed, 1);
  assert.equal(students.get(101).xp, 121);
  assert.equal(students.get(104).xp, 104, "already completed receives no second reward");
  assert.equal(reconciled.length, 3, "active and no-prior-assignment To-Dos reconcile to completed");
});

test("teacher batch reports an out-of-class Student without failing authorized Students", async () => {
  const own = { id: 1, classId: 8, organizationId: 2 };
  const other = { id: 2, classId: 9, organizationId: 3 };
  Teacher.findOne = async () => ({ id: 3, userId: 55, organizationId: 2 });
  Task.findOne = async () => ({ id: 12 });
  Student.findOne = async ({ where }) => where.id === 1 ? own : other;
  Class.findOne = async ({ where }) => where.id === 8 ? { id: 8 } : null;
  StudentTask.findOne = async () => ({ id: 5, completionSource: "teacher_direct" });
  StudentTodoItem.findOne = async () => ({ id: 6 });
  MissionApprovalRequest.update = async () => [0];
  Object.defineProperty(Student, "sequelize", {
    value: { transaction: async (work) => work({ LOCK: { UPDATE: "UPDATE" } }) }, configurable: true,
  });
  const res = makeResponse();
  await teacherAddPros({ user: { id: 55 }, body: { taskId: 12, studentIds: [1, 2], time: "10:30" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.already_completed, 1);
  assert.equal(res.body.summary.unauthorized, 1);
});
