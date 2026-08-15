const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const User = require("../dist/models/user.model").default;
const { authenticateToken } = require("../dist/middleware/auth");

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

test("authentication accepts a signed token only while its account exists", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "middleware-test-secret";
  User.findByPk = async () => ({ id: 15 });

  try {
    const token = jwt.sign({ id: 15, role: "Student" }, process.env.JWT_SECRET);
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
