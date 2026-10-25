const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const User = require("../dist/models/user.model").default;
const PlatformSetting = require("../dist/models/platform-setting.model").default;
const AdminAuditLog = require("../dist/models/admin-audit-log.model").default;
const policy = require("../dist/helpers/sessionPolicy");
const { signAccessToken, signRefreshToken } = require("../dist/helpers/tokens");
const { authenticateToken } = require("../dist/middleware/auth");
const { refreshAccessToken } = require("../dist/controllers/userController");
const { getSessionSettings, updateSessionSettings } = require("../dist/controllers/adminControlController");

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

const superReq = (extra = {}) => ({
  user: { id: 1, email: "super@example.invalid" },
  adminOrganizationId: null,
  params: {},
  body: {},
  query: {},
  ...extra,
});

const account = {
  id: 15,
  email: "student@example.com",
  role: "Student",
  tokenVersion: 3,
  isAccess: true,
  lastActiveAt: new Date(),
};

/** Runs `fn` with a saved policy and a known secret, then restores both. */
const withPolicy = async (saved, fn) => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = PlatformSetting.findByPk;
  const originalUpsert = PlatformSetting.upsert;
  process.env.JWT_SECRET = "session-policy-test-secret";
  PlatformSetting.upsert = async () => undefined;
  try {
    if (saved) await policy.saveSessionPolicy(saved);
    else policy.resetSessionPolicyCache();
    await fn();
  } finally {
    policy.resetSessionPolicyCache();
    PlatformSetting.findByPk = originalFindByPk;
    PlatformSetting.upsert = originalUpsert;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
};

test("validation accepts whole numbers inside the limits only", () => {
  assert.deepEqual(policy.validateSessionPolicy({ accessTokenMinutes: 30, refreshTokenDays: 90 }), {
    policy: { accessTokenMinutes: 30, refreshTokenDays: 90 },
  });
  for (const [body, field] of [
    [{ accessTokenMinutes: 4, refreshTokenDays: 90 }, "accessTokenMinutes"],
    [{ accessTokenMinutes: 1441, refreshTokenDays: 90 }, "accessTokenMinutes"],
    [{ accessTokenMinutes: 30.5, refreshTokenDays: 90 }, "accessTokenMinutes"],
    [{ accessTokenMinutes: "30", refreshTokenDays: 90 }, "accessTokenMinutes"],
    [{ accessTokenMinutes: 30, refreshTokenDays: 0 }, "refreshTokenDays"],
    [{ accessTokenMinutes: 30, refreshTokenDays: 731 }, "refreshTokenDays"],
    [{ accessTokenMinutes: 30 }, "refreshTokenDays"],
  ]) {
    assert.equal(policy.validateSessionPolicy(body).field, field, JSON.stringify(body));
  }
});

test("the environment lifetimes are the default until a policy is saved", () => {
  const access = process.env.ACCESS_TOKEN_TTL;
  const refresh = process.env.REFRESH_TOKEN_TTL;
  try {
    delete process.env.ACCESS_TOKEN_TTL;
    delete process.env.REFRESH_TOKEN_TTL;
    assert.deepEqual(policy.defaultSessionPolicy(), { accessTokenMinutes: 30, refreshTokenDays: 365 });
    process.env.ACCESS_TOKEN_TTL = "2h";
    process.env.REFRESH_TOKEN_TTL = "30d";
    assert.deepEqual(policy.defaultSessionPolicy(), { accessTokenMinutes: 120, refreshTokenDays: 30 });
    process.env.ACCESS_TOKEN_TTL = "nonsense";
    assert.equal(policy.defaultSessionPolicy().accessTokenMinutes, 30);
  } finally {
    if (access === undefined) delete process.env.ACCESS_TOKEN_TTL;
    else process.env.ACCESS_TOKEN_TTL = access;
    if (refresh === undefined) delete process.env.REFRESH_TOKEN_TTL;
    else process.env.REFRESH_TOKEN_TTL = refresh;
  }
});

