import bcrypt from "bcryptjs";
import User from "../models/user.model";
import Organization from "../models/oraganization.model";
import logger from "../config/logger";

interface AdminSeedConfig {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  organizationId: number | null;
}

const seedAdmin = async () => {
  try {
    // 1. Ensure Nawah Organization exists
    let nawahOrgId: number | null = null;
    try {
      const [nawahOrg] = await Organization.findOrCreate({
        where: { name: "Nawah" },
        defaults: {
          name: "Nawah",
          type: "School" as any,
        },
      });
      nawahOrgId = nawahOrg.id;
    } catch (orgErr) {
      logger.warn("Could not find/create Nawah organization during admin seeding", { error: orgErr });
    }

    // 2. Define core admin accounts
    const coreAdmins: AdminSeedConfig[] = [
      {
        firstName: "Super",
        lastName: "Admin",
        email: (process.env.SUPERADMIN_EMAIL || "superadmin@sanabelalehsan.com").toLowerCase().trim(),
        password: process.env.SUPERADMIN_PASSWORD || "SuperAdmin#Sanabel2026!",
        organizationId: null,
      },
      {
        firstName: "Nawah",
        lastName: "Admin",
        email: (process.env.NAWAH_ADMIN_EMAIL || "admin.nawah@sanabelalehsan.com").toLowerCase().trim(),
        password: process.env.NAWAH_ADMIN_PASSWORD || "Sanabel2026Admin!",
        organizationId: nawahOrgId,
      },
      {
        firstName: "Ali",
        lastName: "Elmayyah",
        email: (process.env.ALI_ADMIN_EMAIL || "alielmayyah@gmail.com").toLowerCase().trim(),
        password: process.env.ALI_ADMIN_PASSWORD || "Ali#Sanabel2026!",
        organizationId: null,
      },
    ];

    // Also support optional legacy ADMIN_EMAIL/ADMIN_PASSWORD env vars if provided
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const legacyEmail = process.env.ADMIN_EMAIL.toLowerCase().trim();
      if (!coreAdmins.some((a) => a.email === legacyEmail)) {
        coreAdmins.push({
          firstName: "Admin",
          lastName: "",
          email: legacyEmail,
          password: process.env.ADMIN_PASSWORD,
          organizationId: null,
        });
      }
    }

    // 3. Upsert / synchronize each admin account
    for (const admin of coreAdmins) {
      const hashedPassword = bcrypt.hashSync(admin.password, 10);
      const existing = await User.findOne({ where: { email: admin.email } });

      if (existing) {
        existing.password = hashedPassword;
        existing.role = "Admin";
        existing.isAccess = true;
        existing.otpVerified = true;
        existing.organizationId = admin.organizationId;
        await existing.save();
        logger.info("Admin user verified and updated", { email: admin.email, role: "Admin" });
      } else {
        await User.create({
          firstName: admin.firstName,
          lastName: admin.lastName,
          email: admin.email,
          password: hashedPassword,
          role: "Admin",
          organizationId: admin.organizationId,
          isAccess: true,
          otpVerified: true,
        });
        logger.info("Admin user created", { email: admin.email, role: "Admin" });
      }
    }
  } catch (error) {
    logger.error("Error during admin seeding:", { error });
  }
};

export default seedAdmin;
