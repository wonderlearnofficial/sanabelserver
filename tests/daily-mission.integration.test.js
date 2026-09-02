const test = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config();

const enabled = process.env.RUN_DAILY_MISSION_INTEGRATION === "true";

test("daily School Student mission: three dates, delayed approvals, and idempotent rewards", { skip: !enabled }, async () => {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.MYSQL_DB_HOST), "Only a loopback DB is allowed");
  process.env.DB_SYNC_ON_STARTUP = "false";
  const { sequelize, rundb } = require("../dist/config/db_connection");
  const model = name => require(`../dist/models/${name}.model`).default;
  const User = model("user"), Student = model("student"), Task = model("task"), Category = model("task-category"), Parent = model("parent"), Teacher = model("teacher");
  const Class = model("class"), StudentTask = model("student-task"), Todo = model("student-todo-item");
  const Day = model("student-todo-day"), Source = model("student-todo-source"), Request = model("mission-approval-request");
  const Challenge = model("challenge"), StudentChallenge = model("student-challenge");
  const { addOrAssignTodo, ensureTodoDay, withDeadlockRetry } = require("../dist/services/studentTodoService");
  const { completeMissionForStudent } = require("../dist/helpers/completeMission");
  let user, student, task, todo;
  let directUser, directStudent, directTask, directTodo;
  try {
    await rundb(); await sequelize.authenticate();
    const schoolClass = await Class.findOne();
    const category = await Category.findOne();
    const approver = await Parent.findOne();
    const directTeacher = await Teacher.findOne();
    const cumulativeChallenge = (await Challenge.findAll({ where: { category: "alltask" } }))
      .find(row => Number(row.point) > 2);
    assert.ok(schoolClass && category && approver && directTeacher && cumulativeChallenge,
      "Existing school, parent, teacher, mission, and cumulative challenge catalogs required");
    const suffix = `daily_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    user = await User.create({ firstName: "Daily", lastName: "Test", role: "Student", email: `${suffix}@example.invalid`, password: "unused", isAccess: true });
    student = await Student.create({ userId: user.id, organizationId: schoolClass.organizationId, classId: schoolClass.id, ParentId: approver.id, treeProgress: 1, connectCode: suffix.slice(-8), xp: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0 });
    task = await Task.create({ title: suffix, type: suffix, categoryId: category.id, xp: 5, snabelRed: 1, snabelBlue: 1, snabelYellow: 1 });
    await StudentChallenge.create({ studentId: student.id, challengeId: cumulativeChallenge.id,
      completionStatus: "NotCompleted", pointOfStudent: 0 });
    const date = offset => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
    const sunday = date(-3), monday = date(-2), tuesday = date(-1), wednesday = date(0);

    await sequelize.transaction(async transaction => {
      ({ todo } = await addOrAssignTodo({ studentId: student.id, taskId: task.id, sourceType: "student", sourceId: student.id, date: sunday, transaction }));
      const day = await ensureTodoDay(todo, sunday, transaction);
      const request = await Request.create({ studentId: student.id, missionId: task.id, missionDate: sunday, status: "pending", parentIds: [approver.id], teacherIds: [], todoItemId: todo.id, todoDayId: day.id }, { transaction });
      await day.update({ status: "pending_approval" }, { transaction });
      assert.ok(request.id);
    });
    await sequelize.transaction(async transaction => {
      const day = await ensureTodoDay(todo, monday, transaction);
      await Request.create({ studentId: student.id, missionId: task.id, missionDate: monday, status: "pending", parentIds: [approver.id], teacherIds: [], todoItemId: todo.id, todoDayId: day.id }, { transaction });
      await day.update({ status: "pending_approval" }, { transaction });
    });
    // Two first-load requests for the same new day must both succeed while the
    // database still stores exactly one occurrence.
    await Promise.all([
      withDeadlockRetry(() => sequelize.transaction(transaction => ensureTodoDay(todo, tuesday, transaction))),
      withDeadlockRetry(() => sequelize.transaction(transaction => ensureTodoDay(todo, tuesday, transaction))),
    ]);
    assert.equal(await Day.count({ where: { studentId: student.id, taskId: task.id, missionDate: tuesday } }), 1);
    await sequelize.transaction(transaction => ensureTodoDay(todo, wednesday, transaction));
    assert.equal(await Request.count({ where: { studentId: student.id, status: "pending" } }), 2, "Sunday and Monday stay independently pending on Wednesday");

    const sundayRequest = await Request.findOne({ where: { studentId: student.id, missionDate: sunday } });
    const mondayRequest = await Request.findOne({ where: { studentId: student.id, missionDate: monday } });
    await sequelize.transaction(transaction => completeMissionForStudent({ studentId: student.id, taskId: task.id, missionDate: sunday, source: "approval_parent", approverId: approver.id, approverType: "parent", approvalRequestId: sundayRequest.id, transaction }));
    assert.equal((await Request.findByPk(mondayRequest.id)).status, "pending", "Approving Sunday must not resolve Monday");
    const retry = await sequelize.transaction(transaction => completeMissionForStudent({ studentId: student.id, taskId: task.id, missionDate: sunday, source: "approval_parent", approverId: approver.id, approverType: "parent", approvalRequestId: sundayRequest.id, transaction }));
    assert.equal(retry.rewardsGranted, false);
    await sequelize.transaction(transaction => completeMissionForStudent({ studentId: student.id, taskId: task.id, missionDate: monday, source: "approval_parent", approverId: approver.id, approverType: "parent", approvalRequestId: mondayRequest.id, transaction }));
    assert.equal(await StudentTask.count({ where: { studentId: student.id } }), 2);
    const completions = await StudentTask.findAll({ where: { studentId: student.id }, order: [["date", "ASC"]] });
    assert.deepEqual(completions.map(row => row.date), [sunday, monday]);
    assert.equal(new Set(completions.map(row => row.completionKey)).size, 2, "each mission date has a distinct completion key");
    assert.ok(completions.every(row => Date.now() - new Date(row.createdAt).getTime() < 60000), "recent activity timestamp is approval time");
    const challengeProgress = await StudentChallenge.findOne({ where: { studentId: student.id, challengeId: cumulativeChallenge.id } });
    assert.equal(challengeProgress.pointOfStudent, 2, "the retry must not duplicate cumulative challenge progression");
    await student.reload();
    assert.equal(student.xp, 10, "two dates grant exactly two reward bundles");
    assert.deepEqual((await Day.findAll({ where: { studentId: student.id }, order: [["missionDate", "ASC"]] })).map(row => [row.missionDate, row.status]), [[sunday, "completed"], [monday, "completed"], [tuesday, "todo"], [wednesday, "todo"]]);

    // Mandatory date-scoping regression: a Teacher recording Wednesday must
    // not resolve the same Task's older Sunday request.
    const directSuffix = `direct_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    directUser = await User.create({ firstName: "Direct", lastName: "Scope", role: "Student", email: `${directSuffix}@example.invalid`, password: "unused", isAccess: true });
    directStudent = await Student.create({ userId: directUser.id, organizationId: schoolClass.organizationId,
      classId: schoolClass.id, ParentId: approver.id, treeProgress: 1, connectCode: directSuffix.slice(-8),
      xp: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0 });
    directTask = await Task.create({ title: directSuffix, type: directSuffix, categoryId: category.id,
      xp: 5, snabelRed: 1, snabelBlue: 1, snabelYellow: 1 });
    let directSundayRequest;
    await sequelize.transaction(async transaction => {
      ({ todo: directTodo } = await addOrAssignTodo({ studentId: directStudent.id, taskId: directTask.id,
        sourceType: "student", sourceId: directStudent.id, date: sunday, transaction }));
      const sundayDay = await ensureTodoDay(directTodo, sunday, transaction);
      directSundayRequest = await Request.create({ studentId: directStudent.id, missionId: directTask.id,
        missionDate: sunday, status: "pending", parentIds: [approver.id], teacherIds: [directTeacher.id],
        todoItemId: directTodo.id, todoDayId: sundayDay.id }, { transaction });
      await sundayDay.update({ status: "pending_approval" }, { transaction });
      await ensureTodoDay(directTodo, wednesday, transaction);
    });
    await sequelize.transaction(transaction => completeMissionForStudent({ studentId: directStudent.id,
      taskId: directTask.id, missionDate: wednesday, source: "teacher_direct", approverId: directTeacher.id,
      approverType: "teacher", transaction }));
    assert.equal((await Request.findByPk(directSundayRequest.id)).status, "pending",
      "Teacher direct completion on Wednesday must leave Sunday pending");
    assert.deepEqual((await Day.findAll({ where: { studentId: directStudent.id }, order: [["missionDate", "ASC"]] }))
      .map(row => [row.missionDate, row.status]), [[sunday, "pending_approval"], [wednesday, "completed"]]);
    await sequelize.transaction(transaction => completeMissionForStudent({ studentId: directStudent.id,
      taskId: directTask.id, missionDate: sunday, source: "approval_parent", approverId: approver.id,
      approverType: "parent", approvalRequestId: directSundayRequest.id, transaction }));
    assert.deepEqual((await StudentTask.findAll({ where: { studentId: directStudent.id }, order: [["date", "ASC"]] }))
      .map(row => row.date), [sunday, wednesday], "Sunday approval completes separately from Wednesday direct completion");
  } finally {
    if (directStudent) {
      await Request.destroy({ where: { studentId: directStudent.id } });
      await Day.destroy({ where: { studentId: directStudent.id } });
      await Source.destroy({ where: { todoItemId: directTodo ? directTodo.id : -1 } });
      await Todo.destroy({ where: { studentId: directStudent.id } });
      await StudentTask.destroy({ where: { studentId: directStudent.id } });
      await StudentChallenge.destroy({ where: { studentId: directStudent.id } });
      await Student.destroy({ where: { id: directStudent.id } });
    }
    if (directTask) await Task.destroy({ where: { id: directTask.id } });
    if (directUser) await User.destroy({ where: { id: directUser.id } });
    if (student) {
      await Request.destroy({ where: { studentId: student.id } });
      await Day.destroy({ where: { studentId: student.id } });
      await Source.destroy({ where: { todoItemId: todo ? todo.id : -1 } });
      await Todo.destroy({ where: { studentId: student.id } });
      await StudentTask.destroy({ where: { studentId: student.id } });
      await StudentChallenge.destroy({ where: { studentId: student.id } });
      await Student.destroy({ where: { id: student.id } });
    }
    if (task) await Task.destroy({ where: { id: task.id } });
    if (user) await User.destroy({ where: { id: user.id } });
    await sequelize.close();
  }
});
