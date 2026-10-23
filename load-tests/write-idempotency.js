import http from "k6/http";
import { check } from "k6";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

// Test concurrent approval request racing
export const options = {
  vus: 50,
  iterations: 50, // 50 requests hitting simultaneously
  thresholds: {
    http_req_failed: ["rate<0.1"],
  },
};

export default function () {
  // Use student token 0 for all concurrent requests to test idempotency/concurrency race
  const token = tokens.studentTokens[0].token;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const payload = JSON.stringify({
    taskId: 1,
    todoItemId: 1,
  });

  const res = http.post(`${BASE_URL}/mission/requestApproval`, payload, { headers });
  // Allowed statuses: 201 (created first), 200 (reused existing), or 400 (already requested/pending)
  check(res, {
    "safe response (200, 201, or 400)": (r) =>
      r.status === 200 || r.status === 201 || r.status === 400,
    "no 500 crash": (r) => r.status < 500,
  });
}
