import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const TARGET_VUS = Number(__ENV.TARGET_VUS) || 100;
const SHARED_PASSWORD = "LoadTest#Sanabel2026!";

export const options = {
  vus: TARGET_VUS,
  iterations: TARGET_VUS, // 1 simultaneous login per VU
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<5000"],
  },
};

export default function () {
  // Rotate through seeded synthetic student accounts
  const studentIndex = (__VU % 500) + 1;
  const email = `load_student_${studentIndex}@sanabel.local`;

  const payload = JSON.stringify({
    email: email,
    password: SHARED_PASSWORD,
  });

  const headers = { "Content-Type": "application/json" };
  const res = http.post(`${BASE_URL}/users/login`, payload, { headers });

  check(res, {
    "login 200": (r) => r.status === 200,
    "has token": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Boolean(body.data?.user?.token);
      } catch (e) {
        return false;
      }
    },
  });
}
