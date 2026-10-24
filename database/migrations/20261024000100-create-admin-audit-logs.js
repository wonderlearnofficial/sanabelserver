"use strict";

// AdminAuditLogs: one row per administrative action — who did what, to whom,
// in which school, and when. Written by helpers/adminAudit.ts; read by the
// Super Admin's activity log.
//
// No DB-level foreign keys on purpose: the log must outlive the accounts and
// schools it mentions (a deleted user's deletion is exactly what it records),
// so actor and target are plain ids plus a label captured at the time.
const TABLE = "AdminAuditLogs";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.map((name) => (typeof name === "string" ? name : name.tableName)).includes(TABLE)) {
      await queryInterface.createTable(TABLE, {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        actorUserId: { type: Sequelize.INTEGER, allowNull: true },
        actorEmail: { type: Sequelize.STRING(255), allowNull: true },
        // The actor's own scope: null for a Super Admin.
        actorOrganizationId: { type: Sequelize.INTEGER, allowNull: true },
        action: { type: Sequelize.STRING(64), allowNull: false },
        targetType: { type: Sequelize.STRING(32), allowNull: true },
        targetId: { type: Sequelize.INTEGER, allowNull: true },
        targetLabel: { type: Sequelize.STRING(255), allowNull: true },
        // The school the action affected, when there is one.
        organizationId: { type: Sequelize.INTEGER, allowNull: true },
        details: { type: Sequelize.JSON, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }
    const indexes = await queryInterface.showIndex(TABLE);
    const names = indexes.map((index) => index.name);
    for (const [name, fields] of [
      ["admin_audit_logs_created_at", ["createdAt"]],
      ["admin_audit_logs_actor", ["actorUserId"]],
      ["admin_audit_logs_organization", ["organizationId"]],
      ["admin_audit_logs_action", ["action"]],
    ]) {
      if (!names.includes(name)) await queryInterface.addIndex(TABLE, fields, { name });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
  },
};
