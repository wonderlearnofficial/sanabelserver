const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Class = require("../dist/models/class.model").default;

const {
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
});

test("dashboard stats for a school admin count only their school", async () => {
  const capturedWheres = [];
  Student.count = async (options) => {
    capturedWheres.push(options?.where);
    return 40;
  };
  Teacher.count = async () => 7;
  Class.count = async () => 4;
  Student.findAll = async () => [
    { ParentId: 1 },
    { ParentId: 1 },
    { ParentId: 2 },
  ];

  const res = makeResponse();
  await getAdminStats(scopedReq(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, {
    users: 40 + 7 + 2,
    students: 40,
    teachers: 7,
    parents: 2,
    organizations: 1,
    classes: 4,
  });
  assert.equal(capturedWheres[0].organizationId, 5);
});
