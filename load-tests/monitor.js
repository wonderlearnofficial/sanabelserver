const mysql = require("mysql2/promise");
require("dotenv").config({ path: "./.env" });

let running = true;

async function monitor() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_DB_HOST || "localhost",
    port: Number(process.env.MYSQL_DB_PORT) || 3306,
    user: process.env.MYSQL_DB_USER || "ali",
    password: process.env.MYSQL_DB_PASS || "mysql",
    database: process.env.MYSQL_DB_NAME || "snablelahssan",
  });

  console.log("=== SERVER & MYSQL TELEMETRY MONITOR STARTED ===");
  console.log("Time\t\tThreads_Conn\tThreads_Run\tMax_Used_Conn\tAborted\tServer_Health");

  process.on("SIGINT", () => {
    running = false;
    connection.end().then(() => process.exit(0));
  });

  while (running) {
    try {
      const [vars] = await connection.query(`
        SHOW GLOBAL STATUS WHERE Variable_name IN (
          'Threads_connected', 'Threads_running', 'Max_used_connections', 'Aborted_connects'
        )
      `);
      const map = Object.fromEntries(vars.map((v) => [v.Variable_name, v.Value]));

      let healthStatus = "DOWN";
      try {
        const res = await fetch("http://localhost:5000/health/live");
        if (res.ok) healthStatus = "OK";
      } catch (e) {
        healthStatus = "TIMEOUT/ERR";
      }

      const time = new Date().toLocaleTimeString();
      console.log(
        `${time}\t${map.Threads_connected}\t\t${map.Threads_running}\t\t${map.Max_used_connections}\t\t${map.Aborted_connects}\t${healthStatus}`
      );
    } catch (err) {
      console.error("Monitor query error:", err.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

monitor().catch(console.error);
