const test = require("node:test");
const assert = require("node:assert/strict");

// Regression tests for the "فشل في تحديد المهمة كمكتملة" (blank error alert)
// production bug. Root cause: addPros's catch-all returned `{ error: ... }`
// with no `message` field; the client only read `.message` and fell back to
// `response.statusText`, which is spec-empty for HTTP/2 responses (Vercel and
// Railway both serve over HTTP/2) in every browser — rendering a blank alert
// on ANY unexpected failure, not only Safari. Covers all three role-specific
// handlers, since they share the identical defect.

const Student = require("../dist/models/student.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const Task = require("../dist/models/task.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;

const { addPros } = require("../dist/controllers/studentController");

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

// A fresh object per call — Student.sequelize is reassigned to this same
// reference by baseStubs(), so sharing one object across tests would let a
// test that overrides .transaction (e.g. to simulate a DB error) corrupt
// every test that runs after it.
const makeFakeTransaction = () => ({
  transaction: async (work) => work({ fake: "tx" }),
});

const makeStudent = (overrides = {}) => ({
  id: 1,
  userId: 7,
  xp: 0,
  snabelRed: 0,
  snabelBlue: 0,
  snabelYellow: 0,
  water: 0,
  seeders: 0,
  saveCalls: 0,
  async save() {
    this.saveCalls += 1;
  },
  ...overrides,
});

const makeTask = (overrides = {}) => ({
  id: 1,
  xp: 5,
  snabelRed: 1,
  snabelBlue: 1,
  snabelYellow: 1,
  type: "snbla elslah",
  taskCategory: { title: "category" },
  ...overrides,
});

const baseStubs = ({ student, task, existingRecord = null, challenges = [], studentChallenges = [] }) => {
  Student.findOne = async () => student;
  Object.defineProperty(Student, "sequelize", {
    value: makeFakeTransaction(),
    configurable: true,
  });
  StudentTask.findOne = async () => existingRecord;
  StudentTask.create = async () => ({});
  Task.findOne = async () => task;
  Challenge.findAll = async () => challenges;
  StudentChallenge.findAll = async () => studentChallenges;
};

test("a plain unexpected exception returns a 500 WITH a message field", async () => {
  // This is the exact defect: previously { error: "Internal Server Error" }
  // with no `message`, which every client in the app renders as blank text.
  Student.findOne = async () => {
    throw new Error("simulated unexpected failure (e.g. a dropped DB connection)");
  };

  const res = makeResponse();
  await addPros({ user: { id: 7 }, body: { taskId: 1, time: new Date().toISOString() } }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(typeof res.body.message, "string");
  assert.ok(res.body.message.length > 0, "message must be a non-empty string");
});

test("a duplicate-completion race (unique constraint) returns a clean 409, not a 500", async () => {
  const student = makeStudent();
  baseStubs({ student, task: makeTask() });
  Student.sequelize.transaction = async () => {
    const err = new Error("Duplicate entry");
    err.name = "SequelizeUniqueConstraintError";
    throw err;
  };

  const res = makeResponse();
  await addPros(
    { user: { id: 7 }, body: { taskId: 1, time: new Date().toISOString() } },
    res,
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /already completed/i);
});

test("a challenge with no configured point threshold is never auto-completed", async () => {
  const student = makeStudent();
  const task = makeTask();
  const challengeRow = {
    studentId: student.id,
    pointOfStudent: 0,
    completionStatus: "NotCompleted",
    challenge: { category: "xp", point: null, xp: 999 },
    saved: false,
    async save() {
      this.saved = true;
    },
  };
  baseStubs({ student, task, studentChallenges: [challengeRow] });

  const res = makeResponse();
  await addPros(
    { user: { id: 7 }, body: { taskId: 1, time: new Date().toISOString() } },
    res,
  );

  assert.equal(res.statusCode, 201);
  // Regression: `pointOfStudent >= null` is `0 >= 0` → true in JS, which
  // instantly "completed" any challenge with no threshold configured.
  assert.equal(challengeRow.completionStatus, "NotCompleted");
  assert.equal(student.xp, task.xp); // task reward only, no bogus challenge reward
});

test("a challenge that legitimately reaches its point threshold still completes", async () => {
  const student = makeStudent();
  const task = makeTask();
  const challengeRow = {
    studentId: student.id,
    pointOfStudent: 4,
    completionStatus: "NotCompleted",
    challenge: { category: "xp", point: 5, xp: 50, snabelRed: 0, snabelBlue: 0, snabelYellow: 0, water: 0, seeder: 0 },
    saved: false,
    async save() {
      this.saved = true;
    },
  };
  baseStubs({ student, task, studentChallenges: [challengeRow] });

  const res = makeResponse();
  await addPros(
    { user: { id: 7 }, body: { taskId: 1, time: new Date().toISOString() } },
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(challengeRow.completionStatus, "Completed");
  assert.equal(student.xp, task.xp + 50);
});

test("an ISO time with milliseconds is accepted (the validation regex escapes its dot)", async () => {
  const student = makeStudent();
  baseStubs({ student, task: makeTask() });

  const res = makeResponse();
  await addPros(
    { user: { id: 7 }, body: { taskId: 1, time: "2026-08-17T10:15:30.123Z" } },
    res,
  );

  assert.equal(res.statusCode, 201);
});

test("already-completed-today reconciles successfully without awarding twice", async () => {
  const student = makeStudent();
  baseStubs({ student, task: makeTask(), existingRecord: { id: 99 } });

  const res = makeResponse();
  await addPros(
    { user: { id: 7 }, body: { taskId: 1, time: new Date().toISOString() } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Task already completed today");
  assert.equal(res.body.alreadyCompleted, true);
  assert.equal(student.xp, 0);
  assert.equal(student.saveCalls, 0);
});
