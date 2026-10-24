const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../dist/models/user.model").default;

const {
  accountStatus,
  listSessions,
  setUserAccess,
  signOutEveryone,
  signOutUser,
  listAuditLog,
} = require("../dist/controllers/adminControlController");

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

// A Super Admin request (the routes are mounted behind requireSuperAdmin).
const superReq = (extra = {}) => ({
  user: { id: 1, email: "super@example.invalid" },
  adminOrganizationId: null,
  params: {},
  body: {},
  query: {},
  ...extra,
});

test("account status tells an admin's disable apart from an unverified email", () => {
  assert.equal(accountStatus({ isAccess: true, disabledAt: null }), "active");
  assert.equal(accountStatus({ isAccess: false, disabledAt: new Date() }), "disabled");
  assert.equal(accountStatus({ isAccess: false, disabledAt: null }), "unverified");
});

test("an admin cannot disable their own account", async () => {
  const res = makeResponse();
  await setUserAccess(superReq({ params: { userId: "1" }, body: { enabled: false } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /your own account/);
});

test("access changes require a boolean", async () => {
  const res = makeResponse();
  await setUserAccess(superReq({ params: { userId: "5" }, body: { enabled: "no" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, "enabled");
});

test("disabling ends every session and re-enabling only undoes a disable", async () => {
  let updated;
  const account = {
    id: 5,
    role: "Student",
    email: "s@example.invalid",
    tokenVersion: 3,
    disabledAt: null,
    isAccess: true,
    async update(values) {
      updated = values;
      Object.assign(this, values);
    },
  };
  User.findByPk = async () => account;

  // Enabling an account nobody disabled (e.g. an unverified signup) is refused.
  let res = makeResponse();
  await setUserAccess(superReq({ params: { userId: "5" }, body: { enabled: true } }), res);
  assert.equal(res.statusCode, 409);

  res = makeResponse();
  await setUserAccess(superReq({ params: { userId: "5" }, body: { enabled: false } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updated.isAccess, false);
  assert.ok(updated.disabledAt instanceof Date);
  assert.equal(updated.tokenVersion, 4);

  res = makeResponse();
  await setUserAccess(superReq({ params: { userId: "5" }, body: { enabled: true } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updated, { isAccess: true, disabledAt: null });
});

test("signing a user out bumps their token version", async () => {
  let updated;
  User.findByPk = async () => ({
    id: 6,
    role: "Teacher",
    tokenVersion: 0,
    async update(values) {
      updated = values;
    },
  });
  const res = makeResponse();
  await signOutUser(superReq({ params: { userId: "6" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updated, { tokenVersion: 1 });
});

test("signing everyone out needs an explicit confirmation", async () => {
  let incremented = false;
  User.increment = async () => {
    incremented = true;
  };
  const res = makeResponse();
  await signOutEveryone(superReq({ body: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(incremented, false);
});

test("session and log filters reject values they do not understand", async () => {
  let res = makeResponse();
  await listSessions(superReq({ query: { status: "sleeping" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, "status");

  res = makeResponse();
  await listAuditLog(superReq({ query: { from: "not a date" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, "from");
});
