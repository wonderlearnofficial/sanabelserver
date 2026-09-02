// READ-ONLY production charset / Arabic-data probe.
// Connection URL is taken from MYSQL_PUBLIC_URL injected by `railway run`.
// The URL itself is never printed.
const mysql = require('mysql2/promise');

(async () => {
  const url = process.env.MYSQL_PUBLIC_URL;
  if (!url) throw new Error('MYSQL_PUBLIC_URL not present in environment');
  const conn = await mysql.createConnection(url); // mysql2 default charset utf8mb4_unicode_ci, same as app
  const q = async (label, sql) => {
    try {
      const [rows] = await conn.query(sql);
      console.log('\n### ' + label);
      console.log(JSON.stringify(rows, null, 1));
    } catch (e) {
      console.log('\n### ' + label + ' -> ERROR: ' + e.message);
    }
  };

  await q('version', 'SELECT VERSION() v, DATABASE() db');
  await q('session charsets', "SHOW VARIABLES WHERE Variable_name IN ('character_set_client','character_set_connection','character_set_results','character_set_database','character_set_server','collation_connection','collation_database','collation_server')");
  await q('Tasks DDL', 'SHOW CREATE TABLE Tasks');
  await q('TaskCategories DDL', 'SHOW CREATE TABLE TaskCategories');
  await q('Tasks counts', `SELECT COUNT(*) total,
      SUM(title RLIKE '\\\\?') AS title_has_qmark,
      SUM(title RLIKE '^[?[:space:]]+$') AS title_all_qmark,
      SUM(type RLIKE '^[?[:space:]]+$') AS type_all_qmark
     FROM Tasks`);
  await q('Tasks sample', 'SELECT id, categoryId, LEFT(title,45) title, LEFT(type,25) type FROM Tasks ORDER BY id LIMIT 6');
  await q('TaskCategories all', 'SELECT id, title FROM TaskCategories ORDER BY id');
  await q('TaskCategories qmark', "SELECT COUNT(*) c FROM TaskCategories WHERE title RLIKE '^[?[:space:]]+$'");
  await conn.end();
})().catch((e) => { console.error('FATAL:', e.code || '', e.message); process.exit(1); });
