const test = require("node:test");
const assert = require("node:assert/strict");

// Security tests for the Super-Admin gate. Frontend hiding is not a control:
// these assert the middleware itself refuses every non-super-admin caller,
// including a school admin who knows the URL.

const Admin = require("../dist/models/admin.model").default;
const User = require("../dist/models/user.model").default;
const { requireSuperAdmin, checkAdmin } = require("../dist/middleware/checkrole");

const makeRes = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const run = async (middleware, req) => {
  const res = makeRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

const stub = ({ adminProfile = null, userRecord = null }) => {
  Admin.findOne = async () => adminProfile;
  User.findByPk = async () => userRecord;
};

test("super admin (Admins.organizationId IS NULL) is allowed through", async () => {
  stub({ adminProfile: { id: 1, organizationId: null }, userRecord: { id: 10, organizationId: null } });
  const { res, nextCalled } = await run(requireSuperAdmin, {
    user: { id: 10, role: "Admin" },
    adminOrganizationId: null,
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("school admin is refused with 403 even when the route is known", async () => {
  stub({ adminProfile: { id: 2, organizationId: 3 }, userRecord: { id: 11, organizationId: 3 } });
  const { res, nextCalled } = await run(requireSuperAdmin, {
    user: { id: 11, role: "Admin" },
    adminOrganizationId: 3,
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /Super Admin/i);
});

test("school admin cannot escalate by omitting the resolved scope field", async () => {
  // Simulates requireSuperAdmin mounted without checkAdmin ahead of it, or a
  // request object with no pre-resolved scope: it must re-resolve from Admins
  // rather than treating "undefined" as "no organization" (i.e. super admin).
  stub({ adminProfile: { id: 2, organizationId: 3 }, userRecord: { id: 11, organizationId: 3 } });
  const { res, nextCalled } = await run(requireSuperAdmin, { user: { id: 11, role: "Admin" } });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("school admin cannot escalate by sending organizationId in the request", async () => {
  stub({ adminProfile: { id: 2, organizationId: 3 }, userRecord: { id: 11, organizationId: 3 } });
  const { res, nextCalled } = await run(requireSuperAdmin, {
    user: { id: 11, role: "Admin", organizationId: null },
    body: { organizationId: null },
    query: { organizationId: null },
  });
  assert.equal(nextCalled, false, "scope must come from Admins, never from the request");
  assert.equal(res.statusCode, 403);
});

for (const role of ["Teacher", "Parent", "Student"]) {
  test(`${role} is refused with 403`, async () => {
    stub({ adminProfile: null, userRecord: { id: 12, organizationId: null } });
    const { res, nextCalled } = await run(requireSuperAdmin, { user: { id: 12, role } });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });
}

test("unauthenticated request is refused with 401", async () => {
  const { res, nextCalled } = await run(requireSuperAdmin, {});
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("checkAdmin resolves scope from Admins, not from Users", async () => {
  // Admins is authoritative: a stale Users.organizationId must not win.
  stub({ adminProfile: { id: 5, organizationId: 7 }, userRecord: { id: 20, organizationId: 99 } });
  const req = { user: { id: 20, role: "Admin" } };
  const { nextCalled } = await run(checkAdmin, req);
  assert.equal(nextCalled, true);
  assert.equal(req.adminOrganizationId, 7, "scope must come from the Admins row");
});

test("checkAdmin falls back to legacy user scope when no Admins row exists yet", async () => {
  // Transitional path: an admin created between the backfill and a later deploy
  // must not silently become a super admin.
  stub({ adminProfile: null, userRecord: { id: 21, organizationId: 4 } });
  const req = { user: { id: 21, role: "Admin" } };
  const { nextCalled } = await run(checkAdmin, req);
  assert.equal(nextCalled, true);
  assert.equal(req.adminOrganizationId, 4);
});
