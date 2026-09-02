import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { sequelize, rundb } from "../config/db_connection";

const SHARED_PASSWORD = "Test#Sanabel2026!";
const SCHOOL_NAME = "Sanabel Test School";
const GRADE_NAME = "Test Grade 5";
const CLASS_NAME = "Test Class 5A";

async function generateUniqueConnectCode(Student: any): Promise<string> {
  let code = "";
  let exists = true;
  while (exists) {
    code = Math.floor(10000 + Math.random() * 90000).toString();
    const existing = await Student.findOne({ where: { connectCode: code } });
    if (!existing) exists = false;
  }
  return code;
}

async function ensureUser(
  User: any,
  opts: {
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    hashedPassword: string;
    organizationId?: number | null;
  }
): Promise<any> {
  const [user] = await User.findOrCreate({
    where: { email: opts.email },
    defaults: {
      firstName: opts.firstName,
      lastName: opts.lastName,
      email: opts.email,
      password: opts.hashedPassword,
      role: opts.role,
      isAccess: true,
      otpVerified: true,
      ...(opts.organizationId !== undefined ? { organizationId: opts.organizationId } : {}),
    },
  });
  return user;
}

async function seedTestAccounts() {
  try {
    await rundb();
    console.log("Connected to database & models initialized.");

    const models = {
      User: require("../models/user.model").default,
      Admin: require("../models/admin.model").default,
      Parent: require("../models/parent.model").default,
      Student: require("../models/student.model").default,
      Teacher: require("../models/teacher.model").default,
      Organization: require("../models/oraganization.model").default,
      Class: require("../models/class.model").default,
      Grade: require("../models/grade.model").default,
      Challenge: require("../models/challenge.model").default,
      StudentChallenge: require("../models/student-challenge.model").default,
    };

    const { User, Admin, Parent, Student, Teacher, Organization, Class, Grade, Challenge, StudentChallenge } = models;
    const hashedPassword = bcrypt.hashSync(SHARED_PASSWORD, 10);

    // 1. Organization
    let [school] = await Organization.findOrCreate({
      where: { name: SCHOOL_NAME },
      defaults: { name: SCHOOL_NAME, type: "School" },
    });
    console.log(`School: ${school.name} (ID: ${school.id})`);

    // 2. Grade
    let [grade] = await Grade.findOrCreate({
      where: { name: GRADE_NAME, organizationId: school.id },
      defaults: { name: GRADE_NAME, organizationId: school.id },
    });
    console.log(`Grade: ${grade.name} (ID: ${grade.id})`);

    // 3. School Admin User
    const adminEmail = "admin.test@sanabel.local";
    const adminUser = await ensureUser(User, {
      firstName: "Test",
      lastName: "Admin",
      email: adminEmail,
      role: "Admin",
      hashedPassword,
      organizationId: school.id,
    });

    // Admins profile row (authoritative scope)
    let [adminProfile] = await Admin.findOrCreate({
      where: { userId: adminUser.id },
      defaults: { userId: adminUser.id, organizationId: school.id },
    });
    if (adminProfile.organizationId !== school.id) {
      await adminProfile.update({ organizationId: school.id });
    }
    console.log(`Admin: ${adminUser.email} (User ID: ${adminUser.id}, Admins ID: ${adminProfile.id})`);

    // 4. Teacher
    const teacherEmail = "teacher.test@sanabel.local";
    const teacherUser = await ensureUser(User, {
      firstName: "Test",
      lastName: "Teacher",
      email: teacherEmail,
      role: "Teacher",
      hashedPassword,
    });
    let [teacherRecord] = await Teacher.findOrCreate({
      where: { userId: teacherUser.id },
      defaults: { userId: teacherUser.id, organizationId: school.id },
    });
    if (teacherRecord.organizationId !== school.id) {
      await teacherRecord.update({ organizationId: school.id });
    }
    console.log(`Teacher: ${teacherUser.email} (User ID: ${teacherUser.id}, Teacher ID: ${teacherRecord.id})`);

    // 5. Class
    let [cls] = await Class.findOrCreate({
      where: { classname: CLASS_NAME, organizationId: school.id },
      defaults: {
        classname: CLASS_NAME,
        organizationId: school.id,
        gradeId: grade.id,
        grade: grade.name,
        teacherId: teacherRecord.id,
      },
    });
    if (cls.teacherId !== teacherRecord.id || cls.gradeId !== grade.id) {
      await cls.update({ gradeId: grade.id, grade: grade.name, teacherId: teacherRecord.id });
    }
    console.log(`Class: ${cls.classname} (ID: ${cls.id}, Teacher ID: ${cls.teacherId})`);

    // 6. Parents
    const parentDefs = [
      { firstName: "Ahmed",  lastName: "Hassan",  email: "ahmed.hassan@sanabel.local"  },
      { firstName: "Khaled", lastName: "Mahmoud", email: "khaled.mahmoud@sanabel.local" },
      { firstName: "Adel",   lastName: "Samir",   email: "adel.samir@sanabel.local"    },
    ];

    const parentRecords: { user: any; parent: any }[] = [];
    for (const pd of parentDefs) {
      const parentUser = await ensureUser(User, { ...pd, role: "Parent", hashedPassword });
      const [parentRow] = await Parent.findOrCreate({
        where: { userId: parentUser.id },
        defaults: { userId: parentUser.id },
      });
      parentRecords.push({ user: parentUser, parent: parentRow });
      console.log(`Parent: ${parentUser.email} (User ID: ${parentUser.id}, Parent ID: ${parentRow.id})`);
    }

    const [ahmedHassan, khaledMahmoud, adelSamir] = parentRecords;

    // 7. Students
    const studentDefs = [
      { firstName: "Omar",    lastName: "Ahmed",  email: "omar.ahmed@sanabel.local",    parentRecord: ahmedHassan   },
      { firstName: "Lina",    lastName: "Ahmed",  email: "lina.ahmed@sanabel.local",    parentRecord: ahmedHassan   },
      { firstName: "Adam",    lastName: "Khaled", email: "adam.khaled@sanabel.local",   parentRecord: khaledMahmoud },
      { firstName: "Noor",    lastName: "Khaled", email: "noor.khaled@sanabel.local",   parentRecord: khaledMahmoud },
      { firstName: "Youssef", lastName: "Adel",   email: "youssef.adel@sanabel.local",  parentRecord: adelSamir     },
    ];

    const studentSummaries: any[] = [];
    const challenges = await Challenge.findAll();

    for (const sd of studentDefs) {
      const studentUser = await ensureUser(User, {
        firstName: sd.firstName,
        lastName: sd.lastName,
        email: sd.email,
        role: "Student",
        hashedPassword,
      });

      let studentRow = await Student.findOne({ where: { userId: studentUser.id } });
      if (!studentRow) {
        const connectCode = await generateUniqueConnectCode(Student);
        studentRow = await Student.create({
          userId: studentUser.id,
          organizationId: school.id,
          classId: cls.id,
          ParentId: sd.parentRecord.parent.id,
          gradeId: grade.id,
          grade: grade.name,
          connectCode,
          treeProgress: 1,
          medal: 1,
          xp: 0,
          water: 10,
          seeders: 10,
          snabelRed: 10,
          snabelBlue: 10,
          snabelYellow: 10,
        });
      } else {
        await studentRow.update({
          organizationId: school.id,
          classId: cls.id,
          ParentId: sd.parentRecord.parent.id,
          gradeId: grade.id,
          grade: grade.name,
        });
      }

      if (challenges.length > 0) {
        for (const ch of challenges) {
          await StudentChallenge.findOrCreate({
            where: { studentId: studentRow.id, challengeId: ch.id },
            defaults: { studentId: studentRow.id, challengeId: ch.id, completionStatus: "NotCompleted" },
          });
        }
      }

      studentSummaries.push({
        name: `${sd.firstName} ${sd.lastName}`,
        email: sd.email,
        studentId: studentRow.id,
        userId: studentUser.id,
        connectCode: studentRow.connectCode,
        parentName: `${sd.parentRecord.user.firstName} ${sd.parentRecord.user.lastName}`,
      });

      console.log(
        `Student: ${studentUser.email} (User ID: ${studentUser.id}, Student ID: ${studentRow.id}, Code: ${studentRow.connectCode}, Parent: ${sd.parentRecord.user.firstName})`
      );
    }

    if (challenges.length > 0) {
      console.log(`Attached ${challenges.length} challenges to each student.`);
    }

    // 8. Write credentials file
    const rootPath = path.resolve(__dirname, "../../../");
    const txtFilePath = path.join(rootPath, "sanabel test accounts.txt");

    const content = `===================================================
       SANABEL TEST ACCOUNTS
       Generated: ${new Date().toISOString()}
===================================================

Shared Password: ${SHARED_PASSWORD}

SCHOOL STRUCTURE
---------------------------------------------------
  School : ${school.name}  (Org ID: ${school.id})
  Grade  : ${grade.name}  (Grade ID: ${grade.id})
  Class  : ${cls.classname}  (Class ID: ${cls.id})

---------------------------------------------------
SCHOOL ADMIN (scoped to ${school.name})
---------------------------------------------------
  Email    : ${adminEmail}
  Password : ${SHARED_PASSWORD}
  User ID  : ${adminUser.id}
  Admins ID: ${adminProfile.id}

---------------------------------------------------
TEACHER (assigned to ${cls.classname})
---------------------------------------------------
  Email      : ${teacherEmail}
  Password   : ${SHARED_PASSWORD}
  User ID    : ${teacherUser.id}
  Teacher ID : ${teacherRecord.id}

---------------------------------------------------
FAMILIES
---------------------------------------------------

Ahmed Hassan  (ahmed.hassan@sanabel.local)
|-- Omar Ahmed   : omar.ahmed@sanabel.local   | Code: ${studentSummaries[0].connectCode}
+-- Lina Ahmed   : lina.ahmed@sanabel.local   | Code: ${studentSummaries[1].connectCode}

Khaled Mahmoud  (khaled.mahmoud@sanabel.local)
|-- Adam Khaled  : adam.khaled@sanabel.local  | Code: ${studentSummaries[2].connectCode}
+-- Noor Khaled  : noor.khaled@sanabel.local  | Code: ${studentSummaries[3].connectCode}

Adel Samir  (adel.samir@sanabel.local)
+-- Youssef Adel : youssef.adel@sanabel.local | Code: ${studentSummaries[4].connectCode}

===================================================
`;

    fs.writeFileSync(txtFilePath, content, "utf-8");
    console.log(`Credentials written to: ${txtFilePath}`);
    console.log("Seeding complete!");

    process.exit(0);
  } catch (error) {
    console.error("Error seeding test accounts:", error);
    process.exit(1);
  }
}

seedTestAccounts();
