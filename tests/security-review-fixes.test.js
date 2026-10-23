// Regression pins for the 2026-10-22 security review: connect-code search
// exposure + throttling, atomic OTP lockout, teacher detail scoping, Admin
// scope writes, paging bounds, email normalization, the fail-closed legacy
// admin fallback, signup-only OTP enablement and the completion id oracle.
const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Parent = require("../dist/models/parent.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Admin = require("../dist/models/admin.model").default;
const Class = require("../dist/models/class.model").default;
const Task = require("../dist/models/task.model").default;
const Organization = require("../dist/models/oraganization.model").default;

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

const fakeTransaction = (model) =>
  Object.defineProperty(model, "sequelize", {
    value: { transaction: async (work) => work({ fake: "tx" }) },
    configurable: true,
  });

// --- 1. connect-code search ------------------------------------------------

test("parent connect-code search returns display fields only and a generic 404", async () => {
  const { searchStuentByCode } = require("../dist/controllers/parentController");
  Parent.findOne = async () => ({ id: 7, userId: 100 });
  let options;
  Student.findOne = async (opts) => {
    options = opts;
    return null;
  };

  const res = makeResponse();
  await searchStuentByCode({ user: { id: 100 }, params: { code: "12345" } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Not found");
  const studentAttrs = options.attributes;
  assert.ok(Array.isArray(studentAttrs) && studentAttrs.length > 0, "explicit Student whitelist");
  for (const hidden of ["ParentId", "classId", "organizationId", "snabelRed", "snabelBlue", "snabelYellow", "userId"]) {
    assert.ok(!studentAttrs.includes(hidden), hidden);
  }
  for (const used of ["connectCode", "xp", "water", "seeders", "treeProgress"]) {
    assert.ok(studentAttrs.includes(used), used);
  }
  const userAttrs = options.include[0].attributes;
  assert.ok(!userAttrs.includes("dateOfBirth"));
  assert.ok(!userAttrs.includes("email"));
});

test("connect-code search is rate limited per authenticated user", async () => {
  const express = require("express");
  const { connectCodeSearchLimiter } = require("../dist/routes/parent_routes");
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers["x-user"]) };
    next();
  });
  app.get("/s", connectCodeSearchLimiter, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/s`;
    let last;
    for (let i = 0; i < 31; i += 1) last = await fetch(url, { headers: { "x-user": "1" } });
    assert.equal(last.status, 429);
    const other = await fetch(url, { headers: { "x-user": "2" } });
    assert.equal(other.status, 200, "budget is per user, not shared");
  } finally {
    server.close();
  }
});

// --- 2. OTP lockout --------------------------------------------------------

test("recordOtpFailure increments in the database and locks from the fresh row", async () => {
  const { recordOtpFailure, MAX_OTP_ATTEMPTS } = require("../dist/helpers/otpGuard");
  const calls = [];
  User.increment = async (fields, options) => calls.push(["increment", fields, options.where]);
  User.findByPk = async () => ({ id: 5, otpAttempts: MAX_OTP_ATTEMPTS });
  User.update = async (values, options) => calls.push(["update", values, options.where]);

  // A stale in-memory count must not matter: the row says the threshold is hit.
  const locked = await recordOtpFailure({ id: 5, otpAttempts: 0, update: async () => assert.fail("no read-modify-write") });

  assert.equal(locked, true);
  assert.deepEqual(calls[0], ["increment", { otpAttempts: 1 }, { id: 5 }]);
  assert.equal(calls[1][0], "update");
  assert.ok(calls[1][1].otpLockedUntil > new Date());
  assert.equal(calls[1][2].id, 5);
});

test("recordOtpFailure below the threshold only increments", async () => {
  const { recordOtpFailure } = require("../dist/helpers/otpGuard");
  let updated = false;
  User.increment = async () => {};
  User.findByPk = async () => ({ id: 5, otpAttempts: 1 });
  User.update = async () => {
    updated = true;
  };
  assert.equal(await recordOtpFailure({ id: 5 }), false);
  assert.equal(updated, false);
});

test("a locked user is rejected before the code is compared", async () => {
  const { verifyOTP } = require("../dist/controllers/userController");
  let touched = false;
  User.findOne = async () => ({
    id: 5,
    resetOTP: "1234",
    otpExpiry: new Date(Date.now() + 60000),
    otpLockedUntil: new Date(Date.now() + 60000),
    update: async () => {
      touched = true;
    },
  });
  const res = makeResponse();
  await verifyOTP({ body: { email: "a@example.com", otp: "1234" } }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(touched, false);
});

// --- 3. teacher student detail ---------------------------------------------

test("teacher without an organization gets 403 on student detail", async () => {
  const { appearStudentInDetails } = require("../dist/controllers/teacherController");
  Teacher.findOne = async () => ({ id: 4, userId: 300, organizationId: null });
  Student.findOne = async () => assert.fail("must not query students");
  const res = makeResponse();
  await appearStudentInDetails({ user: { id: 300 }, params: { studentId: "9" } }, res);
  assert.equal(res.statusCode, 403);
});

test("teacher student detail requires the student to be in one of the teacher's classes", async () => {
  const { appearStudentInDetails } = require("../dist/controllers/teacherController");
  Teacher.findOne = async () => ({ id: 4, userId: 300, organizationId: 5 });
  let classWhere;
  Class.findAll = async ({ where }) => {
    classWhere = where;
    return [{ id: 11 }, { id: 12 }];
  };
  let studentWhere;
  Student.findOne = async ({ where }) => {
    studentWhere = where;
    return null;
  };
  const res = makeResponse();
  await appearStudentInDetails({ user: { id: 300 }, params: { studentId: "9" } }, res);
  assert.deepEqual(classWhere, { teacherId: 4, organizationId: 5 });
  assert.equal(studentWhere.id, 9);
  assert.equal(studentWhere.organizationId, 5);
  const inList = Object.getOwnPropertySymbols(studentWhere.classId).map((s) => studentWhere.classId[s])[0];
  assert.deepEqual(inList, [11, 12]);
  assert.equal(res.statusCode, 404);

  Class.findAll = async () => [];
  Student.findOne = async () => assert.fail("no classes means no students");
  const res2 = makeResponse();
  await appearStudentInDetails({ user: { id: 300 }, params: { studentId: "9" } }, res2);
  assert.equal(res2.statusCode, 404);
});

// --- 4-6. admin controller -------------------------------------------------

test("super admin moving an Admin to a school writes the Admins row in the same transaction", async () => {
  const { updateUser } = require("../dist/controllers/adminController");
  fakeTransaction(User);
  let userUpdate;
  User.findByPk = async () => ({
    id: 40,
    role: "Admin",
    update: async (values, options) => {
      userUpdate = { values, options };
    },
  });
  Organization.findByPk = async (id) => (id === 55 ? { id: 55 } : null);
  let adminUpdate;
  let findOrCreateOptions;
  Admin.findOrCreate = async (options) => {
    findOrCreateOptions = options;
    return [
      {
        organizationId: null,
        update: async (values, opts) => {
          adminUpdate = { values, opts };
        },
      },
      false,
    ];
  };

  const res = makeResponse();
  await updateUser({ adminOrganizationId: null, params: { userId: "40" }, body: { organizationId: 55 } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(findOrCreateOptions.where, { userId: 40 });
  assert.ok(findOrCreateOptions.transaction);
  assert.equal(adminUpdate.values.organizationId, 55);
  assert.ok(adminUpdate.opts.transaction);
  assert.equal(userUpdate.values.organizationId, 55, "Users copy stays consistent");
});

test("super admin promoting a legacy Admin without a row creates it with the new scope", async () => {
  const { updateUser } = require("../dist/controllers/adminController");
  fakeTransaction(User);
  User.findByPk = async () => ({ id: 41, role: "Admin", update: async () => {} });
  let defaults;
  Admin.findOrCreate = async (options) => {
    defaults = options.defaults;
    return [{ organizationId: null, update: async () => assert.fail("created row needs no update") }, true];
  };
  const res = makeResponse();
  await updateUser({ adminOrganizationId: null, params: { userId: "41" }, body: { organizationId: null } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(defaults, { userId: 41, organizationId: null });
});

test("parsePagination rejects unsafe and non-numeric input", () => {
  const { parsePagination } = require("../dist/controllers/adminController");
  assert.deepEqual(parsePagination("1e400", "20"), { pageNum: 1, limitNum: 20, offset: 0 });
  assert.deepEqual(parsePagination("abc", "x"), { pageNum: 1, limitNum: 20, offset: 0 });
  assert.deepEqual(parsePagination("2.5", "-3"), { pageNum: 1, limitNum: 20, offset: 0 });
  const huge = parsePagination("99999999999999999999", "100");
  assert.equal(huge.pageNum, 1, "beyond safe integer falls back");
  const capped = parsePagination("5000000", "100");
  assert.equal(capped.pageNum, 100000);
  assert.ok(Number.isSafeInteger(capped.offset));
  assert.deepEqual(parsePagination("3", "1000"), { pageNum: 3, limitNum: 100, offset: 200 });
});

test("createUser trims and lowercases the email before lookup and create", async () => {
  const { createUser } = require("../dist/controllers/adminController");
  fakeTransaction(User);
  let lookupWhere;
  User.findOne = async ({ where }) => {
    lookupWhere = where;
    return null;
  };
  let createdEmail;
  User.create = async (values) => {
    createdEmail = values.email;
    return { id: 77, ...values };
  };
  Parent.create = async () => ({ id: 1 });
  const res = makeResponse();
  await createUser(
    { adminOrganizationId: null, body: { firstName: "P", email: "  Mixed.Case@Example.COM ", role: "Parent" } },
    res,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(lookupWhere.email, "mixed.case@example.com");
  assert.equal(createdEmail, "mixed.case@example.com");
});

// --- 8. checkAdmin legacy fallback -----------------------------------------

test("an Admin with no Admins row and no legacy organization fails closed", async () => {
  const { checkAdmin, requireSuperAdmin } = require("../dist/middleware/checkrole");
  Admin.findOne = async () => null;
  User.findByPk = async () => ({ id: 60, organizationId: null });
  for (const middleware of [checkAdmin, requireSuperAdmin]) {
    const res = makeResponse();
    let nextCalled = false;
    const req = { user: { id: 60, role: "Admin" } };
    await middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.notEqual(req.adminOrganizationId, null, "must never resolve to Super scope");
  }
});

// --- 9. signup-only OTP enablement -----------------------------------------

test("send-auth refuses a disabled account that already has a password", async () => {
  const { sendOtp } = require("../dist/controllers/authController");
  let touched = false;
  User.findOne = async () => ({
    id: 70,
    isAccess: false,
    password: "hash",
    update: async () => {
      touched = true;
    },
  });
  User.create = async () => assert.fail("must not create");
  const res = makeResponse();
  await sendOtp({ body: { email: "disabled@example.com" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(touched, false);
});

test("verfication-auth never enables an account that has a password", async () => {
  const { verifyOTP } = require("../dist/controllers/authController");
  let updated;
  User.findOne = async () => ({
    id: 70,
    isAccess: false,
    password: "hash",
    resetOTP: "1234",
    otpExpiry: new Date(Date.now() + 60000),
    otpLockedUntil: null,
    update: async (values) => {
      updated = values;
    },
  });
  const res = makeResponse();
  await verifyOTP({ body: { email: "disabled@example.com", otp: "1234" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(updated, undefined, "isAccess must not be set");
});

test("verfication-auth still enables a pending signup (no password)", async () => {
  const { verifyOTP } = require("../dist/controllers/authController");
  const updates = [];
  User.findOne = async () => ({
    id: 71,
    isAccess: false,
    password: null,
    resetOTP: "1234",
    otpExpiry: new Date(Date.now() + 60000),
    otpLockedUntil: null,
    update: async (values) => updates.push(values),
  });
  const res = makeResponse();
  await verifyOTP({ body: { email: "new@example.com", otp: "1234" } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(updates.some((values) => values.isAccess === true));
});

// --- 10. direct completion oracle ------------------------------------------

test("direct completion reports missing and foreign students identically", async () => {
  const { processDirectCompletionBatch } = require("../dist/services/directCompletionService");
  Task.findOne = async () => ({ id: 3 });
  Student.findOne = async ({ where }) => (where.id === 1 ? { id: 1, organizationId: 9 } : null);
  const result = await processDirectCompletionBatch({
    taskId: 3,
    studentIds: [1, 2],
    actorId: 4,
    actorType: "teacher",
    source: "teacher_direct",
    authorize: async () => false,
  });
  const [foreign, missing] = result.body.results;
  assert.deepEqual(foreign, { ...missing, studentId: 1 });
  assert.equal(missing.status, "unauthorized");
  assert.equal(result.body.summary.not_found, undefined);
});
