// Regression pins for the 2026-10-22 findings (test/findings/*.md):
// parent IDOR, leaderboard field leaks, Admin creation scope, list paging and
// query validation, login input handling, token status codes, /dev gating.
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Parent = require("../dist/models/parent.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Admin = require("../dist/models/admin.model").default;
const Organization = require("../dist/models/oraganization.model").default;

const parentController = require("../dist/controllers/parentController");
const { appearLeaderboard } = require("../dist/controllers/studentController");
const { createUser, listUsers, listStudents } = require("../dist/controllers/adminController");
const { login } = require("../dist/controllers/userController");
const { authenticateToken } = require("../dist/middleware/auth");
const { isDevEnvironment } = require("../dist/controllers/devController");

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

const attributeNames = (attributes) => (Array.isArray(attributes) ? attributes : []);

test("parent student detail is limited to the parent's own linked children", async () => {
  Parent.findOne = async () => ({ id: 7, userId: 100 });
  let seenWhere;
  Student.findOne = async ({ where }) => {
    seenWhere = where;
    return null; // student 592 is linked to another parent
  };

  const res = makeResponse();
  await parentController.appearStudentInDetails(
    { user: { id: 100 }, params: { studentId: "592" } },
    res,
  );

  assert.equal(seenWhere.id, 592);
  assert.equal(seenWhere.ParentId, 7);
  assert.equal(res.statusCode, 404);
});

test("parent leaderboard exposes display fields only (no connectCode, no email)", async () => {
  Parent.findOne = async () => ({ id: 7, userId: 100 });
  let options;
  Student.findAll = async (opts) => {
    options = opts;
    return [];
  };

  const res = makeResponse();
  await parentController.parentLeaderboard({ user: { id: 100 }, query: {} }, res);

  assert.equal(res.statusCode, 200);
  const studentAttrs = attributeNames(options.attributes);
  assert.ok(studentAttrs.length > 0, "Student attributes must be an explicit whitelist");
  assert.ok(!studentAttrs.includes("connectCode"));
  for (const field of ["id", "userId", "xp"]) assert.ok(studentAttrs.includes(field), field);
  const userAttrs = attributeNames(options.include[0].attributes);
  assert.ok(!userAttrs.includes("email"));
  assert.ok(userAttrs.includes("firstName") && userAttrs.includes("profileImg"));
});

test("student/teacher leaderboard: valid order and no private fields", async () => {
  User.findByPk = async () => ({ id: 200 });
  Teacher.findOne = async () => null;
  Student.findOne = async () => ({ id: 3, userId: 200, organizationId: null, classId: null });
  let options;
  Student.findAll = async (opts) => {
    options = opts;
    return [];
  };

  const res = makeResponse();
  await appearLeaderboard({ user: { id: 200 }, query: { limit: "abc" } }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(!options.order.some(([column]) => column === "missionsDone"));
  assert.deepEqual(options.order[0], ["xp", "DESC"]);
  assert.ok(Number.isFinite(options.limit), "a non-numeric limit must not become NaN");
  const studentAttrs = attributeNames(options.attributes);
  assert.ok(studentAttrs.length > 0 && !studentAttrs.includes("connectCode"));
  const userInclude = options.include.find((inc) => inc.as === "user");
  assert.ok(!attributeNames(userInclude.attributes).includes("email"));
});

const stubAccountCreation = () => {
  const created = { admins: [], users: [] };
  User.findOne = async () => null;
  Object.defineProperty(User, "sequelize", {
    value: { transaction: async (work) => work({ fake: "tx" }) },
    configurable: true,
  });
  User.create = async (values) => {
    const record = { id: 900 + created.users.length, ...values };
    created.users.push(record);
    return record;
  };
  Admin.create = async (values, options) => {
    created.admins.push({ values, options });
    return { id: 1, ...values };
  };
  Organization.findByPk = async (id) => (id === 55 ? { id: 55 } : null);
  return created;
};

test("super admin creating a School Admin writes the Admins row with that organization", async () => {
  const created = stubAccountCreation();
  const res = makeResponse();
  await createUser(
    {
      adminOrganizationId: null,
      body: { firstName: "School", email: "school.admin@example.com", role: "Admin", organizationId: 55 },
    },
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(created.admins.length, 1);
  assert.equal(created.admins[0].values.organizationId, 55);
  assert.equal(created.admins[0].values.userId, created.users[0].id);
  assert.ok(created.admins[0].options.transaction, "Admins row must join the User transaction");
  assert.equal(created.users[0].organizationId, 55);
});

test("an Admin created without an organization is an explicit Super Admin row", async () => {
  const created = stubAccountCreation();
  const res = makeResponse();
  await createUser(
    { adminOrganizationId: null, body: { firstName: "Root", email: "root@example.com", role: "Admin" } },
    res,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(created.admins.length, 1);
  assert.equal(created.admins[0].values.organizationId, null);
});

test("Admin creation for a missing organization is refused before anything is written", async () => {
  const created = stubAccountCreation();
  const res = makeResponse();
  await createUser(
    {
      adminOrganizationId: null,
      body: { firstName: "X", email: "x@example.com", role: "Admin", organizationId: 999 },
    },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(created.users.length, 0);
  assert.equal(created.admins.length, 0);
});

test("createUser answers 400 naming the field for an invalid email", async () => {
  const created = stubAccountCreation();
  const res = makeResponse();
  await createUser(
    { adminOrganizationId: 5, body: { firstName: "A", email: "not-an-email", role: "Student" } },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, "email");
  assert.equal(created.users.length, 0);
});

test("createUser maps a model validation error to 400 instead of 500", async () => {
  stubAccountCreation();
  User.create = async () => {
    const error = new Error("Validation error");
    error.name = "SequelizeValidationError";
    error.errors = [{ message: "Validation isEmail on email failed", path: "email" }];
    throw error;
  };
  const res = makeResponse();
  await createUser(
    { adminOrganizationId: null, body: { firstName: "P", email: "p@example.com", role: "Parent" } },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, "email");
});

test("admin lists clamp page and limit", async () => {
  let options;
  User.findAndCountAll = async (opts) => {
    options = opts;
    return { rows: [], count: 0 };
  };

  let res = makeResponse();
  await listUsers({ adminOrganizationId: null, query: { limit: "100000" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(options.limit, 100);
  assert.equal(res.body.limit, 100);

  res = makeResponse();
  await listUsers({ adminOrganizationId: null, query: { page: "-1", limit: "-5" } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(options.limit >= 1 && options.limit <= 100);
  assert.equal(options.offset, 0);
  assert.equal(res.body.page, 1);
});

test("admin lists reject an unknown role filter and non-numeric id filters with 400", async () => {
  let res = makeResponse();
  await listUsers({ adminOrganizationId: null, query: { role: "'x" } }, res);
  assert.equal(res.statusCode, 400);

  let queried = false;
  Student.findAndCountAll = async () => {
    queried = true;
    return { rows: [], count: 0 };
  };
  for (const query of [{ organizationId: "abc" }, { organizationId: "1 OR 1=1" }, { gradeId: "abc" }]) {
    res = makeResponse();
    await listStudents({ adminOrganizationId: null, query }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
  }
  assert.equal(queried, false);
});

test("login validates input and handles an account with no password set", async () => {
  let res = makeResponse();
  await login({ body: {} }, res);
  assert.equal(res.statusCode, 400);

  res = makeResponse();
  await login({ body: { email: "a@example.com", password: "" } }, res);
  assert.equal(res.statusCode, 400);

  User.findOne = async () => ({ id: 1, email: "half@example.com", isAccess: true, password: null });
  res = makeResponse();
  await login({ body: { email: "half@example.com", password: "whatever1" } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "ACCOUNT_SETUP_INCOMPLETE");
  assert.equal(res.body.error, undefined);
});

test("a malformed or forged bearer token is 401 TOKEN_INVALID", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "security-fixes-secret";
  try {
    for (const token of ["not.a.jwt", jwt.sign({ id: 1, role: "Student" }, "some-other-secret")]) {
      const res = makeResponse();
      let nextCalled = false;
      await authenticateToken({ headers: { authorization: `Bearer ${token}` } }, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, "TOKEN_INVALID");
    }
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("/dev is enabled only for an explicit development or test NODE_ENV", () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const [value, expected] of [
      ["development", true],
      ["test", true],
      ["production", false],
      ["staging", false],
      [undefined, false],
    ]) {
      if (value === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = value;
      assert.equal(isDevEnvironment(), expected, String(value));
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("teacher class roster and classes-by-grade reject non-numeric ids with 400", async () => {
  const { appearStudentByclass, getClassesByGrade } = require("../dist/controllers/teacherController");
  Teacher.findOne = async () => ({ id: 4, userId: 300, organizationId: 5 });
  Student.findOne = async () => null;

  for (const classId of ["abc", "1 OR 1=1"]) {
    const res = makeResponse();
    await appearStudentByclass({ user: { id: 300 }, params: { classId } }, res);
    assert.equal(res.statusCode, 400, classId);
  }

  const res = makeResponse();
  await getClassesByGrade({ user: { id: 300 }, query: { gradeId: "abc" } }, res);
  assert.equal(res.statusCode, 400);
});

test("app version answers platform=web as web", async () => {
  const AppConfig = require("../dist/models/app-config.model").default;
  const { getAppVersion } = require("../dist/controllers/appConfigController");
  AppConfig.findOne = async () => null;
  const res = makeResponse();
  await getAppVersion({ query: { platform: "web" } }, res);
  assert.equal(res.body.platform, "web");
});
