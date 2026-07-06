"use strict";

// Adds the columns introduced by the security hardening pass:
//   - otpAttempts / otpLockedUntil : OTP retry-limit + temporary lockout
//   - tokenVersion                 : refresh-token invalidation on logout
//
// Idempotent: guarded by describeTable so it is safe to run even if a dev
// environment already added the columns via sync({ alter: true }).
//
// NOTE: the default table name for the "User" model is "Users". If this
// deployment uses a different table name, adjust TABLE below before running.
const TABLE = "Users";

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable(TABLE);

    if (!columns.otpAttempts) {
      await queryInterface.addColumn(TABLE, "otpAttempts", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    if (!columns.otpLockedUntil) {
      await queryInterface.addColumn(TABLE, "otpLockedUntil", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!columns.tokenVersion) {
      await queryInterface.addColumn(TABLE, "tokenVersion", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable(TABLE);
    if (columns.tokenVersion)
      await queryInterface.removeColumn(TABLE, "tokenVersion");
    if (columns.otpLockedUntil)
      await queryInterface.removeColumn(TABLE, "otpLockedUntil");
    if (columns.otpAttempts)
      await queryInterface.removeColumn(TABLE, "otpAttempts");
  },
};
