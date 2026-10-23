// Creates the full Sanabel schema in an EMPTY database, so a new environment
// (staging, disaster recovery, a teammate's laptop) can be built without a
// copy of production. The migrations alone cannot do this: the oldest one
// alters a Users table that nothing creates.
//
//   node scripts/bootstrap-empty-db.cjs [--with-reference-data]
//   npm run migrate        # then applies any migration newer than the baseline
//
// Loads database/baseline/schema.sql, marks every migration the baseline already
// contains as applied in SequelizeMeta, and with --with-reference-data also
// loads the mission catalog, challenges and app-version rows.
//
// Refuses to touch a database that already has tables. Connection settings come
// from the same environment variables as database/config.js.
//
// Regenerating the baseline after new migrations: dump a fully migrated local
// database with `mysqldump --no-data` (and the four reference tables with
// `--no-create-info`), restore table-name casing to the model names (Windows
// MySQL lowercases them), and add the new file names to BASELINE_MIGRATIONS.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const config = require("../database/config.js")[process.env.NODE_ENV || "development"];

// Migrations whose effect is already part of baseline/schema.sql.
const BASELINE_MIGRATIONS_UP_TO = "20260903000000-add-leaderboard-settings.js";

(async () => {
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    multipleStatements: true,
  });
  try {
    const [tables] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?",
      [config.database],
    );
    if (Number(tables[0].n) > 0) {
      console.error(`Refusing: database "${config.database}" is not empty (${tables[0].n} tables).`);
      process.exitCode = 1;
      return;
    }

    const dir = path.join(__dirname, "..", "database", "baseline");
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query(fs.readFileSync(path.join(dir, "schema.sql"), "utf8"));

    const applied = fs
      .readdirSync(path.join(__dirname, "..", "database", "migrations"))
      .filter((f) => f.endsWith(".js") && f <= BASELINE_MIGRATIONS_UP_TO)
      .sort();
    if (applied.length) {
      await conn.query("INSERT INTO SequelizeMeta (name) VALUES ?", [applied.map((n) => [n])]);
    }

    if (process.argv.includes("--with-reference-data")) {
      await conn.query(fs.readFileSync(path.join(dir, "reference-data.sql"), "utf8"));
    }
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log(`Bootstrapped "${config.database}": baseline schema, ${applied.length} migrations marked applied.`);
  } finally {
    await conn.end();
  }
})().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exit(1);
});
