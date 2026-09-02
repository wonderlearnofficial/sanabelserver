// READ-ONLY charset / Arabic-data probe. No writes.
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_DB_HOST,
    port: Number(process.env.MYSQL_DB_PORT) || 3306,
    user: process.env.MYSQL_DB_USER,
    password: process.env.MYSQL_DB_PASS,
    database: process.env.MYSQL_DB_NAME,
    // deliberately NOT setting charset: reproduce app defaults (mysql2 default = utf8mb4_unicode_ci)
  });
  const q = async (label, sql) => {
    try {
      const [rows] = await conn.query(sql);
      console.log('\n### ' + label);
      console.log(JSON.stringify(rows, null, 1));
    } catch (e) {
      console.log('\n### ' + label + ' -> ERROR: ' + e.message);
    }
  };

  await q('version', "SELECT VERSION() v, DATABASE() db");
  await q('session charsets', "SHOW VARIABLES WHERE Variable_name IN ('character_set_client','character_set_connection','character_set_results','character_set_database','character_set_server','collation_connection','collation_database','collation_server')");
  await q('Tasks DDL', "SHOW CREATE TABLE Tasks");
  await q('TaskCategories DDL', "SHOW CREATE TABLE TaskCategories");
  await q('column charsets', `SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('Tasks','TaskCategories','StudentTodoItems','StudentTodoDays')
       AND CHARACTER_SET_NAME IS NOT NULL
     ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  await q('Tasks counts', `SELECT COUNT(*) total,
      SUM(title REGEXP '\\\\?') AS title_has_qmark,
      SUM(title RLIKE '^[?[:space:]]+$') AS title_all_qmark
     FROM Tasks`);
  await q('Tasks sample', "SELECT id, categoryId, LEFT(title,60) title, HEX(LEFT(title,12)) title_hex, LEFT(type,40) type FROM Tasks ORDER BY id LIMIT 8");
  await q('Tasks qmark rows', "SELECT id, LEFT(title,60) title, HEX(LEFT(title,12)) hex FROM Tasks WHERE title RLIKE '^[?[:space:]]+$' ORDER BY id LIMIT 20");
  await q('TaskCategories all', "SELECT id, title, HEX(title) hex FROM TaskCategories ORDER BY id");
  await conn.end();
})().catch((e) => { console.error('FATAL:', e.code || '', e.message); process.exit(1); });
