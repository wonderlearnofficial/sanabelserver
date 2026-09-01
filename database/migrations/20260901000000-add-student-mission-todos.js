"use strict";

const TODO_TABLE = "StudentTodoItems";
const SOURCE_TABLE = "StudentTodoSources";
const TASK_TABLE = "StudentTasks";
const REQUEST_TABLE = "MissionApprovalRequests";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(TODO_TABLE, {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: "Students", key: "id" }, onDelete: "CASCADE" },
      taskId: { type: Sequelize.INTEGER, allowNull: false, references: { model: "Tasks", key: "id" }, onDelete: "CASCADE" },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: "todo" },
      activeKey: { type: Sequelize.STRING(80), allowNull: true },
      todoDate: { type: Sequelize.DATEONLY, allowNull: false },
      completedAt: { type: Sequelize.DATE, allowNull: true },
      studentTaskId: { type: Sequelize.INTEGER, allowNull: true, references: { model: TASK_TABLE, key: "id" }, onDelete: "SET NULL" },
      completionSource: { type: Sequelize.STRING(40), allowNull: true },
      completedById: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex(TODO_TABLE, ["activeKey"], { unique: true, name: "student_todo_active_key_unique" });
    await queryInterface.addIndex(TODO_TABLE, ["studentTaskId"], { unique: true, name: "student_todo_completion_unique" });
    await queryInterface.addIndex(TODO_TABLE, ["studentId", "taskId", "todoDate"], { name: "student_todo_history" });

    await queryInterface.createTable(SOURCE_TABLE, {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      todoItemId: { type: Sequelize.INTEGER, allowNull: false, references: { model: TODO_TABLE, key: "id" }, onDelete: "CASCADE" },
      sourceType: { type: Sequelize.STRING(20), allowNull: false },
      sourceId: { type: Sequelize.INTEGER, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex(SOURCE_TABLE, ["todoItemId", "sourceType", "sourceId"], { unique: true, name: "student_todo_source_unique" });

    await queryInterface.addColumn(REQUEST_TABLE, "todoItemId", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: TODO_TABLE, key: "id" },
      onDelete: "SET NULL",
    });
    await queryInterface.addIndex(REQUEST_TABLE, ["todoItemId", "status"], { name: "mission_request_todo_status" });

    await queryInterface.addColumn(TASK_TABLE, "completionKey", { type: Sequelize.STRING(100), allowNull: true });
    await queryInterface.addColumn(TASK_TABLE, "completionSource", { type: Sequelize.STRING(40), allowNull: true });

    // Preserve every legacy row. The first completion for a student/task/day
    // receives the canonical key; any pre-existing duplicates receive an
    // audit-safe legacy suffix. New writes always use the canonical key.
    await queryInterface.sequelize.query(`
      UPDATE ${TASK_TABLE} st
      JOIN (
        SELECT id, studentId, taskId, date,
               ROW_NUMBER() OVER (PARTITION BY studentId, taskId, date ORDER BY id) AS duplicate_number
        FROM ${TASK_TABLE}
        WHERE completionStatus = 'Completed'
      ) ranked ON ranked.id = st.id
      SET st.completionKey = CASE
        WHEN ranked.duplicate_number = 1 THEN CONCAT(ranked.studentId, ':', ranked.taskId, ':', ranked.date)
        ELSE CONCAT(ranked.studentId, ':', ranked.taskId, ':', ranked.date, ':legacy:', st.id)
      END
    `);
    await queryInterface.addIndex(TASK_TABLE, ["completionKey"], { unique: true, name: "student_task_completion_key_unique" });

    await queryInterface.sequelize.query(`
      UPDATE ${TASK_TABLE}
      SET completionSource = CASE
        WHEN teacherId IS NOT NULL THEN 'teacher_direct'
        WHEN parentId IS NOT NULL THEN 'parent_direct'
        ELSE 'solo_self'
      END
      WHERE completionSource IS NULL AND completionStatus = 'Completed'
    `);
    await queryInterface.sequelize.query(`
      UPDATE ${TASK_TABLE} st
      JOIN ${REQUEST_TABLE} mar
        ON mar.studentId = st.studentId
       AND mar.missionId = st.taskId
       AND mar.missionDate = st.date
       AND mar.status = 'approved'
      SET st.completionSource = CASE
        WHEN mar.approvedByType = 'teacher' THEN 'approval_teacher'
        WHEN mar.approvedByType = 'parent' THEN 'approval_parent'
        ELSE st.completionSource
      END
      WHERE st.completionStatus = 'Completed'
    `);
    await queryInterface.sequelize.query(`
      INSERT INTO ${TODO_TABLE}
        (studentId, taskId, status, activeKey, todoDate, completedAt, studentTaskId,
         completionSource, completedById, createdAt, updatedAt)
      SELECT st.studentId, st.taskId, 'completed', NULL, st.date, st.createdAt, st.id,
             st.completionSource, COALESCE(st.teacherId, st.parentId), st.createdAt, st.updatedAt
      FROM ${TASK_TABLE} st
      JOIN Students s ON s.id = st.studentId AND s.classId IS NOT NULL
      WHERE st.completionStatus = 'Completed'
        AND st.completionKey NOT LIKE '%:legacy:%'
    `);

    let indexes = await queryInterface.showIndex(TASK_TABLE);
    // MySQL may use the legacy composite unique index as the supporting index
    // for studenttasks.studentId's foreign key. Give that FK a stable dedicated
    // index before removing the legacy uniqueness rule.
    if (!indexes.some((index) => index.name === "student_tasks_student_id_fk")) {
      await queryInterface.addIndex(TASK_TABLE, ["studentId"], {
        name: "student_tasks_student_id_fk",
      });
      indexes = await queryInterface.showIndex(TASK_TABLE);
    }
    if (indexes.some((index) => index.name === "stu_task_date_p_t_unique")) {
      await queryInterface.removeIndex(TASK_TABLE, "stu_task_date_p_t_unique");
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex(TASK_TABLE);
    if (!indexes.some((index) => index.name === "stu_task_date_p_t_unique")) {
      await queryInterface.addIndex(
        TASK_TABLE,
        ["studentId", "taskId", "date", "parentId", "teacherId"],
        { unique: true, name: "stu_task_date_p_t_unique" },
      );
    }
    await queryInterface.removeColumn(TASK_TABLE, "completionSource");
    await queryInterface.removeColumn(TASK_TABLE, "completionKey");
    await queryInterface.removeColumn(REQUEST_TABLE, "todoItemId");
    await queryInterface.dropTable(SOURCE_TABLE);
    await queryInterface.dropTable(TODO_TABLE);
    const remainingIndexes = await queryInterface.showIndex(TASK_TABLE);
    if (remainingIndexes.some((index) => index.name === "student_tasks_student_id_fk")) {
      await queryInterface.removeIndex(TASK_TABLE, "student_tasks_student_id_fk");
    }
  },
};
