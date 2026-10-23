import http from "k6/http";
import { check, sleep } from "k6";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: 50,
      stages: [
        { duration: "10s", target: 100 },   // baseline traffic
        { duration: "10s", target: 1000 },  // sudden burst 1
        { duration: "20s", target: 5000 },  // extreme spike
        { duration: "30s", target: 5000 },  // hold at peak
        { duration: "15s", target: 100 },   // traffic drops abruptly
        { duration: "15s", target: 100 },   // observe recovery
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"], // allow up to 5% during extreme spike transition
    http_req_duration: ["p(95)<4000"],
  },
};

export default function () {
  const studentObj = tokens.studentTokens[__VU % tokens.studentTokens.length];
  const headers = { Authorization: `Bearer ${studentObj.token}` };

  const res = http.get(`${BASE_URL}/students/data`, { headers });
  check(res, {
    "status 200": (r) => r.status === 200,
  });

  sleep(0.5);
}
