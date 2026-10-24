"use strict";

// Sign-in tracking and admin account disabling on Users.
//
//   lastLoginAt          last successful password sign-in
//   lastActiveAt         last authenticated request (written at most every few
//                        minutes by the auth middleware, never on impersonated
//                        sessions)
//   lastLoginUserAgent   the User-Agent of that sign-in, truncated, so an
//                        operator can tell the mobile app from a browser
//   disabledAt           set when an administrator disables the account.
//                        isAccess=false alone also means "email not verified
//                        yet"; this is what tells the two apart.
//
// Expand-only, all nullable, no defaults to backfill. Idempotent: guarded by
// describeTable, like the other column migrations here.
const TABLE = "Users";
const COLUMNS = {
  lastLoginAt: (Sequelize) => ({ type: Sequelize.DATE, allowNull: true, defaultValue: null }),
  lastActiveAt: (Sequelize) => ({ type: Sequelize.DATE, allowNull: true, defaultValue: null }),
  lastLoginUserAgent: (Sequelize) => ({
    type: Sequelize.STRING(255),
    allowNull: true,
    defaultValue: null,
  }),
  disabledAt: (Sequelize) => ({ type: Sequelize.DATE, allowNull: true, defaultValue: null }),
};
const INDEX = "users_last_active_at";

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable(TABLE);
    for (const [name, definition] of Object.entries(COLUMNS)) {
      if (!columns[name]) {
        await queryInterface.addColumn(TABLE, name, definition(Sequelize));
      }
    }
    const indexes = await queryInterface.showIndex(TABLE);
    if (!indexes.some((index) => index.name === INDEX)) {
      await queryInterface.addIndex(TABLE, ["lastActiveAt"], { name: INDEX });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex(TABLE);
    if (indexes.some((index) => index.name === INDEX)) {
      await queryInterface.removeIndex(TABLE, INDEX);
    }
    const columns = await queryInterface.describeTable(TABLE);
    for (const name of Object.keys(COLUMNS)) {
      if (columns[name]) {
        await queryInterface.removeColumn(TABLE, name);
      }
    }
  },
};
