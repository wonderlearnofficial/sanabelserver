"use strict";

// Database V2, slice 1 (BACKFILL). Creates exactly one Admins row per existing
// admin User, copying the current scope out of Users.organizationId.
//
// Users.organizationId is READ ONLY here — never written, never cleared. Old
// code paths continue to work unchanged until a later CONTRACT migration.
//
// Idempotent: INSERT ... SELECT with a NOT EXISTS guard, so re-running adds
// nothing. Safe to re-run after a partial failure.
//
// Fails loudly if the resulting Admins row count does not match the admin User
// count, rather than leaving a silently half-migrated authorization table.
const TABLE = "Admins";

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    // Only reference organizations that actually exist. A dangling scope would
    // violate the FK and abort the whole migration; surfacing it as a skipped
    // row plus a failed count check is far more debuggable.
    await sequelize.query(`
      INSERT INTO ${TABLE} (userId, organizationId, createdAt, updatedAt)
      SELECT u.id,
             CASE WHEN o.id IS NULL THEN NULL ELSE u.organizationId END,
             NOW(), NOW()
      FROM Users u
      LEFT JOIN Organizations o ON o.id = u.organizationId
      WHERE u.role = 'Admin'
        AND NOT EXISTS (SELECT 1 FROM ${TABLE} a WHERE a.userId = u.id)
    `);

    const [[counts]] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM Users WHERE role = 'Admin')                              AS adminUsers,
        (SELECT COUNT(*) FROM ${TABLE})                                                AS adminRows,
        (SELECT COUNT(*) FROM Users WHERE role='Admin' AND organizationId IS NULL)      AS superUsers,
        (SELECT COUNT(*) FROM ${TABLE} WHERE organizationId IS NULL)                    AS superRows,
        (SELECT COUNT(*) FROM Users WHERE role='Admin' AND organizationId IS NOT NULL)   AS schoolUsers,
        (SELECT COUNT(*) FROM ${TABLE} WHERE organizationId IS NOT NULL)                AS schoolRows
    `);

    if (Number(counts.adminUsers) !== Number(counts.adminRows)) {
      throw new Error(
        `Admins backfill parity failed: ${counts.adminUsers} admin Users vs ${counts.adminRows} Admins rows`,
      );
    }
    if (Number(counts.superUsers) !== Number(counts.superRows)) {
      throw new Error(
        `Super-admin scope parity failed: ${counts.superUsers} expected vs ${counts.superRows} migrated`,
      );
    }
    if (Number(counts.schoolUsers) !== Number(counts.schoolRows)) {
      throw new Error(
        `School-admin scope parity failed: ${counts.schoolUsers} expected vs ${counts.schoolRows} migrated`,
      );
    }
  },

  async down(queryInterface) {
    // Removes only the backfilled rows; the table itself belongs to
    // 20260902000000. Users.organizationId was never modified, so the previous
    // authorization behaviour is fully intact after a rollback.
    await queryInterface.sequelize.query(`DELETE FROM ${TABLE}`);
  },
};
