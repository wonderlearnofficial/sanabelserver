import { sequelize } from "./src/config/db_connection";
import Task from "./src/models/task.model";

async function checkTask() {
  await sequelize.authenticate();
  console.log("Connected to DB");

  const task = await Task.findOne({ where: { id: 1 } });
  console.log("Task fetched by Sequelize:");
  console.log(JSON.stringify(task, null, 2));

  // Let's directly query to see what mysql returns
  const [results] = await sequelize.query("SELECT * FROM Tasks WHERE id = 1");
  console.log("Task fetched by direct raw SQL:");
  console.log(JSON.stringify(results, null, 2));

}

checkTask().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
