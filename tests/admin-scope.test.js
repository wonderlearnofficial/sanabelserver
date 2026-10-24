const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Class = require("../dist/models/class.model").default;
const Parent = require("../dist/models/parent.model").default;

const {
  updateStudent,
  listUsers,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getOrganization,
  createUser,
  updateUser,
  resetUserPassword,
  listStudents,
  getAdminStats,
} = require("../dist/controllers/adminController");

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

// A request from a school admin locked to organization 5 (the middleware
// sets adminOrganizationId; null/absent = super admin).
const scopedReq = (extra = {}) => ({
  adminOrganizationId: 5,
  params: {},
  body: {},
  query: {},
  ...extra,
});

test("school admins cannot create, modify, or delete organizations", async () => {
  for (const handler of [createOrganization, updateOrganization, deleteOrganization]) {
    const res = makeResponse();
    await handler(scopedReq({ params: { organizationId: "5" }, body: { name: "x" } }), res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /School admins cannot/);
  }
});

test("school admins get 404 for other organizations, even their id guessing", async () => {
  const res = makeResponse();
  await getOrganization(scopedReq({ params: { organizationId: "9" } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Organization not found");
});

test("school admins cannot create admin accounts", async () => {
  const res = makeResponse();
  await createUser(
    scopedReq({
      body: { firstName: "X", email: "x@y.z", role: "Admin" },
    }),
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /cannot create admin/);
});

// Parents sign up and link their own children, so they are not school members.
test("school admins cannot create parent accounts", async () => {
  const res = makeResponse();
  await createUser(
    scopedReq({ body: { firstName: "X", email: "p@y.z", role: "Parent" } }),
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /cannot create parent/);
});

test("school admins cannot list parent accounts", async () => {
  const res = makeResponse();
  await listUsers(scopedReq({ query: { role: "Parent" } }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /cannot view parent/);
});

test("parent accounts look nonexistent to school admins in updateUser", async () => {
  Object.defineProperty(User, "sequelize", {
    value: { transaction: async (fn) => fn({ fake: "tx" }) },
    configurable: true,
  });
  User.findByPk = async () => ({ id: 7, role: "Parent" });

  const res = makeResponse();
  await updateUser(scopedReq({ params: { userId: "7" }, body: { firstName: "New" } }), res);
  assert.equal(res.statusCode, 404);
});

test("school admins cannot link a parent to a student", async () => {
  Object.defineProperty(User, "sequelize", {
    value: { transaction: async (fn) => fn({ fake: "tx" }) },
    configurable: true,
  });
  Student.findByPk = async () => ({ id: 3, organizationId: 5, userId: null });

  const res = makeResponse();
  await updateStudent(scopedReq({ params: { studentId: "3" }, body: { parentId: 2 } }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /cannot link parents/);
});

test("a super admin links and unlinks a student's parent", async () => {
  Object.defineProperty(User, "sequelize", {
    value: { transaction: async (fn) => fn({ fake: "tx" }) },
    configurable: true,
  });
  Student.findByPk = async () => ({ id: 3, organizationId: 5, userId: null });
  const updates = [];
  Student.update = async (values, options) => {
    updates.push({ values, where: options.where });
    return [1];
  };

  // Linking a parent that does not exist is refused, and nothing is written.
  Parent.findByPk = async () => null;
  let res = makeResponse();
  await updateStudent({ params: { studentId: "3" }, body: { parentId: 99 }, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(updates.length, 0);

  Parent.findByPk = async () => ({ id: 2 });
  res = makeResponse();
  await updateStudent({ params: { studentId: "3" }, body: { parentId: 2 }, query: {} }, res);
  assert.equal(res.statusCode, 200);

  res = makeResponse();
  await updateStudent({ params: { studentId: "3" }, body: { parentId: null }, query: {} }, res);
  assert.equal(res.statusCode, 200);

  assert.deepEqual(updates, [
    { values: { ParentId: 2 }, where: { id: 3 } },
    { values: { ParentId: null }, where: { id: 3 } },
  ]);
});

test("admin accounts look nonexistent to school admins in updateUser", async () => {
  Object.defineProperty(User, "sequelize", {
    value: { transaction: async (fn) => fn({ fake: "tx" }) },
    configurable: true,
  });
  User.findByPk = async () => ({ id: 1, role: "Admin" });

  const res = makeResponse();
  await updateUser(
    scopedReq({ params: { userId: "1" }, body: { firstName: "New" } }),
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "User not found");
});

test("out-of-school students look nonexistent to school admins in resetUserPassword", async () => {
  User.findByPk = async () => ({ id: 33, role: "Student" });
  Student.count = async () => 0; // no student row for userId 33 inside org 5

  const res = makeResponse();
  await resetUserPassword(scopedReq({ params: { userId: "33" } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "User not found");
});

test("listStudents is forced to the school scope regardless of query params", async () => {
  let captured;
  Student.findAndCountAll = async (options) => {
    captured = options;
    return { rows: [], count: 0 };
  };

  const res = makeResponse();
  // Attempted cross-school peek via query param must be overridden
  await listStudents(scopedReq({ query: { organizationId: "9" } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(captured.where.organizationId, 5);
  // A school admin's student rows never carry the linked parent.
  assert.equal(captured.include.some((entry) => entry.as === "Parent"), false);
});

test("listStudents includes the linked parent for a super admin", async () => {
  let captured;
  Student.findAndCountAll = async (options) => {
    captured = options;
    return { rows: [], count: 0 };
  };

  const res = makeResponse();
  await listStudents({ params: {}, body: {}, query: { organizationId: "9" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(captured.where.organizationId, 9);
  assert.equal(captured.include.some((entry) => entry.as === "Parent"), true);
});

test("dashboard stats for a school admin count only their school", async () => {
  const capturedWheres = [];
  Student.count = async (options) => {
    capturedWheres.push(options?.where);
    return 40;
  };
  Teacher.count = async () => 7;
  Class.count = async () => 4;

  const res = makeResponse();
  await getAdminStats(scopedReq(), res);

  assert.equal(res.statusCode, 200);
  // Parents are not school members, so a School Admin's counts leave them out.
  assert.deepEqual(res.body.data, {
    users: 40 + 7,
    students: 40,
    teachers: 7,
    organizations: 1,
    classes: 4,
  });
  assert.equal(capturedWheres[0].organizationId, 5);
});
