import http from "k6/http";
import { check, sleep } from "k6";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "20s", target: 30 },
    { duration: "20s", target: 50 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
  },
};

export default function () {
  const headers = { Authorization: `Bearer ${tokens.superAdminToken}` };

  // 1. Overview Analytics
  const resOverview = http.get(`${BASE_URL}/admin/analytics/overview`, { headers });
  check(resOverview, { "analytics overview 200": (r) => r.status === 200 });

  // 2. Missions Analytics
  const resMissions = http.get(`${BASE_URL}/admin/analytics/missions`, { headers });
  check(resMissions, { "analytics missions 200": (r) => r.status === 200 });

  // 3. Completions Analytics (paginated)
  const resCompletions = http.get(`${BASE_URL}/admin/analytics/completions?limit=25`, { headers });
  check(resCompletions, { "analytics completions 200": (r) => r.status === 200 });

  sleep(1);
}
