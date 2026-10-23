// Tutorial V2 Phase 2A: the Student profile must carry the authoritative
// account creation time, so the client can tell an account created before the
// tutorial rollout from a new one. `Users.createdAt` is the source; the
// Students row's own timestamp is not (imports and re-linking move it).
const test = require("node:test");
const assert = require("node:assert/strict");

const { studentData } = require("../dist/controllers/studentController");
const Student = require("../dist/models/student.model").default;
const Tree = require("../dist/models/tree.model").default;
const StudentTask = require("../dist/models/student-task.model").default;

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
  setHeader() {},
});

const USER_CREATED_AT = new Date("2026-03-01T09:15:00.000Z");
const STUDENT_ROW_CREATED_AT = new Date("2026-09-01T00:00:00.000Z");

const withStubbedStudent = async (studentOverrides, assertions) => {
  const originals = {
    findOne: Student.findOne,
    treeFindOne: Tree.findOne,
    taskFindAll: StudentTask.findAll,
  };

  try {
    Student.findOne = async () => ({
      id: 26,
      userId: 50,
      organizationId: 11,
      classId: 4,
      xp: 40,
      treeProgress: 3,
      createdAt: STUDENT_ROW_CREATED_AT,
      user: {
        firstName: "Omar",
        lastName: "Ahmed",
        email: "omar@test.local",
        seenGuides: [],
        createdAt: USER_CREATED_AT,
      },
      ...studentOverrides,
    });
    Tree.findOne = async () => ({ id: 3, seeders: 1, water: 1, stage: 1, treeProgress: 3 });
    StudentTask.findAll = async () => [];

    const res = makeResponse();
    await studentData({ user: { id: 50, role: "Student" } }, res);
    await assertions(res);
  } finally {
    Student.findOne = originals.findOne;
    Tree.findOne = originals.treeFindOne;
    StudentTask.findAll = originals.taskFindAll;
  }
};

test("the Student profile exposes accountCreatedAt as an ISO string", async () => {
  await withStubbedStudent({}, (res) => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.accountCreatedAt, USER_CREATED_AT.toISOString());
  });
});

test("accountCreatedAt is the User row's timestamp, not the Student row's", async () => {
  await withStubbedStudent({}, (res) => {
    assert.equal(res.body.data.accountCreatedAt, "2026-03-01T09:15:00.000Z");
    assert.notEqual(
      res.body.data.accountCreatedAt,
      STUDENT_ROW_CREATED_AT.toISOString(),
    );
  });
});

test("a missing account timestamp is reported as null rather than invented", async () => {
  await withStubbedStudent(
    {
      user: {
        firstName: "Omar",
        lastName: "Ahmed",
        email: "omar@test.local",
        seenGuides: [],
      },
    },
    (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.accountCreatedAt, null);
    },
  );
});

test("the profile response still carries no security fields", async () => {
  await withStubbedStudent({}, (res) => {
    const serialized = JSON.stringify(res.body);
    ["password", "resetOTP", "otpExpiry", "tokenVersion", "pushSubscription"].forEach(
      (field) => assert.ok(!serialized.includes(field), `${field} must not be exposed`),
    );
  });
});
