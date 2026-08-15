const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "production";
process.env.DB_SYNC_ON_STARTUP = "false";
process.env.MYSQL_DB_NAME = process.env.MYSQL_DB_NAME || "association_test";
process.env.MYSQL_DB_USER = process.env.MYSQL_DB_USER || "test";
process.env.MYSQL_DB_PASS = process.env.MYSQL_DB_PASS || "test";
process.env.MYSQL_DB_HOST = process.env.MYSQL_DB_HOST || "localhost";
process.env.MYSQL_DB_PORT = process.env.MYSQL_DB_PORT || "3306";

const { rundb, sequelize } = require("../dist/config/db_connection");
const Student = require("../dist/models/student.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Parent = require("../dist/models/parent.model").default;

test("models initialize repeatedly without association errors", async () => {
  await rundb();
  await rundb();

  assert.ok(Student.associations.user);
  assert.ok(Student.associations.organization);
  assert.ok(Student.associations.Class);
  assert.ok(Student.associations.class);
  assert.ok(Teacher.associations.user);
  assert.ok(Teacher.associations.organization);
  assert.ok(Parent.associations.user);
});

test.after(async () => {
  await sequelize.close();
});
