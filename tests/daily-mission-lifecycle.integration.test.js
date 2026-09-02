const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Op } = require("sequelize");
require("dotenv").config();

// Gap-filling suite alongside daily-mission.integration.test.js (which already
// proves the core Sunday/Monday-survive-rollover + idempotent-reward scenario
// at the service layer). This suite exercises the same production functions
// through REAL HTTP endpoints (real Express app, real JWTs, real MySQL), and
// covers scenarios the other suite does not: date-navigator reads across a
// rollover, wrong-approver / retarget authorization, denial date-scoping,
// concurrent duplicate approval requests, multi-source To-Do removal rules,
// out-of-scope authorization (teacher/parent), Super-Admin school-scope
// rejection, and a Solo User multi-day reset.
//
// Uses the real Nawah fixtures (Teacher Sarah id 6, Parent Ahmed id 2, School
// Admin id 5, Org 11 / Class 10) as ACTORS ONLY — Teachers/Parents/Admins carry
// no gamification balance, so acting through them is side-effect-free. Every
// Student is a fresh throwaway fixture cloned with the same org/class/parent
// relationships, per this repo's existing test convention of never touching a
// pre-existing Student (see personal-gameplay.integration.test.js). Nothing
// under the real named Students (Omar/Layla/Solo User) is read or written.
const enabled = process.env.RUN_DAILY_MISSION_LIFECYCLE_INTEGRATION === "true";

