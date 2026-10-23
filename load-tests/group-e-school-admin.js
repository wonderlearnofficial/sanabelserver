import http from "k6/http";
import { check, sleep } from "k6";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

export const options = {
  stages: [
    { duration: "10s", target: 20 },
    { duration: "20s", target: 50 },
    { duration: "20s", target: 100 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

export default function () {
  const tokenObj = tokens.schoolAdminTokens[__VU % tokens.schoolAdminTokens.length];
  const headers = { Authorization: `Bearer ${tokenObj.token}` };

  // 1. School Dashboard (multi-query counter aggregation)
  const resDash = http.get(`${BASE_URL}/admin/school-dashboard`, { headers });
  check(resDash, { "school dashboard 200": (r) => r.status === 200 });

  // 2. Students List
  const resStudents = http.get(`${BASE_URL}/admin/students?page=1&limit=25`, { headers });
  check(resStudents, { "school students 200": (r) => r.status === 200 });

  sleep(0.5);
}
