import http from "k6/http";
import { check, sleep } from "k6";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

export const options = {
  stages: [
    { duration: "10s", target: 50 },
    { duration: "20s", target: 200 },
    { duration: "30s", target: 500 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export default function () {
  const tokenObj = tokens.studentTokens[__VU % tokens.studentTokens.length];
  const headers = { Authorization: `Bearer ${tokenObj.token}` };

  // 1. Profile / Data
  const resData = http.get(`${BASE_URL}/students/data`, { headers });
  check(resData, { "student data 200": (r) => r.status === 200 });

  // 2. To-Do list
  const resTodo = http.get(`${BASE_URL}/mission/todo`, { headers });
  check(resTodo, { "student todo 200": (r) => r.status === 200 });

  // 3. Trophies / Challenges
  const resChallenges = http.get(`${BASE_URL}/mission/appearChallangesPrimaire`, { headers });
  check(resChallenges, { "challenges 200": (r) => r.status === 200 });

  sleep(0.5);
}
