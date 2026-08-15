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

test("liveness stays available while readiness rejects traffic before DB startup", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const live = await fetch(`${baseUrl}/health/live`);
    const ready = await fetch(`${baseUrl}/health/ready`);

    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {
      status: "not_ready",
      database: "disconnected",
    });
    assert.ok(ready.headers.get("x-request-id"));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
