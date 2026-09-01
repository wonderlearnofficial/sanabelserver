"use strict";

// Database V2, slice 1 (EXPAND). Creates the Admins table that will own
// admin-specific scope, currently squatting on Users.organizationId.
//
// Semantics once backfilled (see 20260902000001):
//   Admins.organizationId IS NULL      -> SUPER ADMIN  (global)
//   Admins.organizationId IS NOT NULL  -> SCHOOL ADMIN (scoped to that school)
//
// No isSuperAdmin column: it is fully derivable from organizationId, and
// storing it would recreate exactly the duplicated-source-of-truth problem
// this slice exists to remove.
//
// organizationId uses ON DELETE RESTRICT deliberately. With SET NULL, deleting
// an organization would silently turn each of its school admins into a SUPER
// admin — a privilege escalation triggered by an unrelated admin action.
//
// Purely additive: Users.organizationId is untouched and keeps working for
// every existing reader. Removal is a later CONTRACT migration.
const TABLE = "Admins";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.some((t) => String(t).toLowerCase() === TABLE.toLowerCase());
    if (exists) return;

    await queryInterface.createTable(TABLE, {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      organizationId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Organizations", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    const indexes = await queryInterface.showIndex(TABLE);
    if (!indexes.some((index) => index.name === "admins_user_id_unique")) {
      await queryInterface.addIndex(TABLE, ["userId"], { unique: true, name: "admins_user_id_unique" });
    }
    if (!indexes.some((index) => index.name === "admins_organization_id")) {
      await queryInterface.addIndex(TABLE, ["organizationId"], { name: "admins_organization_id" });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.some((t) => String(t).toLowerCase() === TABLE.toLowerCase())) {
      await queryInterface.dropTable(TABLE);
    }
  },
};
