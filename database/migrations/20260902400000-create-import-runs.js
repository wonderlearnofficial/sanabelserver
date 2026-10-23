"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ImportRuns", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      adminUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
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
      entityType: {
        type: Sequelize.ENUM(
          "students",
          "teachers",
          "parents",
          "classes",
          "grades",
          "organizations",
        ),
        allowNull: false,
      },
      totalRows: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      succeeded: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      failed: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex("ImportRuns", ["adminUserId"], {
      name: "import_runs_admin_user_id",
    });
    await queryInterface.addIndex("ImportRuns", ["organizationId"], {
      name: "import_runs_organization_id",
    });
    await queryInterface.addIndex("ImportRuns", ["createdAt"], {
      name: "import_runs_created_at",
    });
    await queryInterface.addIndex("ImportRuns", ["entityType"], {
      name: "import_runs_entity_type",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("ImportRuns");
    // The ENUM type is automatically dropped with the table in MySQL/MariaDB.
  },
};
