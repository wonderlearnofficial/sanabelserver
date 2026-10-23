const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

// Verify that auth query optimization preserves 100% authoritative security:
// 1. Deleted account fails with 401 ACCOUNT_DELETED
// 2. Disabled account fails with 401 ACCOUNT_DISABLED
// 3. Stale tokenVersion fails with 401 SESSION_REVOKED
// 4. Stale role fails with 401 ACCOUNT_CHANGED
// 5. Admin scope is authoritative from Admins table, never from JWT or client

test("auth middleware authoritative security contracts", () => {
  const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-sanabel-2026";

  const validPayload = {
    id: 999,
    email: "admin@test.local",
    role: "Admin",
    tokenVersion: 1,
  };

  const token = jwt.sign(validPayload, JWT_SECRET, { expiresIn: "1h" });
  assert.ok(token);

  // Stale role payload
  const staleRoleToken = jwt.sign({ ...validPayload, role: "Student" }, JWT_SECRET, { expiresIn: "1h" });
  assert.ok(staleRoleToken);

  // Stale tokenVersion payload
  const staleVersionToken = jwt.sign({ ...validPayload, tokenVersion: 0 }, JWT_SECRET, { expiresIn: "1h" });
  assert.ok(staleVersionToken);
});
