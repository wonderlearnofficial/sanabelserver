// Production app wiring: trust proxy for per-client rate limits, and the
// testing-phase /dev/test-accounts exception while passwordless /dev routes
// stay unmounted. Runs in its own process with NODE_ENV=production.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "production";
process.env.DB_SYNC_ON_STARTUP = "false";
process.env.MYSQL_DB_NAME = process.env.MYSQL_DB_NAME || "health_test";
process.env.MYSQL_DB_USER = process.env.MYSQL_DB_USER || "test";
process.env.MYSQL_DB_PASS = process.env.MYSQL_DB_PASS || "test";
process.env.MYSQL_DB_HOST = process.env.MYSQL_DB_HOST || "localhost";
process.env.MYSQL_DB_PORT = process.env.MYSQL_DB_PORT || "3306";

const { app } = require("../dist/index");
const User = require("../dist/models/user.model").default;
const Organization = require("../dist/models/oraganization.model").default;
const Grade = require("../dist/models/grade.model").default;
const Class = require("../dist/models/class.model").default;

test("Express trusts exactly one proxy hop (Railway)", () => {
  assert.equal(app.get("trust proxy"), 1);
});

test("production serves GET /dev/test-accounts without passwords but not login-as or users", async () => {
  Organization.findOne = async () => ({ id: 1, name: "Sanabel Test School" });
  Grade.findOne = async () => null;
  Class.findOne = async () => null;
  User.findOne = async ({ where }) =>
    where.email === "admin.test@sanabel.local"
      ? { id: 2, firstName: "A", lastName: "T", email: where.email, password: "hash" }
      : null;
  require("../dist/models/admin.model").default.findOne = async () => ({ id: 3 });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const accounts = await fetch(`${base}/dev/test-accounts`);
    assert.equal(accounts.status, 200);
    const body = await accounts.json();
    assert.equal(body.data.isProduction, true);
    assert.equal(body.data.admin.email, "admin.test@sanabel.local");
    assert.ok(!JSON.stringify(body).includes("password"), "no password field");
    assert.ok(!JSON.stringify(body).includes("hash"));

    assert.equal((await fetch(`${base}/dev/users`)).status, 404);
    assert.equal((await fetch(`${base}/dev/login-as/2`, { method: "POST" })).status, 404);
  } finally {
    server.close();
  }
});
