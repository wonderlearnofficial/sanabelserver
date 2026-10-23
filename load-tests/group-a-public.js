import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

// Measure pure Node/Express/Network ceiling without DB bottleneck
export const options = {
  scenarios: {
    public_ramp: {
      executor: "ramping-vus",
      startVUs: 50,
      stages: [
        { duration: "15s", target: 500 },
        { duration: "15s", target: 1000 },
        { duration: "20s", target: 2500 },
        { duration: "20s", target: 5000 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/health/live`);
  check(res, {
    "status is 200": (r) => r.status === 200,
  });
}
