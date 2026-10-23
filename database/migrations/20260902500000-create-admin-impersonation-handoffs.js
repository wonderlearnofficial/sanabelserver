"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("AdminImpersonationHandoffs", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      codeHash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      actorAdminUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      targetUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      targetStudentId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Students", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      organizationId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        references: { model: "Organizations", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      usedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("AdminImpersonationHandoffs", ["codeHash"], {
      name: "admin_impersonation_code_hash_unique",
      unique: true,
    });
    await queryInterface.addIndex("AdminImpersonationHandoffs", ["expiresAt"], {
      name: "admin_impersonation_expires_at",
    });
    await queryInterface.addIndex(
      "AdminImpersonationHandoffs",
      ["actorAdminUserId"],
      {
        name: "admin_impersonation_actor_admin_user_id",
      },
    );
    await queryInterface.addIndex(
      "AdminImpersonationHandoffs",
      ["targetStudentId"],
      {
        name: "admin_impersonation_target_student_id",
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("AdminImpersonationHandoffs");
  },
};
