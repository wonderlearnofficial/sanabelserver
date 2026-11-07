const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../dist/models/user.model").default;
const AccountDeletionRequest = require("../dist/models/account-deletion-request.model").default;
const {
  createPublicRequest,
  createOwnRequest,
  updateRequest,
} = require("../dist/controllers/accountDeletionController");

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

const stub = (target, name, impl) => {
  const original = target[name];
  target[name] = impl;
  return () => {
    target[name] = original;
  };
};

test("public request rejects a missing name or a bad contact email", async () => {
  const created = [];
  const restore = stub(AccountDeletionRequest, "create", async (row) => created.push(row));
  try {
    for (const body of [
      { contactEmail: "a@b.co", accountIdentifier: "x" },
      { fullName: "Sara", contactEmail: "not-an-email", accountIdentifier: "x" },
      { fullName: "Sara", contactEmail: "a@b.co", accountIdentifier: "  " },
    ]) {
      const res = makeResponse();
      await createPublicRequest({ body }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(created.length, 0);
  } finally {
    restore();
  }
});

test("public request answers 202 the same for a matching and an unknown account", async () => {
  const rows = [];
  const restoreCreate = stub(AccountDeletionRequest, "create", async (row) => {
    rows.push(row);
    return { id: rows.length, ...row };
  });
  let known = true;
  const restoreFind = stub(User, "findOne", async () => (known ? { id: 7 } : null));
  try {
    const body = { fullName: "  Sara   Ali ", contactEmail: "SARA@Example.com", accountIdentifier: "sara1" };
    const first = makeResponse();
    await createPublicRequest({ body }, first);
    known = false;
    const second = makeResponse();
    await createPublicRequest({ body }, second);

    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.deepEqual(first.body, second.body);
    assert.equal(rows[0].userId, 7);
    assert.equal(rows[1].userId, null);
    assert.equal(rows[0].fullName, "Sara Ali");
    assert.equal(rows[0].contactEmail, "sara@example.com");
    assert.equal(rows[0].source, "web");
  } finally {
    restoreCreate();
    restoreFind();
  }
});

test("signed-in request needs a user, and a second one while one is open is not duplicated", async () => {
  const none = makeResponse();
  await createOwnRequest({ body: {} }, none);
  assert.equal(none.statusCode, 401);

  const rows = [];
  const restoreUser = stub(User, "findByPk", async () => ({
    id: 5, firstName: "Omar", lastName: "K", email: "omar@school.test", role: "Student",
  }));
  let open = null;
  const restoreFind = stub(AccountDeletionRequest, "findOne", async () => open);
  const restoreCreate = stub(AccountDeletionRequest, "create", async (row) => {
    rows.push(row);
    return { id: 1, ...row };
  });
  try {
    const first = makeResponse();
    await createOwnRequest({ user: { id: 5 }, body: {} }, first);
    assert.equal(first.statusCode, 201);
    assert.equal(rows[0].source, "app");
    assert.equal(rows[0].userId, 5);
    assert.equal(rows[0].accountType, "student");

    open = { id: 1 };
    const again = makeResponse();
    await createOwnRequest({ user: { id: 5 }, body: {} }, again);
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.alreadyRequested, true);
    assert.equal(rows.length, 1);
  } finally {
    restoreUser();
    restoreFind();
    restoreCreate();
  }
});

test("admin update accepts only known statuses and stamps who handled it", async () => {
  const bad = makeResponse();
  await updateRequest({ params: { id: "1" }, body: { status: "deleted" } }, bad);
  assert.equal(bad.statusCode, 400);

  let patch = null;
  const restore = stub(AccountDeletionRequest, "findByPk", async () => ({
    id: 1, userId: 9, update: async (value) => { patch = value; },
  }));
  try {
    const ok = makeResponse();
    await updateRequest({ params: { id: "1" }, body: { status: "done" }, user: { id: 2 } }, ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(patch.status, "done");
    assert.equal(patch.handledByUserId, 2);
    assert.ok(patch.handledAt instanceof Date);
  } finally {
    restore();
  }
});
