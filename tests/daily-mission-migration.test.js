const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
require("dotenv").config();

const migration = require("../database/migrations/20260902200000-add-student-todo-days");

test("daily mission migration uses exact-date pending backfill and non-deprecated merge SQL", async () => {
  const sql = [];
  const queryInterface = {
    addColumn: async () => {},
    createTable: async () => {},
    addIndex: async () => {},
    sequelize: {
      query: async (statement) => {
        sql.push(statement);
        return [[], {}];
      },
    },
  };

  await migration.up(queryInterface, Sequelize);
  const combined = sql.join("\n");

  assert.doesNotMatch(combined, /\bVALUES\s*\(/i,
    "migration SQL must not use deprecated VALUES(column) references");
  assert.match(combined,
    /r\.missionDate\s*=\s*COALESCE\(st\.date,sti\.todoDate,DATE\(sti\.createdAt\)\)/,
    "a request may mark only its exact legacy occurrence date pending");
  assert.match(combined,
    /incoming\.incomingStatus='pending_approval'\s+OR\s+StudentTodoDays\.status='pending_approval'/,
    "pending must outrank todo when multiple request rows merge");
});

const integrationEnabled = process.env.RUN_DAILY_MISSION_MIGRATION_INTEGRATION === "true";

test("migration 11 does not fabricate a pending day when legacy todoDate differs from missionDate",
  { skip: !integrationEnabled }, async () => {
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.MYSQL_DB_HOST),
      "Only a loopback database is allowed");
    process.env.DB_SYNC_ON_STARTUP = "false";

    const sequelize = new Sequelize.Sequelize(
      process.env.MYSQL_DB_NAME,
      process.env.MYSQL_DB_USER,
      process.env.MYSQL_DB_PASS,
      {
        host: process.env.MYSQL_DB_HOST,
        port: Number(process.env.MYSQL_DB_PORT || 3306),
        dialect: "mysql",
        logging: false,
      },
    );
    const queryInterface = sequelize.getQueryInterface();
    const suffix = `migration_pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const todoDate = "2026-08-31";
    const requestDate = "2026-09-01";
    let itemId;
    let schemaIsDown = false;

    try {
      await sequelize.authenticate();
      const before = await queryInterface.describeTable("StudentTodoItems");
      assert.ok(before.isActive && before.removedAt,
        "local rehearsal must begin with migration 11 applied");

      await migration.down(queryInterface);
      schemaIsDown = true;

      const [pairs] = await sequelize.query(`
        SELECT s.id studentId, t.id taskId
        FROM Students s
        CROSS JOIN Tasks t
        LEFT JOIN StudentTodoItems i
          ON i.studentId=s.id AND i.taskId=t.id
        WHERE s.classId IS NOT NULL AND i.id IS NULL
        ORDER BY s.id,t.id
        LIMIT 1
      `);
      assert.ok(pairs[0], "an unused School Student/Task pair is required");
      const { studentId, taskId } = pairs[0];
      const now = new Date();

      await sequelize.query(`
        INSERT INTO StudentTodoItems
          (studentId,taskId,status,activeKey,todoDate,completedAt,studentTaskId,
           completionSource,completedById,createdAt,updatedAt)
        VALUES (?,?, 'pending_approval', ?, ?, NULL, NULL, NULL, NULL, ?, ?)
      `, { replacements: [studentId, taskId, suffix, todoDate, now, now] });
      const [items] = await sequelize.query(
        "SELECT id FROM StudentTodoItems WHERE activeKey=?",
        { replacements: [suffix] },
      );
      itemId = items[0].id;

      await sequelize.query(`
        INSERT INTO StudentTodoSources
          (todoItemId,sourceType,sourceId,createdAt,updatedAt)
        VALUES (?, 'student', ?, ?, ?)
      `, { replacements: [itemId, studentId, now, now] });
      // A denied row and a pending row on the authoritative request date prove
      // that merge order cannot downgrade pending back to todo.
      for (const status of ["denied", "pending"]) {
        await sequelize.query(`
          INSERT INTO MissionApprovalRequests
            (studentId,missionId,missionDate,status,parentIds,teacherIds,
             approvedById,approvedByType,approvedAt,createdAt,updatedAt,todoItemId)
          VALUES (?,?,?,?,JSON_ARRAY(),JSON_ARRAY(),NULL,NULL,NULL,?,?,?)
        `, { replacements: [studentId, taskId, requestDate, status, now, now, itemId] });
      }

      await migration.up(queryInterface, Sequelize);
      schemaIsDown = false;

      const [days] = await sequelize.query(`
        SELECT missionDate,status
        FROM StudentTodoDays
        WHERE studentTodoItemId=?
        ORDER BY missionDate
      `, { replacements: [itemId] });
      assert.deepEqual(days.map((row) => [String(row.missionDate), row.status]), [
        [todoDate, "todo"],
        [requestDate, "pending_approval"],
      ]);

      const [unmatched] = await sequelize.query(`
        SELECT COUNT(*) violations
        FROM StudentTodoDays d
        LEFT JOIN MissionApprovalRequests r
          ON r.todoDayId=d.id AND r.status='pending'
        WHERE d.studentTodoItemId=?
          AND d.status='pending_approval'
          AND r.id IS NULL
      `, { replacements: [itemId] });
      assert.equal(Number(unmatched[0].violations), 0);

      const [requestLinks] = await sequelize.query(`
        SELECT COUNT(*) total, SUM(todoDayId IS NOT NULL) linked,
               COUNT(DISTINCT todoDayId) distinctDays
        FROM MissionApprovalRequests
        WHERE todoItemId=?
      `, { replacements: [itemId] });
      assert.equal(Number(requestLinks[0].total), 2);
      assert.equal(Number(requestLinks[0].linked), 2);
      assert.equal(Number(requestLinks[0].distinctDays), 1);
    } finally {
      if (!schemaIsDown && itemId) {
        await sequelize.query("DELETE FROM MissionApprovalRequests WHERE todoItemId=?",
          { replacements: [itemId] });
        await sequelize.query("DELETE FROM StudentTodoDays WHERE studentTodoItemId=?",
          { replacements: [itemId] });
        await sequelize.query("DELETE FROM StudentTodoSources WHERE todoItemId=?",
          { replacements: [itemId] });
        await sequelize.query("DELETE FROM StudentTodoItems WHERE id=?",
          { replacements: [itemId] });
      }
      await sequelize.close();
    }
  });
