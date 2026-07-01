import bcrypt from "bcryptjs";
import User from "../models/user.model";
import logger from "../config/logger";

const seedAdmin = async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    logger.warn("ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping admin seeding");
    return;
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    logger.info("Admin user already exists, skipping seeding", { email });
    return;
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  await User.create({
    firstName: "Admin",
    lastName: "",
    email,
    password: hashedPassword,
    role: "Admin",
    isAccess: true,
    otpVerified: true,
  });

  logger.info("Admin user seeded", { email });
};

export default seedAdmin;
