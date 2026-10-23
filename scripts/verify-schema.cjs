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

  const checkTable = async (tableName) => {
    const [cols] = await connection.query(`DESCRIBE \`${tableName}\``);
    const [indexes] = await connection.query(`SHOW INDEX FROM \`${tableName}\``);
    const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
    return {
      columns: cols.map((c) => ({ field: c.Field, type: c.Type, null: c.Null, key: c.Key })),
      indexes: indexes.map((i) => ({ name: i.Key_name, column: i.Column_name, unique: !i.Non_unique })),
      rowCount: countRows[0].count,
    };
  };

  const results = {
    EmailEvents: await checkTable("EmailEvents"),
    ImportRuns: await checkTable("ImportRuns"),
    AdminImpersonationHandoffs: await checkTable("AdminImpersonationHandoffs"),
  };

  console.log(JSON.stringify(results, null, 2));

  await connection.end();
})().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
