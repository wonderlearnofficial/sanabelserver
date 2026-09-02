const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
require("dotenv").config();

const enabled = process.env.RUN_ARABIC_UNICODE_INTEGRATION === "true";

test("Arabic mission survives model write, MySQL storage, and To-Do JSON API", { skip: !enabled }, async () => {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.MYSQL_DB_HOST), "Only a loopback DB is allowed");
  process.env.DB_SYNC_ON_STARTUP = "false";

  const { sequelize, rundb } = require("../dist/config/db_connection");
  const model = (name) => require(`../dist/models/${name}.model`).default;
  const User = model("user");
  const Student = model("student");
  const Task = model("task");
  const Category = model("task-category");
  const Todo = model("student-todo-item");
  const Day = model("student-todo-day");
  const Source = model("student-todo-source");
  const Request = model("mission-approval-request");
  const { signAccessToken } = require("../dist/helpers/tokens");

  const expected = {
    title: "صلاة الظهر",
    type: "الصلاة",
    description: "اختبار ترميز عربي آمن",
  };
  let server;
  let user;
  let student;
  let task;

  try {
    await rundb();
    await sequelize.authenticate();
    const category = await Category.findOne();
    assert.ok(category, "A local task category is required");

    const suffix = `unicode_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    user = await User.create({
      firstName: "Unicode",
      lastName: "Fixture",
      role: "Student",
      email: `${suffix}@example.invalid`,
      password: "unused",
      isAccess: true,
    });
    student = await Student.create({
      userId: user.id,
      organizationId: 11,
      classId: 10,
      ParentId: null,
      treeProgress: 1,
      connectCode: suffix.slice(-8),
      xp: 0,
      snabelRed: 0,
      snabelBlue: 0,
      snabelYellow: 0,
    });
    task = await Task.create({ ...expected, categoryId: category.id, xp: 5, snabelRed: 1, snabelBlue: 1, snabelYellow: 1 });

    const [rawRows] = await sequelize.query(
      "SELECT title, type, description, HEX(title) AS titleHex FROM Tasks WHERE id = :id",
      { replacements: { id: task.id } },
    );
    assert.equal(rawRows[0].title, expected.title);
    assert.equal(rawRows[0].type, expected.type);
    assert.equal(rawRows[0].description, expected.description);
    assert.ok(String(rawRows[0].titleHex).startsWith("D8"), "stored bytes must be UTF-8 Arabic, not 0x3F question marks");

    const app = express();
    app.use(express.json());
    app.use("/mission", require("../dist/routes/mission_routes").router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const token = signAccessToken(user);
    const call = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const added = await call("POST", "/mission/todo", { taskId: task.id });
    assert.ok([200, 201].includes(added.status));
    const listed = await call("GET", "/mission/todo");
    assert.equal(listed.status, 200);
    const apiTask = listed.body.data.items.find((item) => item.Task.id === task.id).Task;
    assert.equal(apiTask.title, expected.title);
    assert.equal(apiTask.type, expected.type);
    assert.equal(apiTask.description, expected.description);
    assert.doesNotMatch(`${apiTask.title} ${apiTask.type} ${apiTask.description}`, /\?{3,}/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (student) {
      const todoIds = (await Todo.findAll({ where: { studentId: student.id }, attributes: ["id"] })).map((row) => row.id);
      await Request.destroy({ where: { studentId: student.id } });
      await Day.destroy({ where: { studentId: student.id } });
      if (todoIds.length) await Source.destroy({ where: { todoItemId: todoIds } });
      await Todo.destroy({ where: { studentId: student.id } });
      await Student.destroy({ where: { id: student.id } });
    }
    if (user) await User.destroy({ where: { id: user.id } });
    if (task) await Task.destroy({ where: { id: task.id } });
    await sequelize.close();
  }
});
