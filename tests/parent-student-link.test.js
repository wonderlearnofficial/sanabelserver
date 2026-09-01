const test = require("node:test");
const assert = require("node:assert/strict");
const Student = require("../dist/models/student.model").default;
const Parent = require("../dist/models/parent.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const Task = require("../dist/models/task.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const { searchStuentByCode, connectStudentToParent, addPros: parentAddPros } = require("../dist/controllers/parentController");

const makeResponse = () => ({ statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
});
Object.defineProperty(Student, "sequelize", {
  value: { transaction: async (work) => work({ LOCK: { UPDATE: "UPDATE" } }) }, configurable: true,
});

test("search student by link code returns only the matching Student", async () => {
  Parent.findOne = async () => ({ id: 7, userId: 100 });
  Student.findOne = async ({ where }) => where.connectCode === "SNB-1234"
    ? { id: 15, connectCode: "SNB-1234", user: { firstName: "Ahmed", lastName: "Ali" } } : null;
  const res = makeResponse();
  await searchStuentByCode({ user: { id: 100 }, params: { code: "SNB-1234" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.id, 15);
});

test("connect child is idempotent for the same Parent and rejects a conflicting Parent", async () => {
  Parent.findOne = async () => ({ id: 7, userId: 100 });
  const child = { id: 20, ParentId: null, async update(values) { Object.assign(this, values); } };
  Student.findOne = async () => child;
  let res = makeResponse();
  await connectStudentToParent({ user: { id: 100 }, body: { code: "ABC-5555" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(child.ParentId, 7);
  res = makeResponse();
  await connectStudentToParent({ user: { id: 100 }, body: { code: "ABC-5555" } }, res);
  assert.equal(res.statusCode, 200);
  child.ParentId = 999;
  res = makeResponse();
  await connectStudentToParent({ user: { id: 100 }, body: { code: "ABC-5555" } }, res);
  assert.equal(res.statusCode, 409);
});

test("parent direct completion processes linked and unrelated children independently", async () => {
  const own = { id: 20, ParentId: 7, xp: 10, snabelRed: 0, snabelBlue: 0, snabelYellow: 0, async save() {} };
  const other = { id: 30, ParentId: 8 };
  Parent.findOne = async () => ({ id: 7, userId: 100 });
  Task.findOne = async () => ({ id: 1, xp: 15, snabelRed: 1, snabelBlue: 1, snabelYellow: 1,
    type: "family", taskCategory: { title: "family" } });
  Student.findOne = async ({ where }) => where.id === 20 ? own : other;
  StudentTask.findOne = async () => null;
  StudentTask.create = async (record) => ({ id: 40, ...record });
  Challenge.findAll = async () => [];
  StudentChallenge.findAll = async () => [];
  const res = makeResponse();
  await parentAddPros({ user: { id: 100 }, body: { taskId: 1, studentIds: [20, 30], time: "14:00" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.completed, 1);
  assert.equal(res.body.summary.unauthorized, 1);
  assert.equal(own.xp, 25);
});
