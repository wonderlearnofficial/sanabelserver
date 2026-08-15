const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeLogValue } = require("../dist/config/logger");
const { runWithRequestContext, getRequestId } = require("../dist/config/requestContext");

test("logger keeps useful Error details and redacts sensitive metadata", () => {
  const error = new Error("database unavailable");
  error.code = "ECONNREFUSED";
  error.fields = { email: "person@example.com", classId: 4 };

  const sanitized = sanitizeLogValue({
    error,
    password: "secret-password",
    resetOTP: "123456",
    authorization: "Bearer private-token",
  });

  assert.equal(sanitized.error.name, "Error");
  assert.equal(sanitized.error.message, "database unavailable");
  assert.match(sanitized.error.stack, /database unavailable/);
  assert.equal(sanitized.error.code, "ECONNREFUSED");
  assert.equal(sanitized.error.fields.email, "[REDACTED]");
  assert.equal(sanitized.error.fields.classId, 4);
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.resetOTP, "[REDACTED]");
  assert.equal(sanitized.authorization, "[REDACTED]");
});

test("request IDs are available throughout async request work", async () => {
  await runWithRequestContext("request-123", async () => {
    await Promise.resolve();
    assert.equal(getRequestId(), "request-123");
  });
  assert.equal(getRequestId(), undefined);
});
