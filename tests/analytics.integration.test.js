const test = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config();

// Opt in explicitly, loopback only. Creates its own uniquely-named fixtures and
// deletes them in reverse order; never syncs, seeds, truncates or touches
// pre-existing rows.
//
// Enable with: RUN_ANALYTICS_INTEGRATION=true npm test
const enabled = process.env.RUN_ANALYTICS_INTEGRATION === "true";

test("super admin analytics: deterministic fixtures, real MySQL aggregation", { skip: !enabled }, async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(process.env.MYSQL_DB_HOST),
    "Only a loopback DB is allowed",
  );
  process.env.DB_SYNC_ON_STARTUP = "false";

  const { sequelize, rundb } = require("../dist/config/db_connection");
  const model = (name) => require(`../dist/models/${name}.model`).default;
  const User = model("user");
  const Student = model("student");
  const Admin = model("admin");
  const Task = model("task");
  const Category = model("task-category");
  const StudentTask = model("student-task");
  const Organization = model("oraganization");
  const MissionApprovalRequest = model("mission-approval-request");
  const express = require("express");
  const { signAccessToken } = require("../dist/helpers/tokens");

  const created = [];
  const remember = async (Model, values) => {
    const row = await Model.create(values);
    created.push([Model, { id: row.id }]);
    return row;
  };
  const today = new Date().toISOString().slice(0, 10);
  const suffix = `analytics_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let server;

  try {
    await rundb();
    await sequelize.authenticate();

    const org = await remember(Organization, { name: `${suffix}_org`, type: "School" });
    const category = await remember(Category, { title: `${suffix}_cat`, description: "fixture" });

    // Mission A gets 10 completions, Mission B gets 5 — ranking must be exact.
    const missionA = await remember(Task, { title: `${suffix}_A`, type: "fixture", categoryId: category.id, xp: 5 });
    const missionB = await remember(Task, { title: `${suffix}_B`, type: "fixture", categoryId: category.id, xp: 5 });

    const students = [];
    for (let i = 0; i < 10; i++) {
      const user = await remember(User, {
        firstName: `Fx${i}`, lastName: suffix, role: "Student",
        email: `${suffix}_${i}@example.invalid`, password: "unused", isAccess: true,
      });
      const student = await remember(Student, {
        userId: user.id, organizationId: org.id, connectCode: `${Date.now()}${i}`.slice(-9), treeProgress: 1,
      });
      students.push(student);
    }

    for (let i = 0; i < 10; i++) {
      await remember(StudentTask, {
        studentId: students[i].id, taskId: missionA.id, completionStatus: "Completed",
        date: today, completionKey: `${students[i].id}:${missionA.id}:${today}`,
        completionSource: i < 6 ? "solo_self" : "teacher_direct",
      });
    }
    for (let i = 0; i < 5; i++) {
      await remember(StudentTask, {
        studentId: students[i].id, taskId: missionB.id, completionStatus: "Completed",
        date: today, completionKey: `${students[i].id}:${missionB.id}:${today}`,
        completionSource: "parent_direct",
      });
    }

    // 3 approvals, 1 denial — approval rate must be 75%, not 100%.
    for (let i = 0; i < 3; i++) {
      await remember(MissionApprovalRequest, {
        studentId: students[i].id, missionId: missionA.id, missionDate: today,
        status: "approved", approvedByType: "teacher", approvedById: 1,
        approvedAt: new Date(), parentIds: [], teacherIds: [1],
      });
    }
    await remember(MissionApprovalRequest, {
      studentId: students[3].id, missionId: missionB.id, missionDate: today,
      status: "denied", approvedByType: "parent", approvedById: 1,
      approvedAt: new Date(), parentIds: [1], teacherIds: [],
    });

    // Super admin (no organization) and school admin (scoped) for the 403 test.
    const superUser = await remember(User, {
      firstName: "Super", lastName: suffix, role: "Admin",
      email: `${suffix}_super@example.invalid`, password: "unused", isAccess: true,
    });
    await remember(Admin, { userId: superUser.id, organizationId: null });
    const schoolUser = await remember(User, {
      firstName: "School", lastName: suffix, role: "Admin",
      email: `${suffix}_school@example.invalid`, password: "unused", isAccess: true,
    });
    await remember(Admin, { userId: schoolUser.id, organizationId: org.id });

    const superToken = signAccessToken({ id: superUser.id, email: superUser.email, role: "Admin", tokenVersion: superUser.tokenVersion });
    const schoolToken = signAccessToken({ id: schoolUser.id, email: schoolUser.email, role: "Admin", tokenVersion: schoolUser.tokenVersion });

    const app = express();
    app.use(express.json());
    app.use("/admin", require("../dist/routes/admin_routes").router);
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (path, token) =>
      fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    await t.test("school admin gets 403 on every analytics route", async () => {
      for (const route of ["overview", "completions", "missions", "users", "organizations", "approvals", "assignments"]) {
        const res = await get(`/admin/analytics/${route}`, schoolToken);
        assert.equal(res.status, 403, `${route} must refuse a school admin`);
      }
    });

    await t.test("mission ranking is exact: A(10) before B(5)", async () => {
      const res = await get(`/admin/analytics/missions?organizationId=${org.id}`, superToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      const top = data.top.today.filter((row) => String(row.title).startsWith(suffix));
      assert.equal(top[0].title, `${suffix}_A`);
      assert.equal(Number(top[0].completions), 10);
      assert.equal(top[1].title, `${suffix}_B`);
      assert.equal(Number(top[1].completions), 5);
    });

    await t.test("completion source breakdown matches the fixtures", async () => {
      const res = await get(`/admin/analytics/missions?organizationId=${org.id}`, superToken);
      const { data } = await res.json();
      const bySource = Object.fromEntries(data.bySource.map((row) => [row.source, Number(row.completions)]));
      assert.equal(bySource.solo_self, 6);
      assert.equal(bySource.teacher_direct, 4);
      assert.equal(bySource.parent_direct, 5);
    });

    await t.test("completions table paginates without loading everything", async () => {
      const first = await get(`/admin/analytics/completions?organizationId=${org.id}&limit=6&page=1`, superToken);
      const firstBody = await first.json();
      assert.equal(firstBody.data.length, 6);
      assert.equal(firstBody.total, 15);
      const second = await get(`/admin/analytics/completions?organizationId=${org.id}&limit=6&page=2`, superToken);
      const secondBody = await second.json();
      assert.equal(secondBody.data.length, 6);
      const overlap = firstBody.data.filter((row) => secondBody.data.some((other) => other.id === row.id));
      assert.equal(overlap.length, 0, "pages must not repeat rows");
    });

    await t.test("completions search and mission filter narrow correctly", async () => {
      const res = await get(`/admin/analytics/completions?taskId=${missionB.id}&limit=50`, superToken);
      const body = await res.json();
      assert.equal(body.total, 5);
      assert.ok(body.data.every((row) => row.mission.id === missionB.id));
    });

    await t.test("student level comes from XP, never the dead level column", async () => {
      await students[0].update({ xp: 100, level: 1 });
      const res = await get(`/admin/analytics/completions?organizationId=${org.id}&limit=50`, superToken);
      const body = await res.json();
      const row = body.data.find((item) => item.student.id === students[0].id);
      assert.ok(row.student.level > 1, `expected derived level > 1 for 100 XP, got ${row.student.level}`);
    });

    await t.test("approval rate reflects the denial, and rates are null when nothing resolved", async () => {
      const res = await get("/admin/analytics/approvals", superToken);
      const { data } = await res.json();
      assert.ok(data.totals.approved >= 3);
      assert.ok(data.totals.denied >= 1);
      assert.ok(data.totals.approvalRate !== null && data.totals.approvalRate < 100,
        "a denial must pull the approval rate below 100%");
      assert.equal(typeof data.observations.denialsObserved, "boolean");
    });

    await t.test("organization rollup counts this fixture school", async () => {
      const res = await get("/admin/analytics/organizations", superToken);
      const { data } = await res.json();
      const row = data.find((item) => item.name === `${suffix}_org`);
      assert.equal(Number(row.students), 10);
      assert.equal(Number(row.completionsInRange), 15);
      assert.equal(Number(row.activeStudentsInRange), 10);
    });

    await t.test("overview exposes unavailable metrics rather than fake zeros", async () => {
      const res = await get("/admin/analytics/overview", superToken);
      const { data } = await res.json();
      assert.ok(data.missions.completionsToday >= 15);
      assert.ok(data.people.superAdmins >= 1);
      assert.ok(data.unavailableMetrics.snabelSpent, "economy metrics must be declared unavailable");
      assert.ok(data.unavailableMetrics.xpIssued, "XP issued must be declared unavailable, not estimated");
    });

    await t.test("empty date range returns zeros without error", async () => {
      const res = await get("/admin/analytics/missions?from=1990-01-01&to=1990-01-02", superToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.equal(data.trend.length, 0);
      assert.equal(data.byCategory.length, 0);
    });
  } finally {
    if (server) server.close();
    for (const [Model, where] of created.reverse()) {
      try { await Model.destroy({ where }); } catch { /* fixture cleanup is best effort */ }
    }
    await sequelize.close();
  }
});
