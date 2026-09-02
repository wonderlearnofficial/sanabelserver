"use strict";

/**
 * Student To-Do ordering + approval-request audit trail.
 *
 * 1. StudentTodoItems.position — the student's manual sort order. Meaningful
 *    for actionable rows (todo / pending_approval); completed history sorts by
 *    completion date instead and keeps whatever position it had.
 *    Backfill: per student, actionable items ordered by createdAt DESC get
 *    positions 0..n (newest first, matching the current UI order).
 *
 * 2. MissionApprovalRequestEvents — immutable trace of who a request was
 *    aimed at. The request row's parentIds/teacherIds arrays are overwritten
 *    when a student retargets a pending request, so without this table that
 *    history would be lost. Resolution facts (approvedByType/ById/At) stay on
 *    the request row as before; this table records REQUESTED and RETARGETED.
 *
 * Additive only. No row is deleted or rewritten beyond the new column's
 * backfill. Reversible via down().
 */

const EVENTS_TABLE = "MissionApprovalRequestEvents";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("StudentTodoItems", "position", {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });

    // Deterministic backfill: newest actionable item first, per student.
    await queryInterface.sequelize.query(`
      UPDATE StudentTodoItems t
      JOIN (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY studentId ORDER BY createdAt DESC, id DESC) - 1 AS rn
        FROM StudentTodoItems
        WHERE status IN ('todo', 'pending_approval')
      ) ranked ON ranked.id = t.id
      SET t.position = ranked.rn
    `);

    // Structural justification (row counts are currently too small for EXPLAIN
    // to prove benefit): the list endpoint filters by studentId and sorts by
    // position on every To-Do page load.
    await queryInterface.addIndex("StudentTodoItems", ["studentId", "status", "position"], {
      name: "student_todo_order",
    });

    await queryInterface.createTable(EVENTS_TABLE, {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      requestId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "MissionApprovalRequests", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      eventType: { type: Sequelize.STRING(20), allowNull: false },
      actorUserId: { type: Sequelize.INTEGER, allowNull: true },
      targetApproverType: { type: Sequelize.STRING(10), allowNull: true },
      // JSON list of approver ids the request was aimed at after this event,
      // because a request may target "all eligible" rather than one person.
      targetApproverIds: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE(6), allowNull: false },
      updatedAt: { type: Sequelize.DATE(6), allowNull: false },
    });
    await queryInterface.addIndex(EVENTS_TABLE, ["requestId"], {
      name: "approval_events_request",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable(EVENTS_TABLE);
    await queryInterface.removeIndex("StudentTodoItems", "student_todo_order");
    await queryInterface.removeColumn("StudentTodoItems", "position");
  },
};
