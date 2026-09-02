import { Request, Response } from "express";
import User from "../models/user.model";
import logger from "../config/logger";
import { signAccessToken } from "../helpers/tokens";

// Emails that identify the test-account family
const TEST_ACCOUNT_EMAILS = [
  "admin.test@sanabel.local",
  "teacher.test@sanabel.local",
  "ahmed.hassan@sanabel.local",
  "khaled.mahmoud@sanabel.local",
  "adel.samir@sanabel.local",
  "omar.ahmed@sanabel.local",
  "lina.ahmed@sanabel.local",
  "adam.khaled@sanabel.local",
  "noor.khaled@sanabel.local",
  "youssef.adel@sanabel.local",
];

const SHARED_TEST_PASSWORD = "Test#Sanabel2026!";
const isProd = () => process.env.NODE_ENV === "production";

// Everything in this controller is a local-development convenience only —
// it issues login tokens without a password, so it must never respond
// outside of a non-production environment.
const isDevEnvironment = () => process.env.NODE_ENV !== "production";

const listUsersForDevLogin = async (req: Request, res: Response) => {
  if (!isDevEnvironment()) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const users = await User.findAll({
      where: { isAccess: true },
      attributes: ["id", "firstName", "lastName", "email", "role", "tokenVersion"],
      order: [["role", "ASC"], ["id", "ASC"]],
    });

    const grouped: Record<string, any[]> = {
      Student: [],
      Teacher: [],
      Parent: [],
      Admin: [],
    };

    users.forEach((user) => {
      const bucket = grouped[user.role];
      if (bucket) {
        bucket.push({
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        });
      }
    });

    return res.status(200).json({ data: grouped });
  } catch (error) {
    logger.error("Error in listUsersForDevLogin:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const loginAsUser = async (req: Request, res: Response) => {
  if (!isDevEnvironment()) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    return res.status(200).json({
      data: { token, email: user.email, role: user.role },
    });
  } catch (error) {
    logger.error("Error in loginAsUser:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * GET /dev/test-accounts
 * Returns structured test account relationship data.
 * Available in all environments. Passwords are redacted in production.
 */
const getTestAccounts = async (req: Request, res: Response) => {
  try {
    // Load models lazily so this file compiles even if models aren't yet initialized
    const Organization = require("../models/oraganization.model").default;
    const Grade = require("../models/grade.model").default;
    const Class = require("../models/class.model").default;
    const Student = require("../models/student.model").default;
    const Teacher = require("../models/teacher.model").default;
    const Parent = require("../models/parent.model").default;
    const Admin = require("../models/admin.model").default;

    // Find the test school
    const school = await Organization.findOne({ where: { name: "Sanabel Test School" } });
    if (!school) {
      return res.status(404).json({ success: false, message: "Test accounts not seeded yet." });
    }

    const grade = await Grade.findOne({ where: { name: "Test Grade 5", organizationId: school.id } });
    const cls   = await Class.findOne({ where: { classname: "Test Class 5A", organizationId: school.id } });

    // Admin
    const adminUser = await User.findOne({ where: { email: "admin.test@sanabel.local" } });
    let adminProfile: any = null;
    if (adminUser) {
      adminProfile = await Admin.findOne({ where: { userId: adminUser.id } });
    }

    // Teacher
    const teacherUser = await User.findOne({ where: { email: "teacher.test@sanabel.local" } });
    let teacherRecord: any = null;
    if (teacherUser) {
      teacherRecord = await Teacher.findOne({ where: { userId: teacherUser.id } });
    }

    // Parents and their students
    const parentEmails = [
      "ahmed.hassan@sanabel.local",
      "khaled.mahmoud@sanabel.local",
      "adel.samir@sanabel.local",
    ];

    const families: any[] = [];
    for (const email of parentEmails) {
      const parentUser = await User.findOne({ where: { email } });
      if (!parentUser) continue;
      const parentRow = await Parent.findOne({ where: { userId: parentUser.id } });

      const linkedStudents = parentRow
        ? await Student.findAll({ where: { ParentId: parentRow.id } })
        : [];

      const children: any[] = [];
      for (const st of linkedStudents) {
        const childUser = await User.findOne({ where: { id: st.userId } });
        if (!childUser) continue;
        children.push({
          userId: childUser.id,
          studentId: st.id,
          firstName: childUser.firstName,
          lastName: childUser.lastName,
          email: childUser.email,
          connectCode: st.connectCode,
          password: isProd() ? null : SHARED_TEST_PASSWORD,
        });
      }

      families.push({
        parent: {
          userId: parentUser.id,
          parentId: parentRow?.id ?? null,
          firstName: parentUser.firstName,
          lastName: parentUser.lastName,
          email: parentUser.email,
          password: isProd() ? null : SHARED_TEST_PASSWORD,
        },
        children,
      });
    }

    const data = {
      school: school ? { id: school.id, name: school.name } : null,
      grade:  grade  ? { id: grade.id,  name: grade.name  } : null,
      class:  cls    ? { id: cls.id,    name: cls.classname } : null,
      admin: adminUser ? {
        userId: adminUser.id,
        adminsId: adminProfile?.id ?? null,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        email: adminUser.email,
        password: isProd() ? null : SHARED_TEST_PASSWORD,
      } : null,
      teacher: teacherUser ? {
        userId: teacherUser.id,
        teacherId: teacherRecord?.id ?? null,
        firstName: teacherUser.firstName,
        lastName: teacherUser.lastName,
        email: teacherUser.email,
        password: isProd() ? null : SHARED_TEST_PASSWORD,
      } : null,
      families,
      isProduction: isProd(),
    };

    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error("Error in getTestAccounts:", { error });
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

export { listUsersForDevLogin, loginAsUser, getTestAccounts };
