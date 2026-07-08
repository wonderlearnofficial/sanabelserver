"use strict";

// The Grade model used to require a globally-unique `name` (back when grades
// weren't scoped to a school). That single-column unique index/constraint
// was never dropped when `organizationId` + the composite
// (name, organizationId) unique index were introduced, so two different
// schools still can't both have a grade named e.g. "primary" — creating the
// second one throws a raw SequelizeUniqueConstraintError (500) instead of
// succeeding. This drops the stale single-column constraint; the composite
// unique index on (name, organizationId) already enforces the correct rule.
const TABLE = "Grades";
const STALE_INDEX = "grades_name_unique";

module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex(TABLE);
    const stale = indexes.find((idx) => idx.name === STALE_INDEX);
    if (stale) {
      await queryInterface.removeIndex(TABLE, STALE_INDEX);
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex(TABLE);
    const exists = indexes.some((idx) => idx.name === STALE_INDEX);
    if (!exists) {
      await queryInterface.addIndex(TABLE, ["name"], {
        name: STALE_INDEX,
        unique: true,
      });
    }
  },
};
