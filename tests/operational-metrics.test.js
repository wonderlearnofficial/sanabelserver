const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getOperationalSnapshot,
  recordRequestMetric,
  resetOperationalMetricsForTests,
} = require("../dist/services/operationalMetrics");

test("operational metrics aggregate counts, errors and latency without request rows", () => {
  resetOperationalMetricsForTests();
  const now = Date.UTC(2026, 8, 2, 12, 0, 0);
  recordRequestMetric({ status: 200, durationMs: 10, path: "/students/data", at: now });
  recordRequestMetric({ status: 500, durationMs: 90, path: "/admin/users", at: now });
  recordRequestMetric({ status: 429, durationMs: 30, path: "/users/login", at: now });
  recordRequestMetric({ status: 401, durationMs: 20, path: "/users/session", at: now });

  const snapshot = getOperationalSnapshot(60, now);
  assert.equal(snapshot.coverage, "current_process_only");
  assert.equal(snapshot.requests, 4);
  assert.equal(snapshot.errors5xx, 1);
  assert.equal(snapshot.errors4xx, 2);
  assert.equal(snapshot.rateLimited, 1);
  // Only the 401 on /users/session counts. A 429 on /users/login is throttling,
  // already reported by `rateLimited`, and counting it here too would make the
  // two fields silently overlap; the 500 on /admin/users is not an auth outcome.
  assert.equal(snapshot.authFailures, 1);
  assert.equal(snapshot.averageLatencyMs, 37.5);
  assert.equal(snapshot.p95LatencyMs, 90);
  assert.equal(snapshot.buckets.length, 1);
});

test("auth failures count only 401/403 on authentication and admin paths", () => {
  resetOperationalMetricsForTests();
  const now = Date.UTC(2026, 8, 2, 13, 0, 0);
  recordRequestMetric({ status: 401, durationMs: 5, path: "/users/login", at: now });
  recordRequestMetric({ status: 403, durationMs: 5, path: "/admin/analytics/overview", at: now });
  // Throttling, not an auth decision.
  recordRequestMetric({ status: 429, durationMs: 5, path: "/users/login", at: now });
  // A 403 outside the authentication and admin surfaces.
  recordRequestMetric({ status: 403, durationMs: 5, path: "/mission/complete", at: now });

  const snapshot = getOperationalSnapshot(60, now);
  assert.equal(snapshot.authFailures, 2);
  assert.equal(snapshot.rateLimited, 1);
  assert.equal(snapshot.errors4xx, 4);
});

test("empty operational windows return null rates and latencies", () => {
  resetOperationalMetricsForTests();
  const snapshot = getOperationalSnapshot(60, Date.UTC(2026, 8, 2, 12, 0, 0));
  assert.equal(snapshot.requests, 0);
  assert.equal(snapshot.errorRate, null);
  assert.equal(snapshot.averageLatencyMs, null);
  assert.equal(snapshot.p95LatencyMs, null);
});
