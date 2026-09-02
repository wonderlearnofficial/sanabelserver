const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const User = require("../dist/models/user.model").default;
const { authenticateToken } = require("../dist/middleware/auth");
const { refreshAccessToken } = require("../dist/controllers/userController");
const { signRefreshToken } = require("../dist/helpers/tokens");

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

test("authentication accepts a signed token only while its account exists", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "middleware-test-secret";
  User.findByPk = async () => ({
    id: 15,
    email: "student@example.com",
    role: "Student",
    tokenVersion: 3,
    isAccess: true,
  });

  try {
    const token = jwt.sign(
      {
        id: 15,
        email: "student@example.com",
        role: "Student",
        tokenVersion: 3,
      },
      process.env.JWT_SECRET,
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeResponse();
    let nextCalled = false;

    await authenticateToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.user.id, 15);
    assert.equal(res.statusCode, 200);
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("authentication immediately revokes an Admin token after the database role changes", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "middleware-test-secret";
  User.findByPk = async () => ({
    id: 31,
    email: "changed@example.com",
    role: "Student",
    tokenVersion: 0,
    isAccess: true,
  });

  try {
    const staleAdminToken = jwt.sign(
      {
        id: 31,
        email: "changed@example.com",
        role: "Admin",
        tokenVersion: 0,
      },
      process.env.JWT_SECRET,
    );
    const req = { headers: { authorization: `Bearer ${staleAdminToken}` } };
    const res = makeResponse();
    let nextCalled = false;

    await authenticateToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "ACCOUNT_CHANGED");
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("authentication revokes access tokens after a password/session version change", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "middleware-test-secret";
  User.findByPk = async () => ({
    id: 32,
    email: "password@example.com",
    role: "Parent",
    tokenVersion: 8,
    isAccess: true,
  });

  try {
    const oldToken = jwt.sign(
      {
        id: 32,
        email: "password@example.com",
        role: "Parent",
        tokenVersion: 7,
      },
      process.env.JWT_SECRET,
    );
    const req = { headers: { authorization: `Bearer ${oldToken}` } };
    const res = makeResponse();

    await authenticateToken(req, res, () => assert.fail("revoked token reached next middleware"));

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "SESSION_REVOKED");
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("authentication rejects a disabled account", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "middleware-test-secret";
  User.findByPk = async () => ({
    id: 33,
    email: "disabled@example.com",
    role: "Teacher",
    tokenVersion: 0,
    isAccess: false,
  });

  try {
    const token = jwt.sign(
      {
        id: 33,
        email: "disabled@example.com",
        role: "Teacher",
        tokenVersion: 0,
      },
      process.env.JWT_SECRET,
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeResponse();

    await authenticateToken(req, res, () => assert.fail("disabled account reached next middleware"));

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "ACCOUNT_DISABLED");
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("authentication logs out a still-open session after account deletion", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "middleware-test-secret";
  User.findByPk = async () => null;

  try {
    const token = jwt.sign({ id: 22, role: "Parent" }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeResponse();
    let nextCalled = false;

    await authenticateToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "ACCOUNT_DELETED");
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("refresh refuses to silently convert a stale Admin session into the new Student role", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousRefreshSecret = process.env.REFRESH_TOKEN_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "middleware-test-secret";
  process.env.REFRESH_TOKEN_SECRET = "middleware-refresh-test-secret";

  try {
    const staleAdminRefresh = signRefreshToken({
      id: 44,
      email: "role-change@example.com",
      role: "Admin",
      tokenVersion: 2,
    });
    User.findByPk = async () => ({
      id: 44,
      email: "role-change@example.com",
      role: "Student",
      tokenVersion: 2,
      isAccess: true,
    });

    const res = makeResponse();
    await refreshAccessToken({ body: { refreshToken: staleAdminRefresh } }, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "ACCOUNT_CHANGED");
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousRefreshSecret === undefined) delete process.env.REFRESH_TOKEN_SECRET;
    else process.env.REFRESH_TOKEN_SECRET = previousRefreshSecret;
  }
});
