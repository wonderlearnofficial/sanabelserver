"use strict";

// AccountDeletionRequests: people asking for their Sanabel account to be deleted,
// from the public /delete-account page or from inside the app (Google Play's
// account-deletion requirement). An administrator reviews each one and deletes
// the account with the existing admin tool; nothing is deleted automatically.
//
// userId is a plain id, no foreign key: the request must outlive the account it
// asks to delete (and a request can be about an account that does not match).
const TABLE = "AccountDeletionRequests";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.map((name) => (typeof name === "string" ? name : name.tableName)).includes(TABLE)) {
      await queryInterface.createTable(TABLE, {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        fullName: { type: Sequelize.STRING(120), allowNull: false },
        contactEmail: { type: Sequelize.STRING(255), allowNull: false },
        // What the person typed to identify the account (username or sign-in email).
        accountIdentifier: { type: Sequelize.STRING(255), allowNull: false },
        accountType: { type: Sequelize.STRING(16), allowNull: true },
        schoolName: { type: Sequelize.STRING(160), allowNull: true },
        details: { type: Sequelize.STRING(1000), allowNull: true },
        // 'web' for the public page, 'app' when sent while signed in.
        source: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "web" },
        // Set when the request matched an account (always when sent from the app).
        userId: { type: Sequelize.INTEGER, allowNull: true },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "pending" },
        handledByUserId: { type: Sequelize.INTEGER, allowNull: true },
        handledAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }
    const indexes = await queryInterface.showIndex(TABLE);
    const names = indexes.map((index) => index.name);
    for (const [name, fields] of [
      ["account_deletion_requests_status", ["status", "createdAt"]],
      ["account_deletion_requests_user", ["userId"]],
    ]) {
      if (!names.includes(name)) await queryInterface.addIndex(TABLE, fields, { name });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
  },
};
