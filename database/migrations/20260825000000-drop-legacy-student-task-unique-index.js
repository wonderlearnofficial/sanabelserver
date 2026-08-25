"use strict";

// Removes a leftover two-column unique index (studentId, taskId) with no
// `date` component that coexists on this table alongside the correct
// five-column `stu_task_date_p_t_unique` (studentId, taskId, date, parentId,
// teacherId) index defined by the StudentTask model. The model has never
// declared this narrower index — it is a survivor of the historical
// sync({ alter: true }) era described in the dedupe-foreign-keys migration,
// which only targeted duplicate FOREIGN KEY constraints, not this UNIQUE KEY.
//
// Impact while this index remains: MySQL enforces uniqueness on
// (studentId, taskId) ALONE across the table's entire history, so a student
// can complete a given task at most ONCE ever — not once per calendar day as
// every daily task (e.g. the five daily prayers) requires. Every subsequent
// attempt throws SequelizeUniqueConstraintError; before this fix pass that
// error had no `message` in the HTTP response and the client rendered a
// blank alert ("فشل في تحديد المهمة كمكتملة:" with nothing after the colon).
//
// Idempotent: guarded by checking the live indexes first, so it is safe to
// run whether or not this legacy index is present on a given database
// (including if it was already cleaned up, or never existed there).
const TABLE = "StudentTasks";
const LEGACY_INDEX = "StudentTasks_studentId_taskId_unique";

module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex(TABLE);
    const exists = indexes.some((index) => index.name === LEGACY_INDEX);
    if (exists) {
      await queryInterface.removeIndex(TABLE, LEGACY_INDEX);
    }
  },

  async down(queryInterface) {
    // Deliberately not restored — recreating a constraint known to corrupt
    // the daily-task-completion flow is never the correct rollback action.
  },
};
