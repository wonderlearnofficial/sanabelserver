const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { createImpersonationHandoff } = require("../dist/controllers/adminController");
const { exchangeImpersonationHandoff } = require("../dist/controllers/userController");
const AdminImpersonationHandoff = require("../dist/models/admin-impersonation-handoff.model").default;
const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;

const makeRes = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("Super Admin -> valid Student -> handoff code created", async () => {
  const origFindStudent = Student.findOne;
  const origFindUser = User.findOne;
  const origCreateHandoff = AdminImpersonationHandoff.create;

  let createdPayload = null;

  try {
    Student.findOne = async () => ({
      id: 26,
      userId: 50,
      organizationId: 11,
      user: { id: 50, firstName: "Omar", lastName: "Ahmed", email: "omar@test.local", role: "Student" },
    });
    AdminImpersonationHandoff.create = async (data) => {
      createdPayload = data;
      return { id: 1, ...data };
    };

    const req = {
      user: { id: 1, email: "superadmin@test.local", role: "Admin" },
      adminOrganizationId: null, // Super Admin
      params: { studentId: "26" },
      body: {},
    };
    const res = makeRes();

    await createImpersonationHandoff(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body?.data?.code);
    assert.equal(res.body?.data?.ttlSeconds, 90);
    assert.equal(res.body?.data?.student?.name, "Omar Ahmed");

    // Verify DB payload properties:
    assert.ok(createdPayload);
    assert.equal(createdPayload.actorAdminUserId, 1);
    assert.equal(createdPayload.targetStudentId, 26);
    assert.equal(createdPayload.targetUserId, 50);
    assert.equal(createdPayload.organizationId, 11);
    assert.equal(createdPayload.usedAt, null);

    // Verify raw code is NOT stored in DB payload, only 64-char hex hash
    assert.equal(createdPayload.codeHash.length, 64);
    assert.notEqual(createdPayload.codeHash, res.body.data.code);
    assert.equal(
      crypto.createHash("sha256").update(res.body.data.code).digest("hex"),
      createdPayload.codeHash
    );
    // Verify no JWT, passwords, or tokens in DB record
    assert.equal(createdPayload.token, undefined);
    assert.equal(createdPayload.password, undefined);
    assert.equal(createdPayload.refreshToken, undefined);
  } finally {
    Student.findOne = origFindStudent;
    User.findOne = origFindUser;
    AdminImpersonationHandoff.create = origCreateHandoff;
  }
});

test("School Admin -> own-org Student -> code created", async () => {
  const origFindStudent = Student.findOne;
  const origCreateHandoff = AdminImpersonationHandoff.create;

  try {
    Student.findOne = async () => ({
      id: 26,
      userId: 50,
      organizationId: 11,
      user: { id: 50, firstName: "Omar", lastName: "Ahmed", email: "omar@test.local", role: "Student" },
    });
    AdminImpersonationHandoff.create = async (data) => ({ id: 2, ...data });

    const req = {
      user: { id: 2, email: "schooladmin@test.local", role: "Admin" },
      adminOrganizationId: 11, // School Admin scoped to Org 11
      params: { studentId: "26" },
      body: {},
    };
    const res = makeRes();

    await createImpersonationHandoff(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body?.data?.code);
  } finally {
    Student.findOne = origFindStudent;
    AdminImpersonationHandoff.create = origCreateHandoff;
  }
});

test("School Admin -> different-org Student -> 403 Forbidden", async () => {
  const origFindStudent = Student.findOne;

  try {
    Student.findOne = async () => ({
      id: 30,
      userId: 60,
      organizationId: 99, // Belongs to org 99
      user: { id: 60, firstName: "Other", lastName: "Student", email: "other@test.local", role: "Student" },
    });

    const req = {
      user: { id: 2, email: "schooladmin@test.local", role: "Admin" },
      adminOrganizationId: 11, // Scoped to Org 11
      params: { studentId: "30" },
      body: {},
    };
    const res = makeRes();

    await createImpersonationHandoff(req, res);

    assert.equal(res.statusCode, 403);
    assert.match(res.body?.message, /Forbidden/i);
  } finally {
    Student.findOne = origFindStudent;
  }
});

test("Unauthenticated request -> 401 Unauthorized", async () => {
  const req = {
    user: undefined,
    params: { studentId: "26" },
    body: {},
  };
  const res = makeRes();

  await createImpersonationHandoff(req, res);

  assert.equal(res.statusCode, 401);
});

test("Exchange: valid handoff code -> issues Student session", async () => {
  const rawCode = "test_code_1234567890abcdef1234567890abcdef";
  const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");

  const origUpdate = AdminImpersonationHandoff.update;
  const origFindHandoff = AdminImpersonationHandoff.findOne;
  const origFindUser = User.findByPk;
  const origFindStudent = Student.findByPk;
  const origFindChallenges = Challenge.findAll;
  const origFindStudentChallenges = StudentChallenge.findAll;

  try {
    AdminImpersonationHandoff.update = async () => [1]; // 1 row updated atomically
    AdminImpersonationHandoff.findOne = async () => ({
      id: 1,
      codeHash,
      actorAdminUserId: 1,
      targetUserId: 50,
      targetStudentId: 26,
      expiresAt: new Date(Date.now() + 60000),
      usedAt: new Date(),
    });
    User.findByPk = async () => ({
      id: 50,
      email: "omar@test.local",
      role: "Student",
      firstName: "Omar",
      lastName: "Ahmed",
      tokenVersion: 1,
    });
    Student.findByPk = async () => ({
      id: 26,
      userId: 50,
      organizationId: 11,
    });
    Challenge.findAll = async () => [];
    StudentChallenge.findAll = async () => [];

    const req = { body: { code: rawCode } };
    const res = makeRes();

    await exchangeImpersonationHandoff(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body?.data?.user?.token);
    assert.ok(res.body?.data?.user?.refreshToken);
    assert.equal(res.body?.data?.user?.role, "Student");
    assert.equal(res.body?.data?.user?.isImpersonated, true);
    assert.equal(res.body?.data?.user?.impersonatedByAdminId, 1);
  } finally {
    AdminImpersonationHandoff.update = origUpdate;
    AdminImpersonationHandoff.findOne = origFindHandoff;
    User.findByPk = origFindUser;
    Student.findByPk = origFindStudent;
    Challenge.findAll = origFindChallenges;
    StudentChallenge.findAll = origFindStudentChallenges;
  }
});

