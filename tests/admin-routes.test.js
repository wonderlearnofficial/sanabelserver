const test = require("node:test");
const assert = require("node:assert/strict");

const { router } = require("../dist/routes/admin_routes");
const adminController = require("../dist/controllers/adminController");
const operationalAnalyticsController = require("../dist/controllers/operationalAnalyticsController");
const { authenticateToken } = require("../dist/middleware/auth");
const { checkAdmin, requireSuperAdmin } = require("../dist/middleware/checkrole");

// Route wiring, checked without a database.
//
// This suite exists because four admin operations handlers — import analytics,
// the school dashboard, and both data-quality endpoints — were fully written and
// exported while no route referenced them. The build passed, every other test
// passed, and the whole feature was simply unreachable. A handler that nothing
// routes is invisible to every other kind of test, so the wiring itself is
// asserted here.

const layers = () => router.stack.filter((layer) => layer.route);

const findRoute = (method, path) =>
  layers().find(
    (layer) => layer.route.path === path && layer.route.methods[method] === true,
  );

const handlersOf = (method, path) => {
  const layer = findRoute(method, path);
  assert.ok(layer, `${method.toUpperCase()} /admin${path} is not registered`);
  return layer.route.stack.map((entry) => entry.handle);
};

const assertGate = (method, path, { superAdmin }) => {
  const handlers = handlersOf(method, path);
  assert.ok(
    handlers.includes(authenticateToken),
    `${method.toUpperCase()} /admin${path} must authenticate`,
  );
  assert.ok(
    handlers.includes(checkAdmin),
    `${method.toUpperCase()} /admin${path} must resolve admin scope with checkAdmin`,
  );
  assert.equal(
    handlers.includes(requireSuperAdmin),
    superAdmin,
    superAdmin
      ? `${method.toUpperCase()} /admin${path} must be Super Admin only`
      : `${method.toUpperCase()} /admin${path} must stay open to a School Admin`,
  );
};

test("every admin operations handler is reachable through a route", () => {
  const routedHandlers = new Set(
    layers().flatMap((layer) => layer.route.stack.map((entry) => entry.handle)),
  );

  for (const name of [
    "getImportAnalytics",
    "getSchoolAdminDashboard",
    "getDataQuality",
    "getDataQualityDetail",
    "getLeaderboardSettings",
    "updateLeaderboardSettings",
  ]) {
    assert.ok(
      typeof adminController[name] === "function",
      `adminController.${name} is missing`,
    );
    assert.ok(
      routedHandlers.has(adminController[name]),
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
      routedHandlers.has(operationalAnalyticsController[name]),
      `operationalAnalyticsController.${name} is exported but no route mounts it`,
    );
  }
});

test("organization-scoped admin routes stay available to a School Admin", () => {
  // Scope is applied inside the handler from `Admins.organizationId`, resolved
  // by checkAdmin. These must NOT carry requireSuperAdmin: a School Admin is
  // entitled to their own organization's dashboard and import history.
  assertGate("get", "/school-dashboard", { superAdmin: false });
  assertGate("get", "/import-analytics", { superAdmin: false });
  assertGate("get", "/me", { superAdmin: false });
  assertGate("get", "/stats", { superAdmin: false });
  assertGate("get", "/students", { superAdmin: false });
  assertGate("get", "/classes", { superAdmin: false });
  assertGate("get", "/grades", { superAdmin: false });
  assertGate("get", "/leaderboard-settings", { superAdmin: false });
  assertGate("get", "/leaderboard-settings/:orgId", { superAdmin: false });
  assertGate("put", "/leaderboard-settings/:orgId", { superAdmin: false });
});

test("global admin routes are gated to a Super Admin", () => {
  for (const path of [
    "/data-quality",
    "/data-quality/detail",
    "/analytics/overview",
    "/analytics/completions",
    "/analytics/missions",
    "/analytics/users",
    "/analytics/organizations",
    "/analytics/approvals",
    "/analytics/assignments",
    "/analytics/dashboard",
    "/analytics/activity",
    "/analytics/emails",
    "/analytics/imports",
    "/analytics/data-quality",
    "/analytics/system-health",
  ]) {
    assertGate("get", path, { superAdmin: true });
  }

  // Platform release configuration — force-update and maintenance mode — is
  // global state, so it is Super Admin only on both verbs.
  assertGate("get", "/app-version", { superAdmin: true });
  assertGate("put", "/app-version", { superAdmin: true });
});