test("new tokens carry the saved lifetimes", async () => {
  await withPolicy({ accessTokenMinutes: 10, refreshTokenDays: 7 }, async () => {
    const access = jwt.decode(signAccessToken(account));
    assert.equal(access.exp - access.iat, 10 * 60);
    const refresh = jwt.decode(signRefreshToken(account));
    assert.equal(refresh.exp - refresh.iat, 7 * 24 * 60 * 60);
  });
});

test("a shortened access lifetime expires older access tokens on their next use", async () => {
  const originalFindByPk = User.findByPk;
  User.findByPk = async () => ({ ...account });
  try {
    await withPolicy({ accessTokenMinutes: 5, refreshTokenDays: 30 }, async () => {
      // Signed 10 minutes ago with an hour's lifetime, under the old setting.
      const iat = Math.floor(Date.now() / 1000) - 10 * 60;
      const token = jwt.sign(
        { id: 15, email: account.email, role: account.role, tokenVersion: 3, iat, exp: iat + 3600 },
        process.env.JWT_SECRET,
      );
      const res = makeResponse();
      let nextCalled = false;
      await authenticateToken({ headers: { authorization: `Bearer ${token}` } }, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      // The client renews silently on this code rather than signing out.
      assert.equal(res.body.code, "TOKEN_EXPIRED");
    });
  } finally {
    User.findByPk = originalFindByPk;
  }
});

test("a shortened sign-in lifetime ends older sessions at renewal", async () => {
  const originalFindByPk = User.findByPk;
  User.findByPk = async () => ({ ...account });
  try {
    await withPolicy({ accessTokenMinutes: 30, refreshTokenDays: 1 }, async () => {
      const refreshToken = signRefreshToken(account);
      const payload = jwt.decode(refreshToken);
      // Re-sign the same payload as if issued two days ago under a longer setting.
      const iat = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
      const secret = process.env.REFRESH_TOKEN_SECRET || `${process.env.JWT_SECRET}_refresh`;
      const old = jwt.sign({ ...payload, iat, exp: iat + 365 * 24 * 60 * 60 }, secret);

      const res = makeResponse();
      await refreshAccessToken({ body: { refreshToken: old } }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, "SESSION_EXPIRED");

      const fresh = makeResponse();
      await refreshAccessToken({ body: { refreshToken } }, fresh);
      assert.equal(fresh.statusCode, 200);
    });
  } finally {
    User.findByPk = originalFindByPk;
  }
});

test("a Super Admin reads and saves the lifetimes, and the change is logged", async () => {
  const originalCreate = AdminAuditLog.create;
  let logged;
  AdminAuditLog.create = async (entry) => {
    logged = entry;
  };
  try {
    await withPolicy(null, async () => {
      let res = makeResponse();
      getSessionSettings(superReq(), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data.limits.accessTokenMinutes, { min: 5, max: 1440 });

      res = makeResponse();
      await updateSessionSettings(superReq({ body: { accessTokenMinutes: 15, refreshTokenDays: 60 } }), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data.policy, { accessTokenMinutes: 15, refreshTokenDays: 60 });
      assert.deepEqual(policy.getSessionPolicy(), { accessTokenMinutes: 15, refreshTokenDays: 60 });
      assert.equal(logged.action, "platform.session_policy");
      assert.deepEqual(logged.details.next, { accessTokenMinutes: 15, refreshTokenDays: 60 });

      res = makeResponse();
      await updateSessionSettings(superReq({ body: { accessTokenMinutes: 2, refreshTokenDays: 60 } }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.field, "accessTokenMinutes");
      assert.deepEqual(policy.getSessionPolicy(), { accessTokenMinutes: 15, refreshTokenDays: 60 });
    });
  } finally {
    AdminAuditLog.create = originalCreate;
  }
});

test("an unreadable saved policy falls back to the defaults", async () => {
  await withPolicy(null, async () => {
    PlatformSetting.findByPk = async () => ({ value: { accessTokenMinutes: "lots" } });
    assert.deepEqual(await policy.loadSessionPolicy(), policy.defaultSessionPolicy());
  });
});
