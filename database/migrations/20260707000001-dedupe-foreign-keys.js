"use strict";

// `sequelize.sync({ alter: true })` ran on every server boot (see
// db_connection.ts) and, on this Sequelize version, re-adds a foreign key
// constraint for every model association on each run instead of detecting
// the one already there. Over many restarts/redeploys this left thousands
// of duplicate FK constraints (e.g. Students had 1000+ copies of the same
// userId -> Users FK), which makes later ALTER TABLE calls on those tables
// increasingly slow and eventually fail outright.
//
// This keeps exactly one constraint per (table, column, referenced table/
// column, ON UPDATE/DELETE rule) and drops the rest. Safe to run repeatedly.
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const [dupGroups] = await sequelize.query(`
      SELECT
        kcu.TABLE_NAME AS tableName,
        kcu.CONSTRAINT_NAME AS constraintName,
        kcu.COLUMN_NAME AS columnName,
        kcu.REFERENCED_TABLE_NAME AS refTable,
        kcu.REFERENCED_COLUMN_NAME AS refColumn,
        rc.UPDATE_RULE AS updateRule,
        rc.DELETE_RULE AS deleteRule
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND rc.TABLE_NAME = kcu.TABLE_NAME
      WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.CONSTRAINT_NAME
    `);

    const groups = new Map();
    for (const row of dupGroups) {
      const key = [row.tableName, row.columnName, row.refTable, row.refColumn, row.updateRule, row.deleteRule].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    // Collect the extra (to-drop) constraint names per table, so each table
    // needs only one ALTER TABLE (one rebuild) instead of one per constraint
    // — with thousands of duplicates, dropping them individually is far too
    // slow (each ALTER TABLE ... DROP FOREIGN KEY rebuilds the table).
    const extrasByTable = new Map();
    for (const rows of groups.values()) {
      if (rows.length <= 1) continue;
      // Keep the first (alphabetically earliest constraint name), drop the rest.
      const [, ...extras] = rows;
      for (const row of extras) {
        if (!extrasByTable.has(row.tableName)) extrasByTable.set(row.tableName, []);
        extrasByTable.get(row.tableName).push(row.constraintName);
      }
    }

    let dropped = 0;
    const CHUNK_SIZE = 50;
    for (const [tableName, constraintNames] of extrasByTable.entries()) {
      for (let i = 0; i < constraintNames.length; i += CHUNK_SIZE) {
        const chunk = constraintNames.slice(i, i + CHUNK_SIZE);
        const clauses = chunk.map((name) => `DROP FOREIGN KEY \`${name}\``).join(", ");
        try {
          await sequelize.query(`ALTER TABLE \`${tableName}\` ${clauses};`);
          dropped += chunk.length;
        } catch (e) {
          // Fall back to one-by-one for this chunk so a single already-gone
          // constraint (e.g. from a concurrent dev server restart) doesn't
          // block the rest of the batch.
          for (const name of chunk) {
            try {
              await sequelize.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${name}\`;`);
              dropped += 1;
            } catch (e2) {
              // Already gone — safe to skip.
            }
          }
        }
      }
    }

    if (dropped > 0) {
      // eslint-disable-next-line no-console
      console.log(`Dropped ${dropped} duplicate foreign key constraint(s).`);
    }
  },

  async down() {
    // Not reversible (and not desirable to reintroduce duplicates).
  },
};
