"use strict";

// PlatformSettings: platform-wide values a Super Admin changes from the admin
// console, one JSON value per key. The first key is "session" (token
// lifetimes), read by helpers/sessionPolicy.ts.
const TABLE = "PlatformSettings";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.map((name) => (typeof name === "string" ? name : name.tableName)).includes(TABLE)) return;
    await queryInterface.createTable(TABLE, {
      key: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      value: { type: Sequelize.JSON, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.map((name) => (typeof name === "string" ? name : name.tableName)).includes(TABLE)) {
      await queryInterface.dropTable(TABLE);
    }
  },
};
