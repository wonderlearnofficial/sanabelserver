// Verified full database backup for MySQL-8E5S before migration/deployment.
// Never prints credentials.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

  const [dbRows] = await connection.query("SELECT DATABASE() AS db, VERSION() AS version");
  const dbName = dbRows[0].db;
  const version = dbRows[0].version;

  const [tableRows] = await connection.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
  );
  const tables = tableRows.map((r) => r.tableName);

  const backupDir = path.resolve(__dirname, "../../tmp");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `backup_mysql_8e5s_${timestamp}.sql`;
  const backupFilePath = path.join(backupDir, backupFileName);

  const writeStream = fs.createWriteStream(backupFilePath, { encoding: "utf8" });

  const write = (str) =>
    new Promise((resolve, reject) => {
      if (!writeStream.write(str)) {
        writeStream.once("drain", resolve);
      } else {
        process.nextTick(resolve);
      }
    });

  await write(`-- Sanabel MySQL-8E5S Database Backup\n`);
  await write(`-- Database: ${dbName} (MySQL version: ${version})\n`);
  await write(`-- Generated at: ${new Date().toISOString()}\n\n`);
  await write(`SET FOREIGN_KEY_CHECKS=0;\n`);
  await write(`SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";\n`);
  await write(`SET NAMES utf8mb4;\n\n`);

  for (const table of tables) {
    await write(`--\n-- Table structure for table \`${table}\`\n--\n`);
    await write(`DROP TABLE IF EXISTS \`${table}\`;\n`);
    const [createRows] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
    const createSql = createRows[0]["Create Table"];
    await write(`${createSql};\n\n`);

    await write(`--\n-- Dumping data for table \`${table}\`\n--\n`);
    const [rows, fields] = await connection.query(`SELECT * FROM \`${table}\``);
    if (rows.length > 0) {
      const colNames = fields.map((f) => `\`${f.name}\``).join(", ");
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const valuesList = chunk
          .map((row) => {
            const vals = fields.map((f) => {
              const val = row[f.name];
              if (val === null || val === undefined) return "NULL";
              if (typeof val === "number" || typeof val === "bigint") return String(val);
              if (typeof val === "boolean") return val ? "1" : "0";
              if (val instanceof Date) {
                return mysql.escape(val.toISOString().slice(0, 19).replace("T", " "));
              }
              if (Buffer.isBuffer(val)) {
                return `X'${val.toString("hex")}'`;
              }
              if (typeof val === "object") {
                return mysql.escape(JSON.stringify(val));
              }
              return mysql.escape(String(val));
            });
            return `(${vals.join(", ")})`;
          })
          .join(",\n  ");
        await write(`INSERT INTO \`${table}\` (${colNames}) VALUES\n  ${valuesList};\n`);
      }
    }
    await write(`\n`);
  }

  await write(`SET FOREIGN_KEY_CHECKS=1;\n`);
  await new Promise((resolve) => writeStream.end(resolve));

  await connection.end();

  // Verify backup
  const stat = fs.statSync(backupFilePath);
  const fileBuffer = fs.readFileSync(backupFilePath);
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const content = fileBuffer.toString("utf8", 0, Math.min(stat.size, 100000));

  const hasSequelizeMeta = content.includes("`SequelizeMeta`");
  const hasUsers = content.includes("`Users`");
  const hasStudents = content.includes("`Students`");

  console.log(
    JSON.stringify({
      success: true,
      backupFileName,
      backupFilePath,
      sizeBytes: stat.size,
      sha256,
      tableCount: tables.length,
      hasSequelizeMeta,
      hasUsers,
      hasStudents,
    })
  );
})().catch((err) => {
  console.error("Backup failed:", err.code || err.message);
  process.exit(1);
});
