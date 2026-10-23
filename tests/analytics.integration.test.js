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
  const StudentTodoItem = model("student-todo-item");
  const StudentTodoSource = model("student-todo-source");
  const Class = model("class");
  const Grade = model("grade");
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

    // A SECOND school, so cross-organisation access can actually be attempted
    // rather than assumed. Without a foreign org there is nothing to leak.
    const otherOrg = await remember(Organization, { name: `${suffix}_other`, type: "School" });
    const otherUser = await remember(User, {
      firstName: "Foreign", lastName: suffix, role: "Student",
      email: `${suffix}_foreign@example.invalid`, password: "unused", isAccess: true,
    });
    const otherStudent = await remember(Student, {
      userId: otherUser.id, organizationId: otherOrg.id,
      connectCode: `${Date.now()}x`.slice(-9), treeProgress: 1,
    });
    const otherGrade = await remember(Grade, {
      name: `${suffix}_ogrd`, organizationId: otherOrg.id,
    });
    const otherClass = await remember(Class, {
      classname: `${suffix}_ocls`, organizationId: otherOrg.id, gradeId: otherGrade.id,
    });

    // A student enrolled in the FIRST school but with no class and no grade.
    // This is the state school warnings must count — and the state the
    // overview must NOT report as a Solo learner.
    const incompleteUser = await remember(User, {
      firstName: "NoClass", lastName: suffix, role: "Student",
      email: `${suffix}_noclass@example.invalid`, password: "unused", isAccess: true,
    });
    await remember(Student, {
      userId: incompleteUser.id, organizationId: org.id, classId: null, gradeId: null,
      connectCode: `${Date.now()}y`.slice(-9), treeProgress: 1,
    });

    // Assignment fixtures for the source-based analytics query.
    //
    // Three items: teacher-assigned (completed), parent-assigned (todo), and
    // one carrying BOTH a teacher and a parent source. That last one is the
    // case a naive COUNT(*) over the join would double-count, so it is here
    // on purpose rather than avoided.
    const todoCompleted = await remember(StudentTodoItem, {
      studentId: students[0].id, taskId: missionA.id, status: "completed",
      todoDate: today, completedAt: new Date(), isActive: true,
    });
    const todoActive = await remember(StudentTodoItem, {
      studentId: students[1].id, taskId: missionB.id, status: "todo",
      todoDate: today, isActive: true,
    });
    const todoDoubleSourced = await remember(StudentTodoItem, {
      studentId: students[2].id, taskId: missionA.id, status: "todo",
      todoDate: today, isActive: true,
    });
    await remember(StudentTodoSource, { todoItemId: todoCompleted.id, sourceType: "teacher", sourceId: 1 });
    await remember(StudentTodoSource, { todoItemId: todoActive.id, sourceType: "parent", sourceId: 1 });
    await remember(StudentTodoSource, { todoItemId: todoDoubleSourced.id, sourceType: "teacher", sourceId: 1 });
    await remember(StudentTodoSource, { todoItemId: todoDoubleSourced.id, sourceType: "parent", sourceId: 2 });

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

    await t.test("school admin gets 403 on every global route", async () => {
      // The full platform surface, proven against a real scope lookup:
      // requireSuperAdmin re-reads Admins.organizationId per request, which is
      // exactly what a stubbed model cannot exercise.
      const globalRoutes = [
        "/admin/analytics/overview",
        "/admin/analytics/completions",
        "/admin/analytics/missions",
        "/admin/analytics/users",
        "/admin/analytics/organizations",
        "/admin/analytics/approvals",
        "/admin/analytics/assignments",
        "/admin/analytics/dashboard",
        "/admin/analytics/activity",
        "/admin/analytics/emails",
        "/admin/analytics/imports",
        "/admin/analytics/data-quality",
        "/admin/analytics/system-health",
        "/admin/data-quality",
        "/admin/data-quality/detail?issue=class_no_teacher",
        "/admin/app-version",
      ];
      for (const path of globalRoutes) {
        const res = await get(path, schoolToken);
        assert.equal(res.status, 403, `${path} must refuse a school admin`);
      }
    });

    await t.test("school admin reaches their own scoped routes", async () => {
      for (const path of [
        "/admin/school-dashboard",
        "/admin/school-data-quality",
        "/admin/import-analytics",
        "/admin/students",
        "/admin/classes",
        "/admin/grades",
      ]) {
        const res = await get(path, schoolToken);
        assert.equal(res.status, 200, `${path} must serve a school admin`);
      }
    });

    await t.test("school admin cannot reach another organization's records", async () => {
      // Each of these names a real row belonging to the OTHER school.
      //
      // Refusal is what matters, not the exact code. `getStudentDetail`
      // deliberately answers 404 with the same message it uses for a record
      // that does not exist, so probing an id cannot confirm the record is
      // real — a stronger answer than 403, which would confirm it. Both are
      // accepted here; neither grants access.
      for (const path of [
        `/admin/students/${otherStudent.id}`,
        `/admin/organizations/${otherOrg.id}`,
      ]) {
        const res = await get(path, schoolToken);
        assert.ok(
          res.status === 403 || res.status === 404,
          `${path} must be refused, got ${res.status}`,
        );
      }

      // Widening the query string must not widen the scope: the server
      // overwrites the organisation with Admins.organizationId after reading it.
      const widened = await get(`/admin/students?organizationId=${otherOrg.id}`, schoolToken);
      assert.equal(widened.status, 200);
      const widenedBody = await widened.json();
      for (const row of widenedBody.data) {
        assert.equal(row.organizationId, org.id, "a foreign student leaked through the query string");
      }
    });

    await t.test("school admin cannot mutate another organization's records", async () => {
      const patch = (path, body) =>
        fetch(`${base}${path}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${schoolToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const remove = (path) =>
        fetch(`${base}${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${schoolToken}` } });

      // The convention across these handlers, and it is a deliberate one:
      //
      //   404 — the record exists but belongs to another school. The message is
      //         identical to a genuinely missing record, so probing an id
      //         cannot confirm it is real.
      //   403 — the action is not available to a School Admin at all, whatever
      //         the id: editing a shared grade, moving a record between
      //         schools, or managing organizations.
      //
      // Both are refusals. What must never happen is a 200.
      const refused = async (label, promise) => {
        const res = await promise;
        assert.ok(
          res.status === 403 || res.status === 404,
          `${label} must be refused, got ${res.status}`,
        );
      };

      await refused("patch foreign class", patch(`/admin/classes/${otherClass.id}`, { classname: "hijack" }));
      await refused("delete foreign class", remove(`/admin/classes/${otherClass.id}`));
      await refused("patch foreign grade", patch(`/admin/grades/${otherGrade.id}`, { name: "hijack" }));
      await refused("delete foreign grade", remove(`/admin/grades/${otherGrade.id}`));
      await refused("delete foreign student", remove(`/admin/students/${otherStudent.id}`));

      // And the foreign records are still intact afterwards.
      await otherClass.reload();
      await otherGrade.reload();
      assert.equal(otherClass.classname, `${suffix}_ocls`, "a foreign class was modified");
      assert.equal(otherGrade.name, `${suffix}_ogrd`, "a foreign grade was modified");

      // School management is not platform management.
      const created = await fetch(`${base}/admin/organizations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${schoolToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${suffix}_should_not_exist` }),
      });
      assert.equal(created.status, 403);
    });

    await t.test("school admin sees only their own organization in the list", async () => {
      const res = await get("/admin/organizations", schoolToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.equal(data.length, 1);
      assert.equal(data[0].id, org.id);
    });

    await t.test("school dashboard is scoped and names its counting units", async () => {
      const res = await get("/admin/school-dashboard", schoolToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();

      assert.equal(data.organizationId, org.id);
      // Eleven students in this school: ten completing plus the missing-class
      // fixture. A foreign school's student must not be included.
      assert.equal(data.students, 11);
      assert.equal(typeof data.grades, "number");
      assert.equal(typeof data.newStudentsToday, "number");
      assert.equal(typeof data.assignmentSources, "number");
      assert.equal(data.totalImportBatches, data.totalImportRuns);

      // Bounded feeds, and every row belongs to this school.
      assert.ok(Array.isArray(data.recentCompletions));
      assert.ok(data.recentCompletions.length <= 10);
      assert.ok(Array.isArray(data.recentApprovals));
      assert.ok(data.recentApprovals.length <= 10);
      for (const row of data.recentCompletions) {
        assert.ok(String(row.studentName).includes(suffix) || row.studentName === null,
          `a foreign student appeared in the school feed: ${row.studentName}`);
      }

      // The same endpoint answers a Super Admin globally, so its student count
      // must be at least this school's.
      const superRes = await get("/admin/school-dashboard", superToken);
      assert.equal(superRes.status, 200);
      const superBody = await superRes.json();
      assert.equal(superBody.data.organizationId, null);
      assert.ok(superBody.data.students >= data.students);
    });

    await t.test("school warnings count the enrolled student with no class, scoped to one school", async () => {
      const res = await get("/admin/school-data-quality", schoolToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();

      assert.equal(data.organizationId, org.id);
      // The fixture student enrolled in THIS school with no class and no grade.
      assert.ok(data.counts.studentsWithoutClass >= 1, "missing-class student not counted");
      assert.ok(data.counts.studentsWithoutGrade >= 1, "missing-grade student not counted");
      assert.equal(typeof data.counts.oldPendingApprovals, "number");
      assert.equal(typeof data.totalWarnings, "number");

      // A Super Admin has no single school to report on and is told so rather
      // than handed the whole platform under a per-school shape.
      const superRes = await get("/admin/school-data-quality", superToken);
      assert.equal(superRes.status, 400);
    });

    await t.test("overview splits solo from school by organization, not by class", async () => {
      const res = await get("/admin/analytics/overview", superToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();

      // The fixture student with an organisation but no class must count as a
      // school student. Splitting on classId reported them as a Solo learner,
      // which merges a data-quality problem into a valid population.
      const [row] = await sequelize.query(
        "SELECT SUM(organizationId IS NULL) AS solo, SUM(organizationId IS NOT NULL) AS school FROM Students",
        { type: require("sequelize").QueryTypes.SELECT },
      );
      assert.equal(data.people.soloUsers, Number(row.solo));
      assert.equal(data.people.schoolStudents, Number(row.school));

      // Registration counts, present and numeric — not called activity.
      for (const key of ["verifiedUsers", "unverifiedUsers", "newUsersToday", "newUsersThisWeek", "newUsersThisMonth"]) {
        assert.equal(typeof data.people[key], "number", `${key} missing from overview`);
      }
    });

    await t.test("assignments count source rows and say so", async () => {
      const res = await get("/admin/analytics/assignments", superToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();

      // The rewritten joins and columns execute against real MySQL.
      assert.ok(data.status, "status block missing");
      assert.ok(Array.isArray(data.bySource));
      assert.equal(data.countingUnit, "assignment_source");

      // Only teacher and parent sources; a solo-added item is not an assignment.
      for (const row of data.bySource) {
        assert.ok(["teacher", "parent"].includes(row.sourceType), `unexpected source ${row.sourceType}`);
        assert.ok(
          row.completionRate === null || (row.completionRate >= 0 && row.completionRate <= 100),
          `completionRate out of range: ${row.completionRate}`,
        );
      }

      // The item with both a teacher and a parent source counts once for each.
      // That is what "how much did teachers assign" has to mean, and it means
      // the status totals equal the sum of per-source items. Pinned so the
      // semantic cannot change without this failing.
      const totalBySource = data.bySource.reduce((sum, row) => sum + Number(row.items || 0), 0);
      assert.equal(Number(data.status.total), totalBySource);
    });

    await t.test("system health reports safe operational fields and no secrets", async () => {
      const res = await get("/admin/analytics/system-health", superToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();

      assert.equal(data.database, "connected");
      assert.equal(typeof data.databaseVersion, "string");
      assert.ok(data.appliedMigrations > 0, "migration count missing");
      assert.equal(typeof data.processUptimeSeconds, "number");
      assert.equal(typeof data.memory.heapUsedMb, "number");
      assert.equal(data.coverage, "current_process_only");

      // Nothing that identifies or opens the database may appear.
      const serialized = JSON.stringify(data);
      for (const secret of [process.env.MYSQL_DB_PASS, process.env.JWT_SECRET, process.env.MYSQL_DB_USER]) {
        if (!secret) continue;
        assert.equal(serialized.includes(secret), false, "a credential leaked into system health");
      }
      for (const field of ["DATABASE_URL", "password", "MYSQL_DB", "Authorization"]) {
        assert.equal(serialized.includes(field), false, `${field} leaked into system health`);
      }
    });

    await t.test("email analytics never reports a delivery rate without provider events", async () => {
      const res = await get("/admin/analytics/emails", superToken);
      assert.equal(res.status, 200);
      const { data } = await res.json();

      // There is no provider delivery webhook, so nothing may claim delivery.
      assert.equal(data.deliveryTrackingAvailable, false);
      assert.equal(data.totals.deliveryRate, null);
      assert.equal(data.historicalDataAvailable, false);
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
      // Ten completing students plus the missing-class fixture added for the
      // school-warnings test. It completed nothing, so the activity counts
      // below stay at ten.
      assert.equal(Number(row.students), 11);
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
