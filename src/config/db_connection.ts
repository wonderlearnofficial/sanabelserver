// Sequelize core & dialect
import { Sequelize } from "@sequelize/core";
import { MariaDbDialect } from "@sequelize/mariadb";
import { MySqlDialect } from "@sequelize/mysql";
// Sequelize models
import User from "../models/user.model";
import Student from "../models/student.model";
import Parent from "../models/parent.model";
import Teacher from "../models/teacher.model";
import Organization from "../models/oraganization.model"; // If typo is fixed in filename, change path too
import Representative from "../models/representative.model";
import Donation from "../models/donation.model";
import Challenge from "../models/challenge.model";
import Reward from "../models/reward.model";
import Task from "../models/task.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import StudentTask from "../models/student-task.model";
import StudentChallenge from "../models/student-challenge.model";
import Groupe from "../models/groupe.model";
import TaskCategory from "../models/task-category.model";
import Tree from "../models/tree.model";
import MissionApprovalRequest from "../models/mission-approval-request.model";

// Seeder data
import seedAdmin from "../seeders/admin-seeder";
import taskCategorySeed from "../seeders/task-category";
import demoTree from "../seeders/demo-tree-seeders";
import demoTaskSeeder from "../seeders/20241118230008-demo-task";
import demoChallengeSeeder from "../seeders/challange-seeder";

// Utils & libraries
import _ from "lodash";
import logger from "./logger";

logger.debug(
  "Database configuration initiated",
  {
    database: process.env.MYSQL_DB_NAME,
    user: process.env.MYSQL_DB_USER,
    host: process.env.MYSQL_DB_HOST,
    port: process.env.MYSQL_DB_PORT,
  }
);


let sequelize: Sequelize;

if (process.env.DB_DRIVER === "mariadb")
  sequelize = new Sequelize({
    dialect: MariaDbDialect,
    database: process.env.MYSQL_DB_NAME,
    user: process.env.MYSQL_DB_USER,
    password: process.env.MYSQL_DB_PASS,
    host: process.env.MYSQL_DB_HOST,
    port: Number(process.env.MYSQL_DB_PORT),
  });
else
  sequelize = new Sequelize({
    dialect: MySqlDialect,
    database: process.env.MYSQL_DB_NAME,
    user: process.env.MYSQL_DB_USER,
    password: process.env.MYSQL_DB_PASS,
    host: process.env.MYSQL_DB_HOST,
    port: Number(process.env.MYSQL_DB_PORT),
  });

logger.info("Using Database Driver:", { driver: process.env.DB_DRIVER });

const rundb = async () => {
  const models = {
    User,
    Parent,
    Student,
    Teacher,
    Organization,
    Representative,
    Donation,
    Challenge,
    Reward,
    TaskCategory,
    Task,
    Class,
    Grade,
    StudentTask,
    StudentChallenge,
    Groupe,

    Tree,
    MissionApprovalRequest,
  };
  Object.values(models).forEach((model) => {
    model.initModel(sequelize);
  });

  // Instead of assigning to sequelize.models (readonly), keep your own:
  const registeredModels = { ...models };

  // Call associate with registeredModels
  Object.values(registeredModels).forEach((model) => {
    if (typeof model.associate === "function") {
      model.associate(registeredModels);
    }
  });

  try {
    await sequelize.sync({ alter: true });
    logger.info("Database & models table created/updated!");
  } catch (error) {
    logger.error("Unable to connect to the database schema:", { error });
  }

};

const seedGradesAndMigrate = async () => {
  try {
    logger.info("🔍 Seeding and migrating grades...");
    await Grade.sync();
    try {
      await Class.sync({ alter: true });
    } catch (e) {
      logger.warn("Class table sync alter failed, retrying standard sync:", e);
      await Class.sync();
    }
    try {
      await Student.sync({ alter: true });
    } catch (e) {
      logger.warn("Student table sync alter failed, retrying standard sync:", e);
      await Student.sync();
    }
    const defaultGrades = ["primary", "preparatory", "secondary"];
    
    for (const name of defaultGrades) {
      await Grade.findOrCreate({
        where: { name },
        defaults: { name }
      });
    }

    const grades = await Grade.findAll();
    const gradeMap = new Map<string, number>();
    grades.forEach(g => {
      gradeMap.set(g.name.toLowerCase(), g.id);
    });

    const studentsToMigrate = await Student.findAll({
      where: { gradeId: null }
    });
    for (const student of studentsToMigrate) {
      const oldGrade = student.grade;
      if (oldGrade) {
        const matchingId = gradeMap.get(oldGrade.toLowerCase());
        if (matchingId) {
          student.gradeId = matchingId;
          await student.save();
        }
      }
    }

    const classesToMigrate = await Class.findAll({
      where: { gradeId: null }
    });
    for (const cls of classesToMigrate) {
      const oldGrade = cls.grade;
      if (oldGrade) {
        const matchingId = gradeMap.get(oldGrade.toLowerCase());
        if (matchingId) {
          cls.gradeId = matchingId;
          await cls.save();
        }
      }
    }

    logger.info("✅ Grades seeded and migrated successfully!");
  } catch (error) {
    logger.error("❌ Error seeding and migrating grades:", { error });
  }
};

