"use strict";

// Forward-only email telemetry. No historical rows are reconstructed and no
// raw recipient address, subject, body, OTP, or password is stored.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EmailEvents", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      recipientHash: { type: Sequelize.STRING(64), allowNull: false },
      purpose: { type: Sequelize.STRING(40), allowNull: false },
      provider: { type: Sequelize.STRING(24), allowNull: false },
      providerMessageId: { type: Sequelize.STRING(191), allowNull: true },
      status: { type: Sequelize.STRING(24), allowNull: false },
      failureCode: { type: Sequelize.STRING(80), allowNull: true },
      failureCategory: { type: Sequelize.STRING(40), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("EmailEvents", ["createdAt", "status"], {
      name: "email_events_created_status",
    });
    await queryInterface.addIndex("EmailEvents", ["purpose", "createdAt"], {
      name: "email_events_purpose_created",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("EmailEvents");
  },
};
