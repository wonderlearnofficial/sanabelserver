const test = require("node:test");
const assert = require("node:assert/strict");

const Student = require("../dist/models/student.model").default;
const Parent = require("../dist/models/parent.model").default;
const User = require("../dist/models/user.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const Task = require("../dist/models/task.model").default;
const Challenge = require("../dist/models/challenge.model").default;

const {
  searchStuentByCode,
  connectStudentToParent,
  appearStudentbyparent,
  addPros: parentAddPros,
} = require("../dist/controllers/parentController");

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

const fakeTransaction = { transaction: async (work) => work({ fake: "tx" }) };
Object.defineProperty(Student, "sequelize", {
  value: fakeTransaction,
  configurable: true,
});

test("search student by link code finds student with profile details", async () => {
  const parent = { id: 7, userId: 100 };
  Parent.findOne = async () => parent;

  const mockStudent = {
    id: 15,
    connectCode: "SNB-1234",
    user: {
      firstName: "أحمد",
      lastName: "علي",
      profileImg: "avatar.png",
    },
  };

  Student.findOne = async (options) => {
    if (options?.where?.connectCode === "SNB-1234") return mockStudent;
    return null;
  };

  // Valid code
  const resValid = makeResponse();
  await searchStuentByCode({ user: { id: 100 }, params: { code: "SNB-1234" } }, resValid);
  assert.equal(resValid.statusCode, 200);
  assert.equal(resValid.body.data.connectCode, "SNB-1234");
  assert.equal(resValid.body.data.user.firstName, "أحمد");

  // Invalid / non-existent code
  const resInvalid = makeResponse();
  await searchStuentByCode({ user: { id: 100 }, params: { code: "WRONG-999" } }, resInvalid);
  assert.equal(resInvalid.statusCode, 404);
  assert.equal(resInvalid.body.message, "Student not found");
});

test("connect student to parent links student and protects against conflicting links", async () => {
  const parent = { id: 7, userId: 100 };
  Parent.findOne = async () => parent;

  const unlinkedStudent = {
    id: 20,
    connectCode: "ABC-5555",
    ParentId: null,
    async update(fields) {
      Object.assign(this, fields);
    },
  };

  Student.findOne = async (options) => {
    if (options?.where?.connectCode === "ABC-5555") return unlinkedStudent;
    return null;
  };

  // 1. Successful connection
  const resConnect = makeResponse();
  await connectStudentToParent(
    { user: { id: 100 }, body: { code: "ABC-5555" } },
    resConnect
  );
  assert.equal(resConnect.statusCode, 200);
  assert.equal(resConnect.body.message, "Student connected to parent successfully");
  assert.equal(unlinkedStudent.ParentId, 7);

  // 2. Connecting already-linked student to the same parent is idempotent (200)
  const resAlreadySame = makeResponse();
  await connectStudentToParent(
    { user: { id: 100 }, body: { code: "ABC-5555" } },
    resAlreadySame
  );
  assert.equal(resAlreadySame.statusCode, 200);
  assert.equal(resAlreadySame.body.message, "Student is already connected to this parent");

  // 3. Connecting to another parent is rejected with 409
  unlinkedStudent.ParentId = 999; // Different parent
  const resConflict = makeResponse();
  await connectStudentToParent(
    { user: { id: 100 }, body: { code: "ABC-5555" } },
    resConflict
  );
  assert.equal(resConflict.statusCode, 409);
  assert.equal(resConflict.body.message, "Student is already connected to another parent");
});

test("parent addPros awards points only to their own linked children", async () => {
  const parent = { id: 7, userId: 100 };
  Parent.findOne = async () => parent;

  const ownChild = {
    id: 20,
    ParentId: 7,
    xp: 10,
    snabelRed: 5,
    snabelBlue: 5,
    snabelYellow: 5,
    async save() {},
  };

  const otherChild = {
    id: 30,
    ParentId: 8, // Different parent
  };

  // Case A: Request includes a student that does NOT belong to parent -> 403 Forbidden
  Student.findAll = async () => [otherChild];
  const resForbidden = makeResponse();
  await parentAddPros(
    {
      user: { id: 100 },
      body: {
        taskId: 1,
        studentIds: [30],
        time: "14:00",
      },
    },
    resForbidden
  );
  assert.equal(resForbidden.statusCode, 403);
  assert.equal(resForbidden.body.message, "Some students do not belong to the requesting parent");

  // Case B: Request for own child succeeds and awards points
  Student.findAll = async () => [ownChild];
  StudentTask.findAll = async () => []; // Not completed today
  StudentTask.create = async (record) => record;
  Task.findOne = async () => ({
    id: 1,
    title: "مساعدة الوالدين",
    xp: 15,
    snabelRed: 5,
    snabelBlue: 5,
    snabelYellow: 5,
    taskCategory: { title: "بر الوالدين" },
  });
  Challenge.findAll = async () => [];
  StudentChallenge.findAll = async () => [];

  const resSuccess = makeResponse();
  await parentAddPros(
    {
      user: { id: 100 },
      body: {
        taskId: 1,
        studentIds: [20],
        time: "14:00",
      },
    },
    resSuccess
  );

  assert.equal(resSuccess.statusCode, 201);
  assert.equal(resSuccess.body.message, "Student tasks recorded successfully");
  assert.equal(ownChild.xp, 25); // 10 + 15
});
