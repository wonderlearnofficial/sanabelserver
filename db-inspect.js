const mysql = require("mysql2/promise");

async function main() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "mysql",
    database: "sanabel_prod",
  });

  try {
    const [students] = await connection.execute(
      "SELECT id, xp, snabelRed, snabelYellow, snabelBlue, water, seeders FROM Students LIMIT 5;",
    );
    console.log("==> Students <==");
    console.table(students);

    const [studentTasks] = await connection.execute(
      "SELECT id, studentId, taskId, date, completionStatus FROM StudentTasks ORDER BY id DESC LIMIT 5;",
    );
    console.log("==> StudentTasks <==");
    console.table(studentTasks);

    const [tasks] = await connection.execute(
      "SELECT id, xp, snabelRed, snabelYellow, snabelBlue FROM Tasks LIMIT 5;",
    );
    console.log("==> Tasks <==");
    console.table(tasks);
  } catch (e) {
    console.error("Error connecting to DB:", e);
  } finally {
    await connection.end();
  }
}

main();