const connectToDb = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    logger.info("✅ Successfully connected to our DB");

    // Initialize models and associations
    await rundb();

    // Ensure a working admin login always exists in this environment
    await seedAdmin();
    await seedGradesAndMigrate();
  } catch (error) {
    logger.error("❌ Database connection error:", { error });
  }
};


export const seedData = async () => {
  await connectToDb();
  // -----------------------------
  // Handle TasksCategory seeding/updating
  // -----------------------------
  console.log("🔍 Fetching existing Task Categories...");
  const existingCategories = await TaskCategory.findAll();
  const seedCategories: any[] = taskCategorySeed.data || [];

  // Identify categories to insert or update
  const taskCategoryToUpsert = seedCategories.filter((seedCategory) => {
    const existingTaskCategory = existingCategories.find(
      (TaskCategory) => TaskCategory.id === seedCategory.id
    );
    if (!existingTaskCategory) return true; // New task, needs insertion

    // Compare attributes
    const existingFiltered = _.omit(existingTaskCategory.toJSON(), [
      "createdAt",
      "updatedAt",
    ]);
    const seedFiltered = _.omit(seedCategory, ["createdAt", "updatedAt"]);
    return !_.isEqual(existingFiltered, seedFiltered);
  });

  // Identify categories to delete
  const categoriesToDelete = existingCategories.filter((existingCategory) => {
    return !seedCategories.some(
      (seedCategory) => seedCategory.title === existingCategory.title
    );
  });

  // Perform upserts and deletions
  if (taskCategoryToUpsert.length > 0) {
    logger.info("🔍 Upserting Task Categories:", { count: taskCategoryToUpsert.length });
    await Promise.all(
      taskCategoryToUpsert.map((category) => TaskCategory.upsert(category))
    );
    logger.info("✅ Task Category data upserted successfully!");
  } else {
    logger.info("✔️ Task Category data is already up to date.");
  }


  if (categoriesToDelete.length > 0) {
    logger.info("🔍 Deleting Task Categories:", { count: categoriesToDelete.length });
    await Promise.all(categoriesToDelete.map((category) => category.destroy()));
    logger.info("✅ Task Category data deleted successfully!");
  } else {
    logger.info("✔️ No Task Categories to delete.");
  }


  // -----------------------------
  // Handle Tasks seeding/updating
  // -----------------------------
  const existingTasks = await Task.findAll();
  const seedTasks: any[] = demoTaskSeeder.data || [];
  console.log("Seed Tasks:", seedTasks.length);
  console.log("Existing Tasks:", existingTasks.length);
  // Identify tasks to insert or update
  const tasksToUpsert =
    existingTasks.length === 0
      ? seedTasks
      : seedTasks.filter((seedTask) => {
          const existingTask = existingTasks.find(
            (task) => task.id === seedTask.id
          );
          if (!existingTask) return true; // New task, needs insertion

          // Compare all attributes (excluding metadata like createdAt, updatedAt)
          const existingFiltered = _.omit(existingTask.toJSON(), [
            "createdAt",
            "updatedAt",
          ]);
          const seedFiltered = _.omit(seedTask, ["createdAt", "updatedAt"]);

          return !_.isEqual(existingFiltered, seedFiltered);
        });

  // Identify tasks to delete (exist in DB but not in seed data)
  const tasksToDelete = existingTasks.filter((existingTask) => {
    return !seedTasks.some((seedTask) => seedTask.id === existingTask.id);
  });

  // Perform upserts and deletions
  if (tasksToUpsert.length > 0) {
    console.log("🔍 Upserting Tasks:", tasksToUpsert.length);
    await Promise.all(tasksToUpsert.map((task) => Task.upsert(task)));
    console.log("✅ Task data upserted successfully!");
  } else {
    console.log("✔️ Task data is already up to date.");
  }

  if (tasksToDelete.length > 0) {
    console.log("🔍 Deleting Tasks:", tasksToDelete.length);
    await Promise.all(tasksToDelete.map((task) => task.destroy()));
    console.log("✅ Task data deleted successfully!");
  } else {
    console.log("✔️ No tasks to delete.");
  }

  // -----------------------------
  // Handle Trees seeding/updating
  // -----------------------------
  const existingTrees = await Tree.findAll();
  const seedTrees: any[] = demoTree.data || [];

  // Identify trees to insert or update
  const treesToUpsert = seedTrees.filter((seedTree) => {
    const existingTree = existingTrees.find((tree) => tree.id === seedTree.id);
    if (!existingTree) return true; // New tree, needs insertion

    // Compare all attributes (excluding metadata like createdAt, updatedAt)
    const existingFiltered = _.omit(existingTree.toJSON(), [
      "createdAt",
      "updatedAt",
    ]);
    const seedFiltered = _.omit(seedTree, ["createdAt", "updatedAt"]);

    return !_.isEqual(existingFiltered, seedFiltered);
  });

  // Identify trees to delete (exist in DB but not in seed data)
  const treesToDelete = existingTrees.filter((existingTree) => {
    return !seedTrees.some((seedTree) => seedTree.id === existingTree.id);
  });

  // Perform upserts and deletions
  if (treesToUpsert.length > 0) {
    console.log("🔍 Upserting Trees:", treesToUpsert.length);
    await Promise.all(treesToUpsert.map((tree) => Tree.upsert(tree)));
    console.log("✅ Tree data upserted successfully!");
  } else {
    console.log("✔️ Tree data is already up to date.");
  }

  if (treesToDelete.length > 0) {
    console.log("🔍 Deleting Trees:", treesToDelete.length);
    await Promise.all(treesToDelete.map((tree) => tree.destroy()));
    console.log("✅ Tree data deleted successfully!");
  } else {
    console.log("✔️ No trees to delete.");
  }
  // -----------------------------
  // Handle Challange seeding/updating
  // -----------------------------
  const existingChallanges = await Challenge.findAll();
  const seedChallanges: any[] = demoChallengeSeeder.data || [];
  // Identify trees to insert or update
  const ChallangeToUpsert = seedChallanges.filter((seedChallange) => {
    const existingChallange = existingChallanges.find(
      (challange) => challange.id === seedChallange.id
    );
    if (!existingChallange) return true; // New tree, needs insertion

    // Compare all attributes (excluding metadata like createdAt, updatedAt)
    const existingFiltered = _.omit(existingChallange.toJSON(), [
      "createdAt",
      "updatedAt",
    ]);
    const seedFiltered = _.omit(seedChallange, ["createdAt", "updatedAt"]);

    return !_.isEqual(existingFiltered, seedFiltered);
  });

  // Identify trees to delete (exist in DB but not in seed data)
  const ChallangeToDelete = existingChallanges.filter((existingChallange) => {
    return !seedChallanges.some(
      (seedChallange) => seedChallange.id === existingChallange.id
    );
  });

  // Perform upserts and deletions
  if (ChallangeToUpsert.length > 0) {
    console.log("🔍 Upserting Challenges:", ChallangeToUpsert.length);
    await Promise.all(
      ChallangeToUpsert.map((challange) => Challenge.upsert(challange))
    );
    console.log("✅ Challenge data upserted successfully!");
  } else {
    console.log("✔️ Challenge data is already up to date.");
  }

  if (ChallangeToDelete.length > 0) {
    console.log("🔍 Deleting Challenges:", ChallangeToDelete.length);
    await Promise.all(
      ChallangeToDelete.map((challange) => challange.destroy())
    );
    console.log("✅ Challenge data deleted successfully!");
  } else {
    console.log("✔️ No Challenges to delete.");
  }
};

if (require.main === module) {
  const arg = process.argv[2];
  console.log("Argument:", arg);
  if (arg === "seed") {
    seedData().catch((err) => logger.error("Seeding failed", { error: err }));
  }
}


export { sequelize, connectToDb, rundb };
