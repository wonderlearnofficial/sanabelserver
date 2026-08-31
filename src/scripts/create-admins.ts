import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { sequelize } from "../config/db_connection";
import User from "../models/user.model";
import Organization from "../models/oraganization.model";

async function setupAdmins() {
  try {
    await sequelize.authenticate();
    console.log("Connected to database.");

    User.initModel(sequelize);
    Organization.initModel(sequelize);

    // 1. Delete old admin users (except if alielmayyah is an admin, we handle him explicitly)
    console.log("Cleaning up old admin users...");
    await User.destroy({
      where: { role: "Admin" },
    });

    // 2. Ensure Nawah Organization exists
    let [nawahOrg] = await Organization.findOrCreate({
      where: { name: "Nawah" },
      defaults: {
        name: "Nawah",
        type: "School" as any,
      },
    });
    console.log(`Nawah Organization ready (ID: ${nawahOrg.id}, Name: ${nawahOrg.name})`);

    // 3. Create Super Admin (organizationId: null -> sees all schools)
    const superAdminEmail = process.env.SUPERADMIN_EMAIL || "superadmin@sanabelalehsan.com";
    const superAdminPassword = process.env.SUPERADMIN_PASSWORD || "SuperAdmin#Sanabel2026!";
    const hashedSuperPassword = bcrypt.hashSync(superAdminPassword, 10);

    const superAdmin = await User.create({
      firstName: "Super",
      lastName: "Admin",
      email: superAdminEmail,
      password: hashedSuperPassword,
      role: "Admin",
      organizationId: null, // Superadmin scope: sees everything
      isAccess: true,
      otpVerified: true,
    });
    console.log(`Created Super Admin: ${superAdmin.email} (ID: ${superAdmin.id}, organizationId: null)`);

    // 4. Create Nawah School Admin (organizationId: nawahOrg.id -> scoped to Nawah)
    const nawahAdminEmail = process.env.NAWAH_ADMIN_EMAIL || "admin.nawah@sanabelalehsan.com";
    const nawahAdminPassword = process.env.NAWAH_ADMIN_PASSWORD || "Sanabel2026Admin!";
    const hashedNawahPassword = bcrypt.hashSync(nawahAdminPassword, 10);

    const nawahAdmin = await User.create({
      firstName: "Nawah",
      lastName: "Admin",
      email: nawahAdminEmail,
      password: hashedNawahPassword,
      role: "Admin",
      organizationId: nawahOrg.id, // Scoped to Nawah
      isAccess: true,
      otpVerified: true,
    });
    console.log(`Created Nawah School Admin: ${nawahAdmin.email} (ID: ${nawahAdmin.id}, organizationId: ${nawahOrg.id})`);

    // 5. Update/Create user alielmayyah@gmail.com
    const aliEmail = "alielmayyah@gmail.com";
    const aliPassword = "Ali#Sanabel2026!";
    const hashedAliPassword = bcrypt.hashSync(aliPassword, 10);

    let aliUser = await User.findOne({ where: { email: aliEmail } });
    if (aliUser) {
      aliUser.password = hashedAliPassword;
      aliUser.isAccess = true;
      aliUser.otpVerified = true;
      await aliUser.save();
      console.log(`Updated existing user: ${aliEmail} (ID: ${aliUser.id}, Role: ${aliUser.role})`);
    } else {
      aliUser = await User.create({
        firstName: "Ali",
        lastName: "Elmayyah",
        email: aliEmail,
        password: hashedAliPassword,
        role: "Admin",
        organizationId: null,
        isAccess: true,
        otpVerified: true,
      });
      console.log(`Created user: ${aliEmail} (ID: ${aliUser.id}, Role: ${aliUser.role})`);
    }

    // 6. Write sanabel admin.txt in the root workspace
    const rootPath = path.resolve(__dirname, "../../../");
    const adminTxtPath = path.join(rootPath, "sanabel admin.txt");

    const fileContent = `=====================================================
               SANABEL AL-EHSAN ADMIN ACCOUNTS
=====================================================

1. SUPER ADMIN (Full Global Access)
   - Description : Sees and manages all schools, users, grades, and metrics.
   - Email       : ${superAdminEmail}
   - Password    : ${superAdminPassword}
   - Scope       : Global (organizationId: null)

-----------------------------------------------------

2. SCHOOL ADMIN (Nawah School Scoped)
   - Description : Scoped strictly to Nawah school.
   - Email       : ${nawahAdminEmail}
   - Password    : ${nawahAdminPassword}
   - Scope       : Nawah (Org ID: ${nawahOrg.id})

-----------------------------------------------------

3. PERSONAL / DEVELOPER ACCOUNT
   - Description : ${aliUser.role} Account (${aliUser.firstName} ${aliUser.lastName || ""})
   - Email       : ${aliEmail}
   - Password    : ${aliPassword}
   - Role        : ${aliUser.role}
   - Scope       : ${aliUser.organizationId ? `Org ID: ${aliUser.organizationId}` : "Global / Superadmin"}

=====================================================
Generated on: ${new Date().toISOString()}
`;

    fs.writeFileSync(adminTxtPath, fileContent, "utf-8");
    console.log(`Wrote credentials to: ${adminTxtPath}`);

    console.log("\n=================== ADMIN SETUP SUMMARY ===================");
    console.log(`1. Super Admin: ${superAdminEmail}`);
    console.log(`2. Nawah Admin: ${nawahAdminEmail}`);
    console.log(`3. Ali Account: ${aliEmail}`);
    console.log(`File saved: sanabel admin.txt`);
    console.log("===========================================================\n");

  } catch (error) {
    console.error("Error setting up admins:", error);
  } finally {
    await sequelize.close();
  }
}

setupAdmins();
