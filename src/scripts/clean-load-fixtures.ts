import dotenv from "dotenv";
dotenv.config();

if (
  process.env.MYSQL_DB_HOST !== "localhost" &&
  process.env.MYSQL_DB_HOST !== "127.0.0.1"
) {
  console.error("SAFETY VIOLATION: clean-load-fixtures MUST ONLY RUN AGAINST LOCALHOST!");
  process.exit(1);
}

import { sequelize, rundb } from "../config/db_connection";
import { Op } from "sequelize";
import User from "../models/user.model";
import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Admin from "../models/admin.model";
import Organization from "../models/oraganization.model";
import StudentTask from "../models/student-task.model";
import StudentTodoDay from "../models/student-todo-day.model";
import StudentTodoItem from "../models/student-todo-item.model";
import MissionApprovalRequest from "../models/mission-approval-request.model";

export async function cleanLoadFixtures() {
  console.log("=== CLEANING SYNTHETIC LOAD FIXTURES ===");
  await rundb();

  await StudentTask.destroy({ where: { completionKey: { [Op.like]: "load_%" } } });
  await MissionApprovalRequest.destroy({ where: { id: { [Op.gt]: 3 } } });
  await StudentTodoDay.destroy({ where: { id: { [Op.gt]: 31 } } });
  await StudentTodoItem.destroy({ where: { activeKey: { [Op.like]: "load_%" } } });

  const loadUsers = await User.findAll({
    attributes: ["id"],
    where: { email: { [(Op as any).like]: "load_%" } } as any,
  });
  const userIds = loadUsers.map((u) => u.id);

  if (userIds.length > 0) {
    await Student.destroy({ where: { userId: userIds } });
    await Teacher.destroy({ where: { userId: userIds } });
    await Parent.destroy({ where: { userId: userIds } });
    await Admin.destroy({ where: { userId: userIds } });
    await User.destroy({ where: { id: userIds } });
  }

  await Organization.destroy({ where: { name: { [Op.like]: "Load Test School %" } } });

  console.log(`Cleaned ${userIds.length} synthetic load users and related data.`);
}

if (require.main === module) {
  cleanLoadFixtures().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
