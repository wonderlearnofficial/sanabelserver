import "dotenv/config";
import { sequelize, rundb } from "../config/db_connection";
import Task from "../models/task.model";
import taskSeed from "../seeders/20241118230008-demo-task";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const destroyedArabic = /\?{3,}/;

const main = async () => {
  if (!LOOPBACK_HOSTS.has(process.env.MYSQL_DB_HOST || "")) {
    throw new Error("Refusing catalog repair: MYSQL_DB_HOST is not loopback");
  }

  process.env.DB_SYNC_ON_STARTUP = "false";
  await rundb();
  await sequelize.authenticate();

  let repaired = 0;
  await sequelize.transaction(async (transaction) => {
    for (const trusted of taskSeed.data as Array<Record<string, any>>) {
      const current = await Task.findByPk(trusted.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!current) continue;
      const values = [current.title, current.type, (current as any).description];
      if (!values.some((value) => typeof value === "string" && destroyedArabic.test(value))) continue;

      await current.update({
        title: trusted.title,
        type: trusted.type,
        description: trusted.description,
      }, { transaction });
      repaired += 1;
    }
  });

  const remaining = await Task.count();
  const corrupted = (await Task.findAll({ attributes: ["title", "type", "description"] }))
    .filter((task) => [task.title, task.type, (task as any).description]
      .some((value) => typeof value === "string" && destroyedArabic.test(value))).length;
  console.log(JSON.stringify({ repaired, totalTasks: remaining, corruptedTasksRemaining: corrupted }));
  if (corrupted !== 0) throw new Error("Some corrupted task rows remain; no untrusted replacement was attempted");
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
