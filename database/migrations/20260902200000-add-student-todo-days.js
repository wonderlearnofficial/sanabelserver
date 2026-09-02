"use strict";

const DAY_TABLE = "StudentTodoDays";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("StudentTodoItems", "isActive", {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true,
    });
    await queryInterface.addColumn("StudentTodoItems", "removedAt", {
      type: Sequelize.DATE, allowNull: true,
    });

    await queryInterface.createTable(DAY_TABLE, {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      studentTodoItemId: { type: Sequelize.INTEGER, allowNull: false, references: { model: "StudentTodoItems", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: "Students", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      taskId: { type: Sequelize.INTEGER, allowNull: false, references: { model: "Tasks", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      missionDate: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: "todo" },
      completedAt: { type: Sequelize.DATE, allowNull: true },
      studentTaskId: { type: Sequelize.INTEGER, allowNull: true, references: { model: "StudentTasks", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      completionSource: { type: Sequelize.STRING(40), allowNull: true },
      completedById: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex(DAY_TABLE, ["studentTodoItemId", "missionDate"], { unique: true, name: "student_todo_day_item_date_unique" });
    await queryInterface.addIndex(DAY_TABLE, ["studentId", "taskId", "missionDate"], { unique: true, name: "student_todo_day_task_date_unique" });
    await queryInterface.addIndex(DAY_TABLE, ["studentTaskId"], { unique: true, name: "student_todo_day_completion_unique" });
    await queryInterface.addIndex(DAY_TABLE, ["studentId", "missionDate", "status"], { name: "student_todo_day_history" });

    await queryInterface.addColumn("MissionApprovalRequests", "todoDayId", {
      type: Sequelize.INTEGER, allowNull: true,
      references: { model: DAY_TABLE, key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE",
    });
    await queryInterface.addIndex("MissionApprovalRequests", ["todoDayId", "status"], { name: "mission_request_todo_day_status" });

    // A source proves that the row represented list membership. Direct legacy
    // completions created source-less rows and must not become recurring items.
    await queryInterface.sequelize.query(`CREATE TEMPORARY TABLE TodoCanonical AS
      SELECT sti.studentId, sti.taskId,
             COALESCE(MIN(CASE WHEN sti.activeKey IS NOT NULL THEN sti.id END), MIN(sti.id)) canonicalId
      FROM StudentTodoItems sti JOIN StudentTodoSources src ON src.todoItemId=sti.id
      GROUP BY sti.studentId, sti.taskId`);
    await queryInterface.sequelize.query("UPDATE StudentTodoItems SET activeKey=NULL, isActive=0");
    await queryInterface.sequelize.query(`UPDATE StudentTodoItems sti JOIN TodoCanonical c ON c.canonicalId=sti.id
      SET sti.isActive=1, sti.removedAt=NULL, sti.activeKey=CONCAT(sti.studentId, ':', sti.taskId)`);
    await queryInterface.sequelize.query(`INSERT IGNORE INTO StudentTodoSources(todoItemId,sourceType,sourceId,createdAt,updatedAt)
      SELECT c.canonicalId,s.sourceType,s.sourceId,s.createdAt,s.updatedAt
      FROM StudentTodoSources s JOIN StudentTodoItems old ON old.id=s.todoItemId
      JOIN TodoCanonical c ON c.studentId=old.studentId AND c.taskId=old.taskId`);

    // Backfill one canonical occurrence for every known legacy state. The
    // unique key merges duplicate legacy rows without deleting their evidence.
    await queryInterface.sequelize.query(`INSERT INTO ${DAY_TABLE}
      (studentTodoItemId,studentId,taskId,missionDate,status,completedAt,studentTaskId,completionSource,completedById,createdAt,updatedAt)
      SELECT incoming.studentTodoItemId,incoming.studentId,incoming.taskId,incoming.missionDate,
             incoming.incomingStatus,incoming.incomingCompletedAt,incoming.incomingStudentTaskId,
             incoming.incomingCompletionSource,incoming.incomingCompletedById,incoming.createdAt,incoming.updatedAt
      FROM (
        SELECT COALESCE(c.canonicalId,sti.id) studentTodoItemId,sti.studentId,sti.taskId,
               COALESCE(st.date,sti.todoDate,DATE(sti.createdAt)) missionDate,
               CASE WHEN st.id IS NOT NULL OR sti.status='completed' THEN 'completed'
                    WHEN EXISTS(
                      SELECT 1 FROM MissionApprovalRequests r
                      WHERE r.todoItemId=sti.id AND r.status='pending'
                        AND r.missionDate=COALESCE(st.date,sti.todoDate,DATE(sti.createdAt))
                    ) THEN 'pending_approval'
                    ELSE 'todo' END incomingStatus,
               COALESCE(sti.completedAt,st.createdAt) incomingCompletedAt,
               st.id incomingStudentTaskId,
               COALESCE(sti.completionSource,st.completionSource) incomingCompletionSource,
               COALESCE(sti.completedById,st.teacherId,st.parentId) incomingCompletedById,
               sti.createdAt,sti.updatedAt
        FROM StudentTodoItems sti
        LEFT JOIN TodoCanonical c ON c.studentId=sti.studentId AND c.taskId=sti.taskId
        LEFT JOIN StudentTasks st ON st.id=sti.studentTaskId
      ) incoming
      ON DUPLICATE KEY UPDATE
        status=CASE
          WHEN incoming.incomingStatus='completed' OR StudentTodoDays.status='completed' THEN 'completed'
          WHEN incoming.incomingStatus='pending_approval' OR StudentTodoDays.status='pending_approval' THEN 'pending_approval'
          ELSE 'todo' END,
        completedAt=COALESCE(StudentTodoDays.completedAt,incoming.incomingCompletedAt),
        studentTaskId=COALESCE(StudentTodoDays.studentTaskId,incoming.incomingStudentTaskId),
        completionSource=COALESCE(StudentTodoDays.completionSource,incoming.incomingCompletionSource),
        completedById=COALESCE(StudentTodoDays.completedById,incoming.incomingCompletedById)`);

    // Requests carry the authoritative mission date. Create missing daily rows
    // for them and then attach every request to its occurrence.
    await queryInterface.sequelize.query(`INSERT INTO ${DAY_TABLE}
      (studentTodoItemId,studentId,taskId,missionDate,status,completedAt,studentTaskId,completionSource,completedById,createdAt,updatedAt)
      SELECT incoming.studentTodoItemId,incoming.studentId,incoming.taskId,incoming.missionDate,
             incoming.incomingStatus,incoming.incomingCompletedAt,incoming.incomingStudentTaskId,
             incoming.incomingCompletionSource,incoming.incomingCompletedById,incoming.createdAt,incoming.updatedAt
      FROM (
        SELECT COALESCE(c.canonicalId,r.todoItemId) studentTodoItemId,r.studentId,r.missionId taskId,r.missionDate,
               CASE r.status WHEN 'pending' THEN 'pending_approval' WHEN 'approved' THEN 'completed' ELSE 'todo' END incomingStatus,
               r.approvedAt incomingCompletedAt,st.id incomingStudentTaskId,
               st.completionSource incomingCompletionSource,r.approvedById incomingCompletedById,
               r.createdAt,r.updatedAt
        FROM MissionApprovalRequests r
        JOIN StudentTodoItems sti ON sti.id=r.todoItemId
        LEFT JOIN TodoCanonical c ON c.studentId=r.studentId AND c.taskId=r.missionId
        LEFT JOIN StudentTasks st ON st.studentId=r.studentId AND st.taskId=r.missionId
          AND st.date=r.missionDate AND st.completionStatus='Completed'
      ) incoming
      ON DUPLICATE KEY UPDATE
        status=CASE
          WHEN incoming.incomingStatus='completed' OR StudentTodoDays.status='completed' THEN 'completed'
          WHEN incoming.incomingStatus='pending_approval' OR StudentTodoDays.status='pending_approval' THEN 'pending_approval'
          ELSE 'todo' END,
        completedAt=COALESCE(StudentTodoDays.completedAt,incoming.incomingCompletedAt),
        studentTaskId=COALESCE(StudentTodoDays.studentTaskId,incoming.incomingStudentTaskId),
        completionSource=COALESCE(StudentTodoDays.completionSource,incoming.incomingCompletionSource),
        completedById=COALESCE(StudentTodoDays.completedById,incoming.incomingCompletedById)`);
    await queryInterface.sequelize.query(`UPDATE MissionApprovalRequests r JOIN ${DAY_TABLE} d
      ON d.studentId=r.studentId AND d.taskId=r.missionId AND d.missionDate=r.missionDate SET r.todoDayId=d.id`);
    await queryInterface.sequelize.query("DROP TEMPORARY TABLE TodoCanonical");
  },

  async down(queryInterface) {
    const [foreignKeys] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME AS constraintName
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='MissionApprovalRequests'
        AND COLUMN_NAME='todoDayId' AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    for (const foreignKey of foreignKeys) {
      await queryInterface.removeConstraint("MissionApprovalRequests", foreignKey.constraintName);
    }
    const requestIndexes = await queryInterface.showIndex("MissionApprovalRequests");
    if (requestIndexes.some(index => index.name === "mission_request_todo_day_status")) {
      await queryInterface.removeIndex("MissionApprovalRequests", "mission_request_todo_day_status");
    }
    await queryInterface.removeColumn("MissionApprovalRequests", "todoDayId");
    await queryInterface.dropTable(DAY_TABLE);
    await queryInterface.removeColumn("StudentTodoItems", "removedAt");
    await queryInterface.removeColumn("StudentTodoItems", "isActive");
  },
};
