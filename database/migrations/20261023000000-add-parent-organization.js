"use strict";

// Parents.organizationId: the school a parent was bulk-imported into.
//
// Before this, an imported parent had no school association at all, so the
// importing School Admin could not see them in /admin/parents until a child was
// linked (that list is scoped through Students.ParentId). The column is set
// only by the parent importer; self-registered parents keep NULL and remain
// visible through their linked children exactly as before.
//
// Expand-only and nullable. Plain integer column with an index, deliberately
// no DB-level foreign key — same convention as Users.organizationId
// (see 20260817000000-add-user-organization-scope and
// 20260707000001-dedupe-foreign-keys). Idempotent: guarded by describeTable
// and the index listing.
const TABLE = "Parents";
const COLUMN = "organizationId";
const INDEX = "parents_organization_id";

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
    const indexes = await queryInterface.showIndex(TABLE);
    if (!indexes.some((index) => index.name === INDEX)) {
      await queryInterface.addIndex(TABLE, [COLUMN], { name: INDEX });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex(TABLE);
    if (indexes.some((index) => index.name === INDEX)) {
      await queryInterface.removeIndex(TABLE, INDEX);
    }
    const columns = await queryInterface.describeTable(TABLE);
    if (columns[COLUMN]) {
      await queryInterface.removeColumn(TABLE, COLUMN);
    }
  },
};
