const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'mysql',
    database: 'snablelahssan',
  });

  try {
    const [rows] = await connection.execute("DESCRIBE Classes;");
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await connection.end();
  }
}

main();
