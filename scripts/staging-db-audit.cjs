// Read-only deployment preflight. Deliberately prints no connection values.
const mysql = require("mysql2/promise");

(async () => {
  const isInternal = process.env.MYSQL_DB_HOST?.endsWith(".railway.internal");
  const host = isInternal ? "hayabusa.proxy.rlwy.net" : process.env.MYSQL_DB_HOST;
  const port = isInternal ? 28191 : Number(process.env.MYSQL_DB_PORT);

  const connection = process.env.MYSQL_PUBLIC_URL
    ? await mysql.createConnection(process.env.MYSQL_PUBLIC_URL)
    : await mysql.createConnection({
        host,
        port,
        user: process.env.MYSQL_DB_USER,
        password: process.env.MYSQL_DB_PASS,
        database: process.env.MYSQL_DB_NAME,
        ssl: { rejectUnauthorized: false },
      });

  const [versionRows] = await connection.query("SELECT VERSION() AS version");
  const [migrationRows] = await connection.query(
    "SELECT name FROM SequelizeMeta ORDER BY name",
  );
  const [tableRows] = await connection.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
  );

  console.log(
    JSON.stringify({
      version: versionRows[0].version,
      migrations: migrationRows.map((row) => row.name),
      tables: tableRows.map((row) => row.tableName),
    }),
  );

  await connection.end();
})().catch((error) => {
  console.error(error.code || error.message);
  process.exit(1);
});
