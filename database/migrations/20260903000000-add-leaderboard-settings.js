"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Organizations", "leaderboardScope", {
      type: Sequelize.ENUM("all_school", "same_grade", "same_class"),
      allowNull: false,
      defaultValue: "all_school",
    });
    await queryInterface.addColumn("Organizations", "leaderboardLimit", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 50,
    });
    await queryInterface.addColumn("Organizations", "hideZeroXpStudents", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Organizations", "hideZeroXpStudents");
    await queryInterface.removeColumn("Organizations", "leaderboardLimit");
    await queryInterface.removeColumn("Organizations", "leaderboardScope");
    // Remove the ENUM type (MySQL DDL; safe to call — silently a no-op on
    // MariaDB where ENUMs are inline, and correct on MySQL 8 where the
    // column definition was already dropped above).
    await queryInterface.sequelize
      .query("DROP TYPE IF EXISTS `enum_Organizations_leaderboardScope`;")
      .catch(() => {
        // MySQL 8 does not have standalone ENUM types; ignore.
      });
  },
};