test("daily mission lifecycle: HTTP-level date navigation, approval authorization, and scope", { skip: !enabled }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.MYSQL_DB_HOST), "Only a loopback DB is allowed");
  process.env.DB_SYNC_ON_STARTUP = "false";
  const { sequelize, rundb } = require("../dist/config/db_connection");
  const model = (name) => require(`../dist/models/${name}.model`).default;
  const User = model("user"), Student = model("student"), Task = model("task"), Category = model("task-category");
  const Class = model("class"), Teacher = model("teacher"), Parent = model("parent"), Admin = model("admin");
  const StudentTask = model("student-task"), Todo = model("student-todo-item"), Source = model("student-todo-source");
  const Day = model("student-todo-day"), Request = model("mission-approval-request"), Event = model("mission-approval-request-event");
  const Challenge = model("challenge"), StudentChallenge = model("student-challenge");
  const { addOrAssignTodo, ensureTodoDay, utcGameplayDate } = require("../dist/services/studentTodoService");
  const { completeMissionForStudent } = require("../dist/helpers/completeMission");
  const { signAccessToken } = require("../dist/helpers/tokens");

  const tasksCreated = [];
  const usersCreated = [];
  const studentIds = [];
  const challengesCreated = [];
  let server;

  // Mirrors the ordering already proven safe in daily-mission.integration.test.js:
  // Events cascade from Requests; Requests before Days (Days RESTRICT-reference
  // Items, Requests only SET NULL); Sources before Items (belt-and-braces —
  // Sources also cascade from Items); Items last among To-Do rows since Days
  // RESTRICT against Items; StudentTasks and the Student itself last.
  const wipeStudent = async (studentId) => {
    if (!studentId) return;
    const todoIds = (await Todo.findAll({ where: { studentId }, attributes: ["id"] })).map((r) => r.id);
    await Request.destroy({ where: { studentId } });
    await Day.destroy({ where: { studentId } });
    if (todoIds.length) await Source.destroy({ where: { todoItemId: todoIds } });
    await Todo.destroy({ where: { studentId } });
    await StudentTask.destroy({ where: { studentId } });
    await StudentChallenge.destroy({ where: { studentId } });
    await Student.destroy({ where: { id: studentId } });
  };

  try {
    await rundb();
    await sequelize.authenticate();

    // ---- Fixed catalog fixtures (read-only: real Nawah org/class/teacher/parent/admin) ----
    const schoolClass = await Class.findByPk(10);
    assert.ok(schoolClass && schoolClass.organizationId === 11 && schoolClass.teacherId === 6,
      "Class 10 must be Nawah's Class 4A, taught by Teacher 6 — STOP: fixture assumption violated");
    const category = await Category.findOne();
    assert.ok(category, "Existing task category catalog required");
    const teacherRow = await Teacher.findByPk(6);
    const parentRow = await Parent.findByPk(2);
    const adminRow = await Admin.findByPk(5);
    assert.ok(teacherRow && parentRow && adminRow, "Sarah (Teacher 6), Ahmed (Parent 2), School Admin (5) must already exist");
    assert.equal(adminRow.organizationId, 11, "School Admin 5 must be scoped to Org 11");
    const teacherUser = await User.findByPk(teacherRow.userId, { attributes: ["id", "email", "role", "tokenVersion"] });
    const parentUser = await User.findByPk(parentRow.userId, { attributes: ["id", "email", "role", "tokenVersion"] });
    const adminUser = await User.findByPk(adminRow.userId, { attributes: ["id", "email", "role", "tokenVersion"] });
    const sarahToken = signAccessToken(teacherUser);
    const ahmedToken = signAccessToken(parentUser);
    const adminToken = signAccessToken(adminUser);

    const foreignClass = await Class.findOne({ where: { id: { [Op.ne]: 10 } } });
    assert.ok(foreignClass, "A second Class distinct from Class 10 is required for the out-of-scope test");

    // ---- Throwaway fixtures ----
    const suffix = `lifecycle_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const studentUser = await User.create({ firstName: "Lifecycle", lastName: "Student", role: "Student", email: `${suffix}@example.invalid`, password: "unused", isAccess: true });
    usersCreated.push(studentUser.id);
    const student = await Student.create({ userId: studentUser.id, organizationId: 11, classId: 10, ParentId: 2, treeProgress: 1, connectCode: suffix.slice(-8), xp: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0 });
    studentIds.push(student.id);
    const studentToken = signAccessToken(studentUser);

    const foreignSuffix = `foreign_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const foreignUser = await User.create({ firstName: "Foreign", lastName: "Student", role: "Student", email: `${foreignSuffix}@example.invalid`, password: "unused", isAccess: true });
    usersCreated.push(foreignUser.id);
    const foreignStudent = await Student.create({ userId: foreignUser.id, organizationId: foreignClass.organizationId, classId: foreignClass.id, ParentId: null, treeProgress: 1, connectCode: foreignSuffix.slice(-8), xp: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0 });
    studentIds.push(foreignStudent.id);

    const soloSuffix = `solo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const soloUser = await User.create({ firstName: "Lifecycle", lastName: "Solo", role: "Student", email: `${soloSuffix}@example.invalid`, password: "unused", isAccess: true });
    usersCreated.push(soloUser.id);
    const soloStudent = await Student.create({ userId: soloUser.id, organizationId: null, classId: null, ParentId: null, treeProgress: 1, connectCode: soloSuffix.slice(-8), xp: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0 });
    studentIds.push(soloStudent.id);
    const soloToken = signAccessToken(soloUser);

    const makeTask = async (label) => {
      const row = await Task.create({ title: `${suffix}_${label}`, type: `${suffix}_${label}`, categoryId: category.id, xp: 5, snabelRed: 1, snabelBlue: 1, snabelYellow: 1 });
      tasksCreated.push(row.id);
      return row;
    };
    const taskA = await makeTask("nav");
    const taskB = await makeTask("denial");
    const taskC = await makeTask("concurrency");
    const taskD = await makeTask("sources");
    const taskE = await makeTask("solo");
    const taskRace = await makeTask("race_both");
    const taskSelected = await makeTask("race_selected");
    const taskDirectRace = await makeTask("race_direct");
    const taskMidSelf = await makeTask("midday_self");
    const taskMidTeacher = await makeTask("midday_teacher");
    const taskMidParent = await makeTask("midday_parent");
    const taskMidRemoved = await makeTask("midday_removed");
    const taskMixedRemoval = await makeTask("mixed_removal");

    // A dedicated cumulative "one point per completed mission" challenge, so
    // the races below can prove a single completion contributes exactly one
    // point. Its threshold is deliberately unreachable within this suite: a
    // catalog challenge that completes mid-run would pay a bonus into the same
    // XP balance the reward assertions measure, and would then stop accruing.
    const cumulativeChallenge = await Challenge.create({ title: `${suffix}_alltask`, category: "alltask",
      point: 100000, xp: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0, water: 0, seeder: 0 });
    challengesCreated.push(cumulativeChallenge.id);
    await StudentChallenge.create({ studentId: student.id, challengeId: cumulativeChallenge.id,
      completionStatus: "NotCompleted", pointOfStudent: 0 });
    const challengePoints = async () => (await StudentChallenge.findOne({
      where: { studentId: student.id, challengeId: cumulativeChallenge.id } })).pointOfStudent;

    const app = express();
    app.use(express.json());
    app.use("/mission", require("../dist/routes/mission_routes").router);
    app.use("/teachers", require("../dist/routes/teacher_routes").router);
    app.use("/parents", require("../dist/routes/parent_routes").router);
    app.use("/students", require("../dist/routes/student_routes").router);
    app.use("/admin", require("../dist/routes/admin_routes").router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const call = (token) => async (method, path, data) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    const asStudent = call(studentToken), asSarah = call(sarahToken), asAhmed = call(ahmedToken), asAdmin = call(adminToken), asSolo = call(soloToken);

    const date = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
    const sunday = date(-3), monday = date(-2), tuesday = date(-1), wednesday = date(0);

    // Backdate the throwaway Student's createdAt so "Sunday" is a legal historical
    // date for it (GET /mission/todo rejects any date before account creation).
    await sequelize.query("UPDATE Students SET createdAt = :createdAt WHERE id = :id",
      { replacements: { createdAt: `${sunday} 00:00:00`, id: student.id } });

    // ================= Group A: /mission/todo date navigation =================
    await t.test("GET /mission/todo rejects a future date, a pre-account date, and a malformed date", async () => {
      const future = await asStudent("GET", `/mission/todo?date=${date(1)}`);
      assert.equal(future.status, 400);
      assert.match(future.body.message, /Future mission dates/);
      const tooOld = await asStudent("GET", `/mission/todo?date=${date(-4)}`);
      assert.equal(tooOld.status, 400);
      assert.match(tooOld.body.message, /predates this account/);
      const malformed = await asStudent("GET", "/mission/todo?date=2026-02-30");
      assert.equal(malformed.status, 400);
      assert.match(malformed.body.message, /Invalid date/);
    });

    let sundayRequestId, mondayRequestId;
    await t.test("seed Sunday (pending->Ahmed) and Monday (pending->Sarah) via the shared To-Do service", async () => {
      await sequelize.transaction(async (transaction) => {
        const { todo } = await addOrAssignTodo({ studentId: student.id, taskId: taskA.id, sourceType: "student", sourceId: student.id, date: sunday, transaction });
        const day = await ensureTodoDay(todo, sunday, transaction);
        const request = await Request.create({ studentId: student.id, missionId: taskA.id, missionDate: sunday, status: "pending", parentIds: [2], teacherIds: [], todoItemId: todo.id, todoDayId: day.id }, { transaction });
        await Event.create({ requestId: request.id, eventType: "REQUESTED", actorUserId: studentUser.id, targetApproverType: "parent", targetApproverIds: { parentIds: [2], teacherIds: [] } }, { transaction });
        await day.update({ status: "pending_approval" }, { transaction });
        sundayRequestId = request.id;
        const mondayTodo = (await addOrAssignTodo({ studentId: student.id, taskId: taskA.id, sourceType: "student", sourceId: student.id, date: monday, transaction })).todo;
        const mondayDay = await ensureTodoDay(mondayTodo, monday, transaction);
        const mondayRequest = await Request.create({ studentId: student.id, missionId: taskA.id, missionDate: monday, status: "pending", parentIds: [], teacherIds: [6], todoItemId: mondayTodo.id, todoDayId: mondayDay.id }, { transaction });
        await Event.create({ requestId: mondayRequest.id, eventType: "REQUESTED", actorUserId: studentUser.id, targetApproverType: "teacher", targetApproverIds: { parentIds: [], teacherIds: [6] } }, { transaction });
        await mondayDay.update({ status: "pending_approval" }, { transaction });
        mondayRequestId = mondayRequest.id;
        await ensureTodoDay(todo, tuesday, transaction); // Tuesday: created, left untouched (never requested).
      });
    });

    await t.test("GET /mission/todo?date=<day> reflects each day's own independent status", async () => {
      const sun = await asStudent("GET", `/mission/todo?date=${sunday}`);
      assert.equal(sun.status, 200);
      assert.equal(sun.body.data.items.find((i) => i.taskId === taskA.id).status, "pending_approval");
      const mon = await asStudent("GET", `/mission/todo?date=${monday}`);
      assert.equal(mon.body.data.items.find((i) => i.taskId === taskA.id).status, "pending_approval");
      const tue = await asStudent("GET", `/mission/todo?date=${tuesday}`);
      assert.equal(tue.body.data.items.find((i) => i.taskId === taskA.id).status, "todo", "Tuesday was never requested: stays todo, not pending");
    });

    await t.test("GET /mission/todo (today=Wednesday) surfaces the historical-pending banner fields", async () => {
      const today = await asStudent("GET", "/mission/todo");
      assert.equal(today.status, 200);
      assert.equal(today.body.data.isToday, true);
      assert.equal(today.body.data.historicalPendingCount, 2, "Sunday and Monday are both still pending from today's vantage point");
      assert.equal(today.body.data.oldestHistoricalPendingDate, sunday);
    });

    // ================= Group B: approval authorization over real HTTP =================
    await t.test("the non-targeted approver is refused; the targeted approver succeeds", async () => {
      const wrongApprover = await asSarah("POST", "/teachers/approveRequest", { requestId: sundayRequestId });
      assert.equal(wrongApprover.status, 403, "Sunday's request targeted Ahmed only; Sarah is not eligible for it");
      const before = await Student.findByPk(student.id);
      const approved = await asAhmed("POST", "/parents/approveRequest", { requestId: sundayRequestId });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.rewardsGranted, true);
      await student.reload();
      assert.deepEqual([student.xp - before.xp, student.snabelRed - before.snabelRed, student.snabelBlue - before.snabelBlue, student.snabelYellow - before.snabelYellow],
        [taskA.xp, taskA.snabelRed, taskA.snabelBlue, taskA.snabelYellow], "exactly one reward bundle for Sunday's Task");
      const monBefore = await Request.findByPk(mondayRequestId);
      assert.equal(monBefore.status, "pending", "approving Sunday must not resolve Monday");
    });

    await t.test("re-approving an already-resolved request grants nothing a second time", async () => {
      const before = await Student.findByPk(student.id);
      const retry = await asAhmed("POST", "/parents/approveRequest", { requestId: sundayRequestId });
      assert.equal(retry.status, 200);
      assert.equal(retry.body.alreadyResolved, true);
      await student.reload();
      assert.equal(student.xp, before.xp, "no additional reward on a duplicate approval call");
    });

    await t.test("retargeting Monday's request to Ahmed revokes Sarah's authority and grants Ahmed's", async () => {
      const retarget = await asStudent("POST", `/mission/approval/${mondayRequestId}/retarget`, { approverId: 2, approverType: "parent" });
      assert.equal(retarget.status, 200);
      const sarahNowRefused = await asSarah("POST", "/teachers/approveRequest", { requestId: mondayRequestId });
      assert.equal(sarahNowRefused.status, 403, "Sarah was retargeted away from; her snapshot authority is gone");
      const before = await Student.findByPk(student.id);
      const ahmedApproves = await asAhmed("POST", "/parents/approveRequest", { requestId: mondayRequestId });
      assert.equal(ahmedApproves.status, 200);
      assert.equal(ahmedApproves.body.rewardsGranted, true);
      await student.reload();
      assert.equal(student.xp - before.xp, taskA.xp, "Monday grants its own single reward bundle");
      const events = await Event.findAll({ where: { requestId: mondayRequestId }, order: [["id", "ASC"]] });
      assert.deepEqual(events.map((e) => e.eventType), ["REQUESTED", "RETARGETED"], "retarget history is preserved, not overwritten");
    });

    await t.test("two dates, two distinct completions: no cross-date double reward", async () => {
      const completions = await StudentTask.findAll({ where: { studentId: student.id, taskId: taskA.id }, order: [["date", "ASC"]] });
      assert.deepEqual(completions.map((c) => c.date), [sunday, monday]);
      assert.equal(new Set(completions.map((c) => c.completionKey)).size, 2);
    });

    let denialDayId;
    await t.test("denial leaves the mission incomplete and does not block the next day's independent attempt", async () => {
      let mondayDenialRequestId;
      await sequelize.transaction(async (transaction) => {
        const { todo } = await addOrAssignTodo({ studentId: student.id, taskId: taskB.id, sourceType: "student", sourceId: student.id, date: monday, transaction });
        const day = await ensureTodoDay(todo, monday, transaction);
        denialDayId = day.id;
        const request = await Request.create({ studentId: student.id, missionId: taskB.id, missionDate: monday, status: "pending", parentIds: [], teacherIds: [6], todoItemId: todo.id, todoDayId: day.id }, { transaction });
        await day.update({ status: "pending_approval" }, { transaction });
        mondayDenialRequestId = request.id;
      });
      const denied = await asSarah("POST", "/teachers/denyRequest", { requestId: mondayDenialRequestId });
      assert.equal(denied.status, 200);
      const dayAfterDenial = await Day.findByPk(denialDayId);
      assert.equal(dayAfterDenial.status, "todo", "denial reverts the day to todo, not completed");
      assert.equal(await StudentTask.count({ where: { studentId: student.id, taskId: taskB.id } }), 0, "no reward for a denied request");

      const before = await Student.findByPk(student.id);
      let wednesdayRequestId;
      await sequelize.transaction(async (transaction) => {
        const { todo } = await addOrAssignTodo({ studentId: student.id, taskId: taskB.id, sourceType: "student", sourceId: student.id, date: wednesday, transaction });
        const day = await ensureTodoDay(todo, wednesday, transaction);
        const request = await Request.create({ studentId: student.id, missionId: taskB.id, missionDate: wednesday, status: "pending", parentIds: [], teacherIds: [6], todoItemId: todo.id, todoDayId: day.id }, { transaction });
        await day.update({ status: "pending_approval" }, { transaction });
        wednesdayRequestId = request.id;
      });
      const approved = await asSarah("POST", "/teachers/approveRequest", { requestId: wednesdayRequestId });
      assert.equal(approved.status, 200);
      await student.reload();
      assert.equal(student.xp - before.xp, taskB.xp, "the denied Monday attempt never contributes a reward; only Wednesday's approval does");
      assert.equal(await StudentTask.count({ where: { studentId: student.id, taskId: taskB.id } }), 1, "exactly one completion for this Task despite two attempts");
    });

    await t.test("five simultaneous requestApproval calls settle to exactly one request, one occurrence and one audit event (regression: ER_LOCK_DEADLOCK)", async () => {
      await asStudent("POST", "/mission/todo", { taskId: taskC.id });
      const results = await Promise.all(Array.from({ length: 5 }, () => asStudent("POST", "/mission/requestApproval", { taskId: taskC.id })));
      assert.ok(results.every((r) => r.status === 200 || r.status === 201),
        `every concurrent double-submit must resolve cleanly, never a raw error: ${JSON.stringify(results.map((r) => r.status))}`);
      assert.equal(results.filter((r) => r.status === 201).length, 1, "exactly one call creates the request");
      assert.equal(results.filter((r) => r.status === 200 && r.body.alreadyPending).length, 4,
        "every other caller observes the existing pending request");
      const requests = await Request.findAll({ where: { studentId: student.id, missionId: taskC.id } });
      assert.equal(requests.length, 1, "no duplicate request row of any status under a concurrent double-submit");
      assert.equal(requests[0].status, "pending");
      assert.equal(requests[0].missionDate, wednesday, "the request is dated by the server's canonical today");
      assert.equal(await Day.count({ where: { studentId: student.id, taskId: taskC.id } }), 1,
        "exactly one StudentTodoDay occurrence, even though five calls raced to materialize it");
      assert.equal(await Day.count({ where: { studentId: student.id, taskId: taskC.id, missionDate: wednesday, status: "pending_approval" } }), 1);
      // A deadlock rolls its whole transaction back, so a retried attempt must
      // not leave a second REQUESTED row behind as audit noise.
      const events = await Event.findAll({ where: { requestId: requests[0].id } });
      assert.deepEqual(events.map((e) => e.eventType), ["REQUESTED"],
        "one logical request creation produces exactly one REQUESTED event, retries included");
      assert.equal(results.filter((r) => r.status === 201)[0].body.data.id, requests[0].id);
      assert.equal(await StudentTask.count({ where: { studentId: student.id, taskId: taskC.id } }), 0,
        "requesting approval never completes or rewards anything");
    });

    await t.test("canonical rule: with no approver chosen, BOTH the class Teacher and the linked Parent are authorized for the request", async () => {
      await asStudent("POST", "/mission/todo", { taskId: taskRace.id });
      const created = await asStudent("POST", "/mission/requestApproval", { taskId: taskRace.id });
      assert.equal(created.status, 201);
      const row = await Request.findByPk(created.body.data.id);
      assert.deepEqual([row.parentIds, row.teacherIds], [[2], [6]],
        "the eligibility snapshot names both approvers when the student picks neither");
    });

    await t.test("two authorized approvers racing the same request yield one completion, one reward, one challenge point", async () => {
      const row = await Request.findOne({ where: { studentId: student.id, missionId: taskRace.id, status: "pending" } });
      const before = await Student.findByPk(student.id);
      const pointsBefore = await challengePoints();
      const [sarahResult, ahmedResult] = await Promise.all([
        asSarah("POST", "/teachers/approveRequest", { requestId: row.id }),
        asAhmed("POST", "/parents/approveRequest", { requestId: row.id }),
      ]);

      const statuses = [sarahResult.status, ahmedResult.status];
      assert.ok(statuses.every((code) => code === 200),
        `no 500 and no escaped deadlock may reach HTTP: ${JSON.stringify(statuses)}`);
      const outcomes = [sarahResult.body, ahmedResult.body];
      assert.equal(outcomes.filter((body) => body.rewardsGranted === true).length, 1, "exactly one caller grants the reward");
      assert.equal(outcomes.filter((body) => body.alreadyResolved === true).length, 1, "the loser gets a clean already-resolved result");

      const completions = await StudentTask.findAll({ where: { studentId: student.id, taskId: taskRace.id } });
      assert.equal(completions.length, 1, "exactly one StudentTask");
      assert.equal(completions[0].date, wednesday);
      assert.equal(completions[0].completionKey, `${student.id}:${taskRace.id}:${wednesday}`, "exactly one completionKey");
      await student.reload();
      assert.deepEqual(
        [student.xp - before.xp, student.snabelRed - before.snabelRed, student.snabelBlue - before.snabelBlue, student.snabelYellow - before.snabelYellow],
        [taskRace.xp, taskRace.snabelRed, taskRace.snabelBlue, taskRace.snabelYellow], "exactly one reward bundle");
      assert.equal(await challengePoints() - pointsBefore, 1, "exactly one challenge contribution");
      assert.equal((await Request.findByPk(row.id)).status, "approved", "final request state is approved");
      assert.equal((await Day.findOne({ where: { studentId: student.id, taskId: taskRace.id, missionDate: wednesday } })).status, "completed",
        "final StudentTodoDay state is completed");
    });

    await t.test("when the student selects one approver, a concurrent non-selected approver is cleanly refused", async () => {
      await asStudent("POST", "/mission/todo", { taskId: taskSelected.id });
      const created = await asStudent("POST", "/mission/requestApproval", { taskId: taskSelected.id, approverId: 6, approverType: "teacher" });
      assert.equal(created.status, 201);
      const row = await Request.findByPk(created.body.data.id);
      assert.deepEqual([row.parentIds, row.teacherIds], [[], [6]], "selecting Sarah narrows the snapshot to Sarah alone");

      const before = await Student.findByPk(student.id);
      const pointsBefore = await challengePoints();
      const [sarahResult, ahmedResult] = await Promise.all([
        asSarah("POST", "/teachers/approveRequest", { requestId: row.id }),
        asAhmed("POST", "/parents/approveRequest", { requestId: row.id }),
      ]);
      assert.equal(sarahResult.status, 200, "the selected approver succeeds");
      assert.equal(sarahResult.body.rewardsGranted, true);
      assert.equal(ahmedResult.status, 403, "an otherwise-related but non-selected approver is refused, even in a race");
      assert.match(ahmedResult.body.message, /Not authorized/);

      assert.equal(await StudentTask.count({ where: { studentId: student.id, taskId: taskSelected.id } }), 1);
      await student.reload();
      assert.equal(student.xp - before.xp, taskSelected.xp, "exactly one reward despite the racing refusal");
      assert.equal(await challengePoints() - pointsBefore, 1);
      assert.equal((await Request.findByPk(row.id)).status, "approved");
    });

    await t.test("approval racing a Teacher/Parent direct completion for the same day yields one completion only", async () => {
      // Direct completion is always dated to the server's today, so today is
      // the only day on which these two paths can collide at all.
      await asStudent("POST", "/mission/todo", { taskId: taskDirectRace.id });
      const created = await asStudent("POST", "/mission/requestApproval", { taskId: taskDirectRace.id, approverId: 6, approverType: "teacher" });
      assert.equal(created.status, 201);
      const before = await Student.findByPk(student.id);
      const pointsBefore = await challengePoints();

      const [approval, direct] = await Promise.all([
        asSarah("POST", "/teachers/approveRequest", { requestId: created.body.data.id }),
        asAhmed("POST", "/parents/add-pros", { taskId: taskDirectRace.id, studentIds: [student.id] }),
      ]);
      assert.equal(approval.status, 200, "the approval path never 500s under the race");
      assert.equal(direct.status, 200, "the direct-completion path never 500s under the race");
      assert.ok(["completed", "already_completed"].includes(direct.body.results[0].status), JSON.stringify(direct.body.results[0]));

      const completions = await StudentTask.findAll({ where: { studentId: student.id, taskId: taskDirectRace.id } });
      assert.equal(completions.length, 1, "the completionKey unique index leaves exactly one canonical completion");
      assert.equal(completions[0].date, wednesday);
      await student.reload();
      assert.equal(student.xp - before.xp, taskDirectRace.xp, "exactly one reward bundle across both paths");
      assert.equal(await challengePoints() - pointsBefore, 1, "exactly one challenge contribution across both paths");
      assert.equal((await Request.findByPk(created.body.data.id)).status, "approved", "no request is left incorrectly pending");
      assert.equal((await Day.findOne({ where: { studentId: student.id, taskId: taskDirectRace.id, missionDate: wednesday } })).status, "completed");
    });

    await t.test("GET /mission/myRequestStatus answers per requested day and defaults to the server's today", async () => {
      const sundayStatus = await asStudent("GET", `/mission/myRequestStatus?taskId=${taskA.id}&missionDate=${sunday}`);
      assert.equal(sundayStatus.status, 200);
      assert.equal(sundayStatus.body.data.id, sundayRequestId, "Sunday returns Sunday's request");
      assert.equal(sundayStatus.body.data.missionDate, sunday);

      const mondayStatus = await asStudent("GET", `/mission/myRequestStatus?taskId=${taskA.id}&missionDate=${monday}`);
      assert.equal(mondayStatus.body.data.id, mondayRequestId, "Monday returns Monday's request, not Sunday's");
      assert.equal(mondayStatus.body.data.missionDate, monday);
      assert.notEqual(sundayRequestId, mondayRequestId);

      const tuesdayStatus = await asStudent("GET", `/mission/myRequestStatus?taskId=${taskA.id}&missionDate=${tuesday}`);
      assert.equal(tuesdayStatus.body.data, null, "Tuesday was never requested, and no other day bleeds into it");

      const implicit = await asStudent("GET", `/mission/myRequestStatus?taskId=${taskA.id}`);
      assert.equal(implicit.body.missionDate, wednesday, "omitting missionDate means the server's canonical today");
      assert.equal(implicit.body.data, null, "today has no request for this Task, and history does not leak forward");

      const todayRequest = await asStudent("GET", `/mission/myRequestStatus?taskId=${taskC.id}`);
      assert.equal(todayRequest.body.data.missionDate, wednesday, "today's own pending request is returned by default");

      const future = await asStudent("GET", `/mission/myRequestStatus?taskId=${taskA.id}&missionDate=${date(1)}`);
      assert.equal(future.status, 400, "a device a day ahead cannot read tomorrow");
      const malformed = await asStudent("GET", `/mission/myRequestStatus?taskId=${taskA.id}&missionDate=2026-02-30`);
      assert.equal(malformed.status, 400);
    });

    // ================= Group C: multiple assignment sources =================
    await t.test("self + teacher + parent sources collapse to one persistent item; removal is blocked while any non-self source remains", async () => {
      const selfAdd = await asStudent("POST", "/mission/todo", { taskId: taskD.id });
      assert.equal(selfAdd.status, 201);
      const todoId = selfAdd.body.data.id;
      const teacherAssign = await asSarah("POST", "/teachers/assign-mission", { taskId: taskD.id, studentIds: [student.id] });
      assert.equal(teacherAssign.status, 200);
      assert.equal(teacherAssign.body.results[0].status, "existing", "same persistent item, not a duplicate");
      const parentAssign = await asAhmed("POST", "/parents/assign-mission", { taskId: taskD.id, studentIds: [student.id] });
      assert.equal(parentAssign.status, 200);
      assert.equal(await Todo.count({ where: { studentId: student.id, taskId: taskD.id } }), 1, "one persistent StudentTodoItem despite three sources");
      const sources = await Source.findAll({ where: { todoItemId: todoId } });
      assert.deepEqual(sources.map((s) => s.sourceType).sort(), ["parent", "student", "teacher"]);
      const removeAttempt = await asStudent("DELETE", `/mission/todo/${todoId}`);
      assert.equal(removeAttempt.status, 403, "current product behavior: a Student cannot remove their own source once ANY other source exists (no partial-source removal)");
      assert.equal((await Todo.findByPk(todoId)).isActive, true, "the assignment is not deleted by the refused removal attempt");
    });

    // ================= Group C2: mid-day membership lifecycle =================
    // A membership is visible on a date when it existed by the end of that date
    // and had not yet been removed. These cases pin that window from both ends.
    const backdateMembership = async (taskId, createdAt) => {
      const todo = await Todo.findOne({ where: { studentId: student.id, taskId } });
      assert.ok(todo, `membership for task ${taskId} must exist before backdating`);
      await sequelize.query("UPDATE StudentTodoItems SET createdAt = :createdAt WHERE id = :id",
        { replacements: { createdAt, id: todo.id } });
      return todo;
    };
    const listOn = async (day) => {
      const response = await asStudent("GET", `/mission/todo?date=${day}`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.data.items;
    };
    const hasTask = (items, taskId) => items.some((item) => item.taskId === taskId);

    for (const [label, taskRow, assign] of [
      ["Student self-adds", taskMidSelf, () => asStudent("POST", "/mission/todo", { taskId: taskMidSelf.id })],
      ["Teacher assigns", taskMidTeacher, () => asSarah("POST", "/teachers/assign-mission", { taskId: taskMidTeacher.id, studentIds: [student.id] })],
      ["Parent assigns", taskMidParent, () => asAhmed("POST", "/parents/assign-mission", { taskId: taskMidParent.id, studentIds: [student.id] })],
    ]) {
      await t.test(`${label} a mission on Tuesday afternoon: absent Monday, live Tuesday, recurring Wednesday`, async () => {
        const response = await assign();
        assert.ok([200, 201].includes(response.status), JSON.stringify(response.body));
        await backdateMembership(taskRow.id, `${tuesday} 15:00:00`);

        assert.equal(hasTask(await listOn(monday), taskRow.id), false,
          "a mission added on Tuesday must never appear in Monday's history");
        assert.equal(await Day.count({ where: { studentId: student.id, taskId: taskRow.id, missionDate: monday } }), 0,
          "and no Monday occurrence is fabricated for it");

        const tuesdayItems = await listOn(tuesday);
        assert.equal(hasTask(tuesdayItems, taskRow.id), true, "it is live from the day it was added");
        assert.equal(tuesdayItems.find((item) => item.taskId === taskRow.id).status, "todo", "and actionable, not pre-completed");

        const wednesdayItems = await listOn(wednesday);
        assert.equal(hasTask(wednesdayItems, taskRow.id), true, "and it recurs normally the next day");
        assert.equal(wednesdayItems.find((item) => item.taskId === taskRow.id).status, "todo");
        assert.equal(await Day.count({ where: { studentId: student.id, taskId: taskRow.id } }), 2,
          "exactly one occurrence per eligible day, Tuesday and Wednesday");
      });
    }

    await t.test("assignment source and original assignment date survive the daily reset", async () => {
      const teacherItem = (await listOn(wednesday)).find((item) => item.taskId === taskMidTeacher.id);
      assert.deepEqual(teacherItem.Sources.map((source) => source.sourceType), ["teacher"],
        "Wednesday's fresh occurrence still knows Sarah assigned it");
      assert.equal(teacherItem.Sources[0].sourceId, 6);
      const parentItem = (await listOn(wednesday)).find((item) => item.taskId === taskMidParent.id);
      assert.deepEqual(parentItem.Sources.map((source) => source.sourceType), ["parent"]);
      const membership = await Todo.findOne({ where: { studentId: student.id, taskId: taskMidTeacher.id } });
      assert.equal(utcGameplayDate(membership.createdAt), tuesday,
        "the persistent assignment date stays Tuesday; it is not rewritten to today by the new day's occurrence");
    });

    await t.test("removing a self-added mission stops future occurrences and destroys no history", async () => {
      const added = await asStudent("POST", "/mission/todo", { taskId: taskMidRemoved.id });
      assert.equal(added.status, 201);
      const todo = await backdateMembership(taskMidRemoved.id, `${sunday} 09:00:00`);
      await listOn(monday);
      await listOn(tuesday);
      // Give the mission real history: a completed Monday and a pending Tuesday.
      await sequelize.transaction((transaction) => completeMissionForStudent({ studentId: student.id,
        taskId: taskMidRemoved.id, missionDate: monday, source: "approval_teacher", approverId: 6, approverType: "teacher", transaction }));
      const tuesdayDay = await Day.findOne({ where: { studentId: student.id, taskId: taskMidRemoved.id, missionDate: tuesday } });
      const historicalRequest = await Request.create({ studentId: student.id, missionId: taskMidRemoved.id, missionDate: tuesday,
        status: "pending", parentIds: [], teacherIds: [6], todoItemId: todo.id, todoDayId: tuesdayDay.id });
      await tuesdayDay.update({ status: "pending_approval" });

      const removed = await asStudent("DELETE", `/mission/todo/${todo.id}`);
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      await todo.reload();
      assert.equal(todo.isActive, false);
      assert.equal(todo.activeKey, null);
      assert.ok(todo.removedAt, "removal is recorded, the row is not deleted");

      assert.equal(hasTask(await listOn(monday), taskMidRemoved.id), true, "Monday's completed history survives removal");
      assert.equal((await listOn(monday)).find((item) => item.taskId === taskMidRemoved.id).status, "completed");
      assert.equal((await listOn(tuesday)).find((item) => item.taskId === taskMidRemoved.id).status, "pending_approval",
        "Tuesday's pending request survives removal and stays approvable");
      assert.equal((await Request.findByPk(historicalRequest.id)).status, "pending");
      assert.equal(await StudentTask.count({ where: { studentId: student.id, taskId: taskMidRemoved.id } }), 1,
        "no historical completion is deleted");

      // Removal happens through today's card, so removeMyTodo materialized
      // today's occurrence while checking that the card was still open. Clear
      // that one artifact, then prove the membership no longer generates any.
      await Day.destroy({ where: { studentId: student.id, taskId: taskMidRemoved.id, missionDate: wednesday } });
      assert.equal(hasTask(await listOn(wednesday), taskMidRemoved.id), false, "no occurrence after removal");
      assert.equal(await Day.count({ where: { studentId: student.id, taskId: taskMidRemoved.id, missionDate: wednesday } }), 0,
        "and re-opening the list does not regenerate one");
    });

    await t.test("documented behavior: a Student cannot remove a mission that anyone else also assigned", async () => {
      const added = await asStudent("POST", "/mission/todo", { taskId: taskMixedRemoval.id });
      assert.equal(added.status, 201);
      const todoId = added.body.data.id;
      assert.equal((await asSarah("POST", "/teachers/assign-mission", { taskId: taskMixedRemoval.id, studentIds: [student.id] })).status, 200);

      const refused = await asStudent("DELETE", `/mission/todo/${todoId}`);
      assert.equal(refused.status, 403, "current product rule: removal is all-or-nothing, there is no per-source removal");
      assert.match(refused.body.message, /assigned mission cannot be removed/);

      const sources = await Source.findAll({ where: { todoItemId: todoId } });
      assert.deepEqual(sources.map((s) => s.sourceType).sort(), ["student", "teacher"],
        "the refused removal drops neither the Teacher's assignment nor the Student's own source");
      assert.equal((await Todo.findByPk(todoId)).isActive, true);
      assert.equal(hasTask(await listOn(wednesday), taskMixedRemoval.id), true, "future recurrence continues");
    });

    // ================= Group D: authorization scope =================
    await t.test("Teacher cannot act on a Student outside their class; Parent cannot act on a Student who is not their child", async () => {
      const teacherOnForeign = await asSarah("POST", "/teachers/add-pros", { taskId: taskA.id, studentIds: [foreignStudent.id] });
      assert.equal(teacherOnForeign.status, 200);
      assert.equal(teacherOnForeign.body.results[0].status, "unauthorized");
      const parentOnForeign = await asAhmed("POST", "/parents/add-pros", { taskId: taskA.id, studentIds: [foreignStudent.id] });
      assert.equal(parentOnForeign.status, 200);
      assert.equal(parentOnForeign.body.results[0].status, "unauthorized");
      const assignOnForeign = await asSarah("POST", "/teachers/assign-mission", { taskId: taskA.id, studentIds: [foreignStudent.id] });
      assert.equal(assignOnForeign.body.results[0].status, "unauthorized");
      assert.equal(await StudentTask.count({ where: { studentId: foreignStudent.id } }), 0, "no reward leaked to the out-of-scope Student");
    });

    await t.test("today's completed count is the canonical UTC mission day, not rows touched today", async () => {
      // Sunday's and Monday's missions were approved during this run, so their
      // rows were written today. Counting by row-touch time would report them
      // as completed today; the count must follow the mission's own date.
      const staleButTouchedToday = await StudentTask.count({ where: { studentId: student.id,
        completionStatus: "Completed", date: { [Op.lt]: wednesday } } });
      assert.ok(staleButTouchedToday > 0, "fixture requires at least one earlier mission approved during this run");
      const completedToday = await StudentTask.count({ where: { studentId: student.id,
        completionStatus: "Completed", date: wednesday } });

      const response = await asStudent("GET", "/students/task-count-sucess");
      assert.equal(response.status, 200);
      assert.equal(response.body.completedTasksCount, completedToday,
        "the School Student count matches today's mission date exactly");
      assert.notEqual(response.body.completedTasksCount, completedToday + staleButTouchedToday,
        "a late approval of an older mission must not inflate today's counter");
    });

    // ================= Group E: Super-Admin analytics stays out of School Admin's reach =================
    await t.test("a School Admin (Org 11) is refused Super-Admin-only analytics", async () => {
      const result = await asAdmin("GET", "/admin/analytics/approvals");
      assert.equal(result.status, 403, "Admins.organizationId=11 is a School Admin, not a Super Admin");
    });

    // ================= Group F: Solo User =================
    await t.test("Solo User: two distinct mission-dates via the shared completion function grant two independent rewards", async () => {
      const before = await Student.findByPk(soloStudent.id);
      await sequelize.transaction((transaction) => completeMissionForStudent({ studentId: soloStudent.id, taskId: taskE.id, missionDate: monday, source: "solo_self", transaction }));
      await sequelize.transaction((transaction) => completeMissionForStudent({ studentId: soloStudent.id, taskId: taskE.id, missionDate: wednesday, source: "solo_self", transaction }));
      const completions = await StudentTask.findAll({ where: { studentId: soloStudent.id, taskId: taskE.id }, order: [["date", "ASC"]] });
      assert.deepEqual(completions.map((c) => c.date), [monday, wednesday]);
      assert.equal(new Set(completions.map((c) => c.completionKey)).size, 2);
      await soloStudent.reload();
      assert.equal(soloStudent.xp - before.xp, taskE.xp * 2, "two distinct mission-dates grant two full reward bundles");
      assert.equal(await Todo.count({ where: { studentId: soloStudent.id } }), 0, "Solo Users never get a StudentTodoItem/approval row");
      assert.equal(await Request.count({ where: { studentId: soloStudent.id } }), 0);
    });

    await t.test("Solo User cannot reach the School approval endpoints", async () => {
      const todoAttempt = await asSolo("GET", "/mission/todo");
      assert.equal(todoAttempt.status, 400);
      assert.match(todoAttempt.body.message, /personal To-Do/);
      const approvalAttempt = await asSolo("POST", "/mission/requestApproval", { taskId: taskE.id });
      assert.equal(approvalAttempt.status, 400);
      assert.match(approvalAttempt.body.message, /does not require mission approval/);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const studentId of studentIds) {
      try { await wipeStudent(studentId); } catch (error) { console.error("cleanup: wipeStudent failed", studentId, error.message); }
    }
    for (const taskId of tasksCreated) {
      try { await Task.destroy({ where: { id: taskId } }); } catch (error) { console.error("cleanup: Task destroy failed", taskId, error.message); }
    }
    for (const challengeId of challengesCreated) {
      try { await Challenge.destroy({ where: { id: challengeId } }); } catch (error) { console.error("cleanup: Challenge destroy failed", challengeId, error.message); }
    }
    for (const userId of usersCreated) {
      try { await User.destroy({ where: { id: userId } }); } catch (error) { console.error("cleanup: User destroy failed", userId, error.message); }
    }
    await sequelize.close();
  }
});