test("Exchange: expired code -> 401 CODE_EXPIRED", async () => {
  const rawCode = "expired_code_1234567890abcdef12345678";
  const origUpdate = AdminImpersonationHandoff.update;
  const origFindHandoff = AdminImpersonationHandoff.findOne;

  try {
    AdminImpersonationHandoff.update = async () => [0]; // 0 rows updated
    AdminImpersonationHandoff.findOne = async () => ({
      id: 2,
      usedAt: null,
      expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
    });

    const req = { body: { code: rawCode } };
    const res = makeRes();

    await exchangeImpersonationHandoff(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.code, "CODE_EXPIRED");
  } finally {
    AdminImpersonationHandoff.update = origUpdate;
    AdminImpersonationHandoff.findOne = origFindHandoff;
  }
});

test("Exchange: already used code -> 409 CODE_ALREADY_USED", async () => {
  const rawCode = "already_used_code_1234567890abcdef123";
  const origUpdate = AdminImpersonationHandoff.update;
  const origFindHandoff = AdminImpersonationHandoff.findOne;

  try {
    AdminImpersonationHandoff.update = async () => [0]; // 0 rows updated
    AdminImpersonationHandoff.findOne = async () => ({
      id: 3,
      usedAt: new Date(Date.now() - 10000), // Already used
      expiresAt: new Date(Date.now() + 50000),
    });

    const req = { body: { code: rawCode } };
    const res = makeRes();

    await exchangeImpersonationHandoff(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.code, "CODE_ALREADY_USED");
  } finally {
    AdminImpersonationHandoff.update = origUpdate;
    AdminImpersonationHandoff.findOne = origFindHandoff;
  }
});

test("Exchange: unknown code -> 401 INVALID_CODE", async () => {
  const rawCode = "unknown_code_1234567890abcdef12345678";
  const origUpdate = AdminImpersonationHandoff.update;
  const origFindHandoff = AdminImpersonationHandoff.findOne;

  try {
    AdminImpersonationHandoff.update = async () => [0];
    AdminImpersonationHandoff.findOne = async () => null; // Not found in DB

    const req = { body: { code: rawCode } };
    const res = makeRes();

    await exchangeImpersonationHandoff(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.code, "INVALID_CODE");
  } finally {
    AdminImpersonationHandoff.update = origUpdate;
    AdminImpersonationHandoff.findOne = origFindHandoff;
  }
});

test("Exchange concurrency: two simultaneous requests on same code -> exactly one succeeds", async () => {
  const rawCode = "concurrency_test_code_1234567890abcdef12";
  const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");

  const origUpdate = AdminImpersonationHandoff.update;
  const origFindHandoff = AdminImpersonationHandoff.findOne;
  const origFindUser = User.findByPk;
  const origFindStudent = Student.findByPk;
  const origFindChallenges = Challenge.findAll;
  const origFindStudentChallenges = StudentChallenge.findAll;

  let rowUsed = false;

  try {
    // Simulating database row-level locking: the first UPDATE sets usedAt, second sees usedAt!=null
    AdminImpersonationHandoff.update = async () => {
      if (!rowUsed) {
        rowUsed = true;
        return [1]; // First request successfully updates
      }
      return [0]; // Concurrent second request sees row already updated
    };

    AdminImpersonationHandoff.findOne = async () => ({
      id: 5,
      codeHash,
      actorAdminUserId: 1,
      targetUserId: 50,
      targetStudentId: 26,
      expiresAt: new Date(Date.now() + 60000),
      usedAt: new Date(),
    });

    User.findByPk = async () => ({
      id: 50,
      email: "omar@test.local",
      role: "Student",
      firstName: "Omar",
      lastName: "Ahmed",
      tokenVersion: 1,
    });
    Student.findByPk = async () => ({
      id: 26,
      userId: 50,
      organizationId: 11,
    });
    Challenge.findAll = async () => [];
    StudentChallenge.findAll = async () => [];

    const req1 = { body: { code: rawCode } };
    const req2 = { body: { code: rawCode } };
    const res1 = makeRes();
    const res2 = makeRes();

    // Fire both requests concurrently
    await Promise.all([
      exchangeImpersonationHandoff(req1, res1),
      exchangeImpersonationHandoff(req2, res2),
    ]);

    const results = [res1.statusCode, res2.statusCode].sort();
    assert.deepEqual(results, [200, 409], "Exactly one request must succeed (200) and one must fail (409)");
  } finally {
    AdminImpersonationHandoff.update = origUpdate;
    AdminImpersonationHandoff.findOne = origFindHandoff;
    User.findByPk = origFindUser;
    Student.findByPk = origFindStudent;
    Challenge.findAll = origFindChallenges;
    StudentChallenge.findAll = origFindStudentChallenges;
  }
});
