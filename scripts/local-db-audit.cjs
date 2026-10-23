const mysql = require("mysql2/promise");
require("dotenv").config({ path: "./.env" });

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_DB_HOST || "localhost",
    port: Number(process.env.MYSQL_DB_PORT) || 3306,
    user: process.env.MYSQL_DB_USER,
    password: process.env.MYSQL_DB_PASS, // env only: no built-in credential
    database: process.env.MYSQL_DB_NAME || "snablelahssan",
  });

  const [version] = await connection.query("SELECT VERSION() AS version, @@max_connections as max_connections");
  const [vars] = await connection.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running', 'Max_used_connections', 'Connections', 'Aborted_connects')");
  const [counts] = await connection.query(`
    SELECT 'Users' as tbl, count(*) as count FROM Users UNION ALL
    SELECT 'Students', count(*) FROM Students UNION ALL
    SELECT 'Teachers', count(*) FROM Teachers UNION ALL
    SELECT 'Parents', count(*) FROM Parents UNION ALL
    SELECT 'Classes', count(*) FROM Classes UNION ALL
    SELECT 'Tasks', count(*) FROM Tasks UNION ALL
    SELECT 'StudentTasks', count(*) FROM StudentTasks UNION ALL
    SELECT 'StudentTodoDays', count(*) FROM StudentTodoDays UNION ALL
    SELECT 'StudentTodoItems', count(*) FROM StudentTodoItems UNION ALL
    SELECT 'MissionApprovalRequests', count(*) FROM MissionApprovalRequests
  `);

  console.log("MySQL Info:", version[0]);
  console.log("MySQL Status:", vars);
  console.log("Table Counts:", counts);

  await connection.end();
})().catch(err => {
  console.error("Local DB check error:", err);
  process.exit(1);
});
