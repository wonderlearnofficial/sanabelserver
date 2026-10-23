import "dotenv/config";
import { sequelize, rundb } from "../config/db_connection";
import Challenge from "../models/challenge.model";
import challengeSeed from "../seeders/challange-seeder";

/**
 * Repairs Arabic challenge (trophy) titles destroyed at write time.
 *
 * The symptom is a title of literal `?` characters — the trophy list renders
 * "???????????? Trophy". The stored bytes really are `0x3F`: the Arabic was
 * replaced during an insert that went through a latin1 connection, so it cannot
 * be recovered by reading with a different charset. The column itself is
 * `utf8mb4` and the session charset is correct; only the stored data is lost.
 *
 * Recovery is therefore a rewrite from a trusted source, and the only trusted
 * source is `seeders/challange-seeder`, which holds the intact Arabic and is
 * matched here by primary key. **Nothing is guessed**: a row whose id is absent
 * from the seeder is left exactly as it is, and the script fails loudly rather
 * than reporting success if any corruption survives.
 *
 * Mirrors `repair-local-arabic-task-catalog` deliberately, including the
 * loopback guard — this rewrites rows, so it must never be pointed at
 * production.
 *
 * Run with: npm run repair:local-arabic-challenges
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Three or more consecutive `?` is destroyed Arabic, not punctuation. */
const destroyedArabic = /\?{3,}/;

/** The text columns a challenge carries. */
const TEXT_FIELDS = ["title", "description", "category", "taskCategory", "tasktype"] as const;

const isDestroyed = (row: Record<string, unknown>): boolean =>
  TEXT_FIELDS.some((field) => {
    const value = row[field];
    return typeof value === "string" && destroyedArabic.test(value);
  });

const main = async () => {
  const host = process.env.MYSQL_DB_HOST || "";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("Refusing challenge catalog repair: MYSQL_DB_HOST is not loopback");
  }

  process.env.DB_SYNC_ON_STARTUP = "false";
  await rundb();
  await sequelize.authenticate();

  const trustedRows = challengeSeed.data as Array<Record<string, any>>;
  let repaired = 0;
  let skippedUnknownId = 0;

  await sequelize.transaction(async (transaction) => {
    for (const trusted of trustedRows) {
      const current = await Challenge.findByPk(trusted.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!current) continue;

      // Only touch rows that are actually damaged. An intact row that happens
      // to differ from the seeder may have been edited on purpose.
      if (!isDestroyed(current.toJSON() as Record<string, unknown>)) continue;

      await current.update(
        {
          title: trusted.title,
          description: trusted.description,
          category: trusted.category,
          taskCategory: trusted.taskCategory,
          tasktype: trusted.tasktype,
        },
        { transaction },
      );
      repaired += 1;
    }
  });

  const all = await Challenge.findAll({ attributes: ["id", ...TEXT_FIELDS] });
  const stillCorrupted = all.filter((row) =>
    isDestroyed(row.toJSON() as Record<string, unknown>),
  );
  const trustedIds = new Set(trustedRows.map((row) => row.id));
  skippedUnknownId = stillCorrupted.filter((row) => !trustedIds.has(row.id)).length;

  console.log(
    JSON.stringify({
      repaired,
      totalChallenges: all.length,
      corruptedRemaining: stillCorrupted.length,
      corruptedWithNoTrustedSource: skippedUnknownId,
    }),
  );

  if (stillCorrupted.length !== 0) {
    // Better to fail than to invent a title for a row the seeder does not
    // cover. Those rows need a decision, not a guess.
    throw new Error(
      `${stillCorrupted.length} corrupted challenge rows remain (${skippedUnknownId} have no trusted source); no untrusted replacement was attempted`,
    );
  }
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
