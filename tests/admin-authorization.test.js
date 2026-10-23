const test = require("node:test");
const assert = require("node:assert/strict");

const { router } = require("../dist/routes/admin_routes");
const adminController = require("../dist/controllers/adminController");
const operationalAnalyticsController = require("../dist/controllers/operationalAnalyticsController");
const { authenticateToken } = require("../dist/middleware/auth");
const { checkAdmin, requireSuperAdmin } = require("../dist/middleware/checkrole");

// The authorization matrix, asserted from the router itself.
//
// This suite exists because middleware is the whole of the access control here:
// every handler trusts `req.adminOrganizationId`, which only `checkAdmin` sets,
// and only `requireSuperAdmin` refuses a school-scoped admin. A route that loses
// one of those keeps compiling, keeps passing its own controller tests, and
// silently opens platform data to a School Admin.
//
// Live-database proof of the same boundaries is in `analytics.integration.test.js`.

const layers = () => router.stack.filter((layer) => layer.route);

const handlersOf = (method, path) => {
  const layer = layers().find(
    (entry) => entry.route.path === path && entry.route.methods[method] === true,
  );
  assert.ok(layer, `${method.toUpperCase()} /admin${path} is not registered`);
  return layer.route.stack.map((entry) => entry.handle);
};

/** Every route the platform exposes globally. A School Admin gets 403 on each. */
const SUPER_ADMIN_ONLY = [
  ["get", "/analytics/overview"],
  ["get", "/analytics/completions"],
  ["get", "/analytics/missions"],
  ["get", "/analytics/users"],
  ["get", "/analytics/organizations"],
  ["get", "/analytics/approvals"],
  ["get", "/analytics/assignments"],
  ["get", "/analytics/dashboard"],
  ["get", "/analytics/activity"],
  ["get", "/analytics/emails"],
  ["get", "/analytics/imports"],
  ["get", "/analytics/data-quality"],
  ["get", "/analytics/system-health"],
  ["get", "/data-quality"],
  ["get", "/data-quality/detail"],
  ["get", "/app-version"],
  ["put", "/app-version"],
  // Creating, renaming and deleting a school is platform management. Reading
  // one is not: the two organization GETs are school-scoped, below.
  ["post", "/organizations"],
  ["patch", "/organizations/:organizationId"],
  ["delete", "/organizations/:organizationId"],
];

/**
 * Routes a School Admin is entitled to.
 *
 * These must NOT carry `requireSuperAdmin`: the handler scopes them from
 * `Admins.organizationId` instead, which is what lets one endpoint serve both
 * kinds of admin without leaking between schools.
 */
const SCHOOL_SCOPED = [
  ["get", "/me"],
  ["get", "/stats"],
  ["get", "/school-dashboard"],
  ["get", "/school-data-quality"],
  ["get", "/import-analytics"],
  ["get", "/students"],
  ["get", "/students/:studentId"],
  ["patch", "/students/:studentId"],
  ["delete", "/students/:studentId"],
  ["get", "/teachers"],
  ["get", "/parents"],
  ["get", "/users"],
  ["post", "/users"],
  ["patch", "/users/:userId"],
  ["delete", "/users/:userId"],
  ["patch", "/users/:userId/reset-password"],
  ["get", "/classes"],
  ["post", "/classes"],
  ["patch", "/classes/:classId"],
  ["delete", "/classes/:classId"],
  ["get", "/grades"],
  ["post", "/grades"],
  ["patch", "/grades/:gradeId"],
  ["delete", "/grades/:gradeId"],
  ["post", "/grades/import"],
  ["get", "/scores"],
  ["get", "/history"],
  ["get", "/organizations"],
  ["get", "/organizations/:organizationId"],
  ["post", "/impersonation"],
  ["get", "/leaderboard-settings"],
  ["get", "/leaderboard-settings/:orgId"],
  ["put", "/leaderboard-settings/:orgId"],
];

test("every admin route authenticates and resolves admin scope", () => {
  for (const layer of layers()) {
    const method = Object.keys(layer.route.methods)[0].toUpperCase();
    const handlers = layer.route.stack.map((entry) => entry.handle);
    const name = `${method} /admin${layer.route.path}`;

    assert.ok(handlers.includes(authenticateToken), `${name} must authenticate`);
    // Without checkAdmin the handler's `getAdminScope(req)` reads undefined and
    // falls back to null — which is Super Admin scope. A missing checkAdmin is
    // therefore a privilege escalation, not merely a missing check.
    assert.ok(handlers.includes(checkAdmin), `${name} must run checkAdmin`);
  }
});

test("global routes are Super Admin only", () => {
  for (const [method, path] of SUPER_ADMIN_ONLY) {
    assert.ok(
      handlersOf(method, path).includes(requireSuperAdmin),
      `${method.toUpperCase()} /admin${path} must refuse a School Admin`,
    );
  }
});

test("school-scoped routes stay open to a School Admin", () => {
  for (const [method, path] of SCHOOL_SCOPED) {
    assert.equal(
      handlersOf(method, path).includes(requireSuperAdmin),
      false,
      `${method.toUpperCase()} /admin${path} must not be Super Admin only`,
    );
  }
});

test("no admin route is left unclassified", () => {
  // Forces a decision on every new route: a route added without being listed
  // above fails here rather than shipping with an unreviewed gate.
  const classified = new Set(
    [...SUPER_ADMIN_ONLY, ...SCHOOL_SCOPED].map(([method, path]) => `${method} ${path}`),
  );
  const unclassified = [];
  for (const layer of layers()) {
    const method = Object.keys(layer.route.methods)[0];
    const key = `${method} ${layer.route.path}`;
    if (!classified.has(key)) unclassified.push(key);
  }

  // The two legacy impersonation aliases share `createImpersonationHandoff`
  // with `POST /impersonation`, which is classified above.
  assert.deepEqual(
    unclassified.sort(),
    ["post /impersonate-student/:studentId", "post /students/:studentId/impersonate"].sort(),
    `unclassified admin routes: ${unclassified.join(", ")}`,
  );
});

test("every operations handler is reachable through a route", () => {
  const routed = new Set(
    layers().flatMap((layer) => layer.route.stack.map((entry) => entry.handle)),
  );

  for (const name of [
    "getImportAnalytics",
    "getSchoolAdminDashboard",
    "getSchoolDataQuality",
    "getDataQuality",
    "getDataQualityDetail",
    "createImpersonationHandoff",
    "getLeaderboardSettings",
    "updateLeaderboardSettings",
  ]) {
    assert.ok(typeof adminController[name] === "function", `adminController.${name} is missing`);
    assert.ok(
      routed.has(adminController[name]),
      `adminController.${name} is exported but no route mounts it`,
    );
  }

  for (const name of [
    "dashboard",
    "activity",
    "emails",
    "imports",
    "dataQuality",
    "systemHealth",
  ]) {
    assert.ok(
      routed.has(operationalAnalyticsController[name]),
      `operationalAnalyticsController.${name} is exported but no route mounts it`,
    );
  }
});

test("the school warnings endpoint is not the global one in disguise", () => {
  // Two distinct handlers on two distinct routes. Serving the global query to a
  // School Admin and filtering it in the browser would not be a scope boundary.
  assert.notEqual(
    adminController.getSchoolDataQuality,
    adminController.getDataQuality,
    "school and global data quality must be separate handlers",
  );
  assert.ok(handlersOf("get", "/school-data-quality").includes(adminController.getSchoolDataQuality));
  assert.ok(handlersOf("get", "/data-quality").includes(adminController.getDataQuality));
});
