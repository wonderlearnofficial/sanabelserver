"use strict";

// School-scoped admins: an Admin user with organizationId set only sees and
// manages that organization's data; organizationId NULL = super admin.
//
// Plain integer column, deliberately no DB-level foreign key — this schema
// previously accumulated thousands of duplicate FK constraints via
// sync({ alter: true }) (see 20260707000001-dedupe-foreign-keys), so scope
// integrity is enforced in the application layer instead.
//
// Idempotent: guarded by describeTable.
const TABLE = "Users";
const COLUMN = "organizationId";

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable(TABLE);

    if (!columns[COLUMN]) {
      await queryInterface.addColumn(TABLE, COLUMN, {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable(TABLE);
    if (columns[COLUMN]) {
      await queryInterface.removeColumn(TABLE, COLUMN);
    }
  },
};
