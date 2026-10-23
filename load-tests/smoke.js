import http from "k6/http";
import { check, sleep } from "k6";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

export const options = {
  vus: 20,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"], // < 1% errors
    http_req_duration: ["p(95)<500"], // p95 < 500ms
  },
};

export default function () {
  // 1. Health check (Public)
  const resLive = http.get(`${BASE_URL}/health/live`);
  check(resLive, {
    "live status 200": (r) => r.status === 200,
  });

  // 2. Student Data (Authenticated Read)
  const studentToken = tokens.studentTokens[__VU % tokens.studentTokens.length].token;
  const resStudent = http.get(`${BASE_URL}/students/data`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  check(resStudent, {
    "student data 200": (r) => r.status === 200,
  });

  // 3. Super Admin Analytics (Heavy Analytics)
  const resOverview = http.get(`${BASE_URL}/admin/analytics/overview`, {
    headers: { Authorization: `Bearer ${tokens.superAdminToken}` },
  });
  check(resOverview, {
    "admin overview 200": (r) => r.status === 200,
  });

  sleep(1);
}
