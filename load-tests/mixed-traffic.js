import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const tokens = JSON.parse(open("./tokens.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

// Custom metrics by category
const studentLatency = new Trend("latency_student_reads");
const teacherLatency = new Trend("latency_teacher_reads");
const parentLatency = new Trend("latency_parent_reads");
const writeLatency = new Trend("latency_writes");
const schoolAdminLatency = new Trend("latency_school_admin");
const superAdminLatency = new Trend("latency_super_admin");

// Configurable target VUs (default 500 for ramp or 5,000 for peak)
const TARGET_VUS = Number(__ENV.TARGET_VUS) || 1000;
const DURATION = __ENV.DURATION || "60s";

function getStages(targetVus, duration) {
  if (targetVus <= 100) {
    return [
      { duration: "5s", target: targetVus },
      { duration: duration, target: targetVus },
      { duration: "5s", target: 0 },
    ];
  }
  if (targetVus <= 1000) {
    return [
      { duration: "10s", target: targetVus },
      { duration: duration, target: targetVus },
      { duration: "10s", target: 0 },
    ];
  }
  return [
    { duration: "10s", target: 1000 },
    { duration: "15s", target: targetVus },
    { duration: duration, target: targetVus },
    { duration: "10s", target: 0 },
  ];
}

export const options = {
  scenarios: {
    mixed_traffic: {
      executor: "ramping-vus",
      startVUs: Math.min(10, TARGET_VUS),
      stages: getStages(TARGET_VUS, DURATION),
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"], // < 2% total errors
    http_req_duration: ["p(95)<3000"], // p95 < 3s under high load
  },
};

export default function () {
  // Randomly distribute according to traffic mix:
  // 55% Student, 15% Teacher, 10% Parent, 10% Writes, 7% School Admin, 3% Super Admin
  const roll = Math.random() * 100;

  if (roll < 55) {
    // 55% STUDENT READS
    const studentObj = tokens.studentTokens[__VU % tokens.studentTokens.length];
    const headers = { Authorization: `Bearer ${studentObj.token}` };

    const studentRoll = Math.random() * 100;
    let res;
    const start = Date.now();
    if (studentRoll < 50) {
      res = http.get(`${BASE_URL}/students/data`, { headers });
    } else if (studentRoll < 80) {
      res = http.get(`${BASE_URL}/mission/todo`, { headers });
    } else {
      res = http.get(`${BASE_URL}/students/student-trophy-primaire`, { headers });
    }
    studentLatency.add(Date.now() - start);
    check(res, { "student 200": (r) => r.status === 200 });

  } else if (roll < 70) {
    // 15% TEACHER READS
    const teacherObj = tokens.teacherTokens[__VU % tokens.teacherTokens.length];
    const headers = { Authorization: `Bearer ${teacherObj.token}` };

    const start = Date.now();
    const res = http.get(`${BASE_URL}/teachers/appear-class`, { headers });
    teacherLatency.add(Date.now() - start);
    check(res, { "teacher 200": (r) => r.status === 200 });

  } else if (roll < 80) {
    // 10% PARENT READS
    const parentObj = tokens.parentTokens[__VU % tokens.parentTokens.length];
    const headers = { Authorization: `Bearer ${parentObj.token}` };

    const start = Date.now();
    const res = http.get(`${BASE_URL}/parents/parent-data`, { headers });
    parentLatency.add(Date.now() - start);
    check(res, { "parent 200": (r) => r.status === 200 });

  } else if (roll < 90) {
    // 10% WRITES / MUTATIONS (To-Do Add/Reconcile)
    const studentObj = tokens.studentTokens[__VU % tokens.studentTokens.length];
    const headers = {
      Authorization: `Bearer ${studentObj.token}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();
    const payload = JSON.stringify({
      taskId: (__VU % 10) + 1,
    });
    const res = http.post(`${BASE_URL}/mission/todo`, payload, { headers });
    writeLatency.add(Date.now() - start);
    check(res, {
      "write valid status": (r) => r.status === 200 || r.status === 201,
    });

  } else if (roll < 97) {
    // 7% SCHOOL ADMIN READS
    const adminObj = tokens.schoolAdminTokens[__VU % tokens.schoolAdminTokens.length];
    const headers = { Authorization: `Bearer ${adminObj.token}` };

    const start = Date.now();
    const res = http.get(`${BASE_URL}/admin/school-dashboard`, { headers });
    schoolAdminLatency.add(Date.now() - start);
    check(res, { "school admin 200": (r) => r.status === 200 });

  } else {
    // 3% SUPER ADMIN ANALYTICS
    const headers = { Authorization: `Bearer ${tokens.superAdminToken}` };

    const start = Date.now();
    const res = http.get(`${BASE_URL}/admin/analytics/overview`, { headers });
    superAdminLatency.add(Date.now() - start);
    check(res, { "super admin 200": (r) => r.status === 200 });
  }

  // Realistic think time between requests (0.2s - 1.0s)
  sleep(0.2 + Math.random() * 0.8);
}
