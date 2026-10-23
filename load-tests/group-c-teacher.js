import http from "k6/http";
import { check, sleep } from "k6";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

export const options = {
  stages: [
    { duration: "10s", target: 50 },
    { duration: "20s", target: 150 },
    { duration: "20s", target: 300 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export default function () {
  const tokenObj = tokens.teacherTokens[__VU % tokens.teacherTokens.length];
  const headers = { Authorization: `Bearer ${tokenObj.token}` };

  // 1. Classes overview
  const resClasses = http.get(`${BASE_URL}/teachers/appear-class`, { headers });
  check(resClasses, { "teacher classes 200": (r) => r.status === 200 });

  // 2. Pending approvals
  const resApprovals = http.get(`${BASE_URL}/teachers/pendingApprovals`, { headers });
  check(resApprovals, { "pending approvals 200": (r) => r.status === 200 });

  sleep(0.5);
}
