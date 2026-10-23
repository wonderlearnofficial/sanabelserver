const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const K6_PATH = path.join(__dirname, "bin/k6.exe");
const TOKENS_PATH = path.join(__dirname, "tokens.json");

if (!fs.existsSync(TOKENS_PATH)) {
  console.error("tokens.json missing. Run prepare-tokens.ts first.");
  process.exit(1);
}

async function getMysqlStats() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_DB_HOST || "localhost",
      port: Number(process.env.MYSQL_DB_PORT) || 3306,
      user: process.env.MYSQL_DB_USER || "ali",
      password: process.env.MYSQL_DB_PASS || "mysql",
      database: process.env.MYSQL_DB_NAME || "snablelahssan",
    });
    const [vars] = await conn.query(`
      SHOW GLOBAL STATUS WHERE Variable_name IN (
        'Threads_connected', 'Threads_running', 'Max_used_connections', 'Aborted_connects'
      )
    `);
    await conn.end();
    return Object.fromEntries(vars.map((v) => [v.Variable_name, Number(v.Value)]));
  } catch (e) {
    return { Threads_connected: -1, Threads_running: -1, Max_used_connections: -1 };
  }
}

async function getServerMetrics() {
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
    const res = await fetch("http://localhost:5000/admin/analytics/system-health", {
      headers: { Authorization: `Bearer ${tokens.superAdminToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const j = await res.json();
      return j.data;
    }
  } catch (e) {}
  return null;
}

function runK6(scriptPath, env = {}) {
  const summaryFile = path.join(__dirname, `summary_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const cmdArgs = [
    "run",
    ...envArgs,
    "--summary-export",
    summaryFile,
    scriptPath,
  ];

  try {
    const { execFileSync } = require("child_process");
    execFileSync(K6_PATH, cmdArgs, {
      cwd: path.join(__dirname, ".."),
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    if (e.stderr) {
      const errStr = e.stderr.toString();
      if (!errStr.includes("thresholds on metrics")) {
        console.error("k6 run error:", errStr);
      }
    }
  }

  if (fs.existsSync(summaryFile)) {
    const data = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
    try { fs.unlinkSync(summaryFile); } catch (e) {}
    return data;
  }
  return null;
  return null;
}

function extractK6Metrics(k6Data) {
  if (!k6Data || !k6Data.metrics) return null;
  const m = k6Data.metrics;
  const reqDuration = m.http_req_duration || {};
  const reqs = m.http_reqs || {};
  const failed = m.http_req_failed || {};

  return {
    requests: reqs.count || 0,
    rps: Number((reqs.rate || 0).toFixed(1)),
    p50: Number((reqDuration.med || 0).toFixed(1)),
    p90: Number((reqDuration["p(90)"] || 0).toFixed(1)),
    p95: Number((reqDuration["p(95)"] || 0).toFixed(1)),
    p99: Number((reqDuration["p(99)"] || reqDuration.max || 0).toFixed(1)),
    max: Number((reqDuration.max || 0).toFixed(1)),
    avg: Number((reqDuration.avg || 0).toFixed(1)),
    errorRate: Number(((failed.rate || 0) * 100).toFixed(2)),
  };
}

async function runBenchmarkStep(name, script, env = {}) {
  console.log(`\n>>> STARTING BENCHMARK: ${name} (Target VUs: ${env.TARGET_VUS || "default"}) <<<`);
  const mysqlBefore = await getMysqlStats();
  const sysBefore = await getServerMetrics();

  const start = Date.now();
  const k6Data = runK6(script, env);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  const mysqlAfter = await getMysqlStats();
  const sysAfter = await getServerMetrics();
  const extracted = extractK6Metrics(k6Data);

  const result = {
    name,
    elapsedSec: elapsed,
    vus: env.TARGET_VUS || "default",
    ...extracted,
    mysql: {
      threadsConnected: mysqlAfter.Threads_connected,
      threadsRunning: mysqlAfter.Threads_running,
      maxUsed: mysqlAfter.Max_used_connections,
    },
    system: sysAfter ? {
      heapUsedMb: sysAfter.memory?.heapUsedMb,
      rssMb: sysAfter.memory?.rssMb,
      errorRate: sysAfter.errorRate,
      averageLatencyMs: sysAfter.averageLatencyMs,
    } : null,
  };

  console.log(`Finished ${name}: ${result.requests} requests in ${elapsed}s, ${result.rps} RPS, p50: ${result.p50}ms, p95: ${result.p95}ms, p99: ${result.p99}ms, Error: ${result.errorRate}%`);
  return result;
}

module.exports = {
  runBenchmarkStep,
  getMysqlStats,
  getServerMetrics,
};
