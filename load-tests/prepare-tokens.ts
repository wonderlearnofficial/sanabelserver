import dotenv from "dotenv";
dotenv.config();

if (
  process.env.MYSQL_DB_HOST !== "localhost" &&
  process.env.MYSQL_DB_HOST !== "127.0.0.1"
) {
  console.error("FATAL: prepare-tokens MUST ONLY RUN ON LOCAL ENVIRONMENT");
  process.exit(1);
}

process.env.ACCESS_TOKEN_TTL = "7d";
import fs from "fs";
import path from "path";
import { Op } from "sequelize";
import { rundb } from "../src/config/db_connection";
import User, { UserRole } from "../src/models/user.model";
import Student from "../src/models/student.model";
import Admin from "../src/models/admin.model";
import { signAccessToken } from "../src/helpers/tokens";

async function prepareTokens() {
  console.log("Preparing authenticated JWT tokens for load testing...");
  await rundb();

  // Super Admin
  const superAdminUser = await User.findOne({
    where: { email: { [(Op as any).like]: "load_superadmin_%" } } as any,
  });
  if (!superAdminUser) throw new Error("Super admin fixture not found");
  const superAdminToken = signAccessToken({
    id: superAdminUser.id,
    email: superAdminUser.email,
    role: superAdminUser.role,
    tokenVersion: superAdminUser.tokenVersion ?? 0,
  });

  // School Admins
  const schoolAdminUsers = await User.findAll({
    where: { email: { [(Op as any).like]: "load_schooladmin_%" } } as any,
    limit: 10,
  });
  const schoolAdminTokens = schoolAdminUsers.map((u) => ({
    userId: u.id,
    email: u.email,
    token: signAccessToken({
      id: u.id,
      email: u.email,
      role: u.role,
      tokenVersion: u.tokenVersion ?? 0,
    }),
  }));

  // Teachers
  const teacherUsers = await User.findAll({
    where: { email: { [(Op as any).like]: "load_teacher_%" } } as any,
    limit: 50,
  });
  const teacherTokens = teacherUsers.map((u) => ({
    userId: u.id,
    email: u.email,
    token: signAccessToken({
      id: u.id,
      email: u.email,
      role: u.role,
      tokenVersion: u.tokenVersion ?? 0,
    }),
  }));

  // Parents
  const parentUsers = await User.findAll({
    where: { email: { [(Op as any).like]: "load_parent_%" } } as any,
    limit: 50,
  });
  const parentTokens = parentUsers.map((u) => ({
    userId: u.id,
    email: u.email,
    token: signAccessToken({
      id: u.id,
      email: u.email,
      role: u.role,
      tokenVersion: u.tokenVersion ?? 0,
    }),
  }));

  // Students (both School and Solo)
  const studentUsers = await User.findAll({
    where: { email: { [(Op as any).like]: "load_student_%" } } as any,
    limit: 200,
  });
  const studentTokens = studentUsers.map((u) => ({
    userId: u.id,
    email: u.email,
    token: signAccessToken({
      id: u.id,
      email: u.email,
      role: u.role,
      tokenVersion: u.tokenVersion ?? 0,
    }),
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    superAdminToken,
    schoolAdminTokens,
    teacherTokens,
    parentTokens,
    studentTokens,
  };

  const outputPath = path.join(__dirname, "tokens.json");
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Successfully generated tokens and saved to ${outputPath}`);
  console.log(`  Super Admin: 1 token`);
  console.log(`  School Admins: ${schoolAdminTokens.length} tokens`);
  console.log(`  Teachers: ${teacherTokens.length} tokens`);
  console.log(`  Parents: ${parentTokens.length} tokens`);
  console.log(`  Students: ${studentTokens.length} tokens`);
}

if (require.main === module) {
  prepareTokens()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Token prep error:", err);
      process.exit(1);
    });
}
