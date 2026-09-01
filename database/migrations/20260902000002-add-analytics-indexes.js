"use strict";

// Database V2, slice 1 (PERFORMANCE). Two indexes, both covering filter columns
// that currently have zero index coverage and are used by every analytics query.
//
// Honest justification: at present data volume (111 completion rows in
// production, 26 approval requests) EXPLAIN reports a full scan either way —
// the optimizer will not use an index on a table this small, so these cannot be
// "proven" by a query plan today. They are added because the access pattern is
// structurally scan-bound and grows linearly with completions:
//
//   StudentTasks:             WHERE completionStatus='Completed' AND date BETWEEN ?
//                            plus ORDER BY date DESC
//   MissionApprovalRequests: WHERE status='pending' ORDER BY createdAt
//
// Deliberately NOT added: per-column indexes on studentId/taskId (already
// covered by existing FK indexes), StudentTodoItems.status (small table, group-by
// only), and anything speculative. Each index costs write throughput.
const TASKS = "StudentTasks";
const REQUESTS = "MissionApprovalRequests";

module.exports = {
  async up(queryInterface) {
    const taskIndexes = await queryInterface.showIndex(TASKS);
    if (!taskIndexes.some((index) => index.name === "student_tasks_status_date")) {
      await queryInterface.addIndex(TASKS, ["completionStatus", "date"], {
        name: "student_tasks_status_date",
      });
    }

    const requestIndexes = await queryInterface.showIndex(REQUESTS);
    if (!requestIndexes.some((index) => index.name === "mission_requests_status_created")) {
      await queryInterface.addIndex(REQUESTS, ["status", "createdAt"], {
        name: "mission_requests_status_created",
      });
    }
  },

  async down(queryInterface) {
    const taskIndexes = await queryInterface.showIndex(TASKS);
    if (taskIndexes.some((index) => index.name === "student_tasks_status_date")) {
      await queryInterface.removeIndex(TASKS, "student_tasks_status_date");
    }
    const requestIndexes = await queryInterface.showIndex(REQUESTS);
    if (requestIndexes.some((index) => index.name === "mission_requests_status_created")) {
      await queryInterface.removeIndex(REQUESTS, "mission_requests_status_created");
    }
  },
};
