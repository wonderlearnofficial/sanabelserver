import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { sequelize, rundb } from "../config/db_connection";

async function createSchoolData() {
  try {
    await rundb();
    console.log("Connected to database & models initialized.");

    const models = {
      User: require("../models/user.model").default,
      Parent: require("../models/parent.model").default,
      Student: require("../models/student.model").default,
      Teacher: require("../models/teacher.model").default,
      Organization: require("../models/oraganization.model").default,
      Class: require("../models/class.model").default,
      Grade: require("../models/grade.model").default,
      Challenge: require("../models/challenge.model").default,
      StudentChallenge: require("../models/student-challenge.model").default,
    };

    const { User, Parent, Student, Teacher, Organization, Class, Grade, Challenge, StudentChallenge } = models;

    // 1. Ensure School / Organization
    let school = await Organization.findByPk(11);
    if (!school) {
      school = await Organization.findOne({ where: { name: "Nawah" } });
    }
    if (!school) {
      [school] = await Organization.findOrCreate({
        where: { name: "Nawah School" },
        defaults: {
          name: "Nawah School",
          type: "School",
        },
      });
    }
    console.log(`School Organization: ${school.name} (ID: ${school.id})`);

    // 2. Ensure Grade
    let grade = await Grade.findOne({
      where: { name: "Grade 4", organizationId: school.id },
    });
    if (!grade) {
      grade = await Grade.create({
        name: "Grade 4",
        organizationId: school.id,
      });
    }
    console.log(`Grade: ${grade.name} (ID: ${grade.id})`);

    // 3. School Admin Account
    const adminEmail = "admin.school@sanabel.local";
    const adminPasswordPlain = "Admin#Sanabel2026!";
    const hashedAdminPassword = bcrypt.hashSync(adminPasswordPlain, 10);

    let [adminUser] = await User.findOrCreate({
      where: { email: adminEmail },
      defaults: {
        firstName: "School",
        lastName: "Admin",
        email: adminEmail,
        password: hashedAdminPassword,
        role: "Admin",
        organizationId: school.id,
        isAccess: true,
        otpVerified: true,
      },
    });
    await adminUser.update({
      password: hashedAdminPassword,
      role: "Admin",
      organizationId: school.id,
      isAccess: true,
      otpVerified: true,
    });
    console.log(`Admin User: ${adminUser.email} (ID: ${adminUser.id}, Scoped Org: ${adminUser.organizationId})`);

    // 4. Teacher Account
    const teacherEmail = "teacher.sarah@sanabel.local";
    const teacherPasswordPlain = "Teacher#Sanabel2026!";
    const hashedTeacherPassword = bcrypt.hashSync(teacherPasswordPlain, 10);

    let [teacherUser] = await User.findOrCreate({
      where: { email: teacherEmail },
      defaults: {
        firstName: "Sarah",
        lastName: "Teacher",
        email: teacherEmail,
        password: hashedTeacherPassword,
        role: "Teacher",
        isAccess: true,
        otpVerified: true,
      },
    });
    await teacherUser.update({
      password: hashedTeacherPassword,
      role: "Teacher",
      isAccess: true,
      otpVerified: true,
    });

    let [teacherRecord] = await Teacher.findOrCreate({
      where: { userId: teacherUser.id },
      defaults: {
        userId: teacherUser.id,
        organizationId: school.id,
      },
    });
    await teacherRecord.update({ organizationId: school.id });
    console.log(`Teacher: ${teacherUser.email} (User ID: ${teacherUser.id}, Teacher ID: ${teacherRecord.id})`);

    // 5. Class (assigned to Teacher Sarah)
    let [cls] = await Class.findOrCreate({
      where: { classname: "Class 4A", organizationId: school.id },
      defaults: {
        classname: "Class 4A",
        organizationId: school.id,
        gradeId: grade.id,
        grade: grade.name,
        teacherId: teacherRecord.id,
      },
    });
    await cls.update({
      gradeId: grade.id,
      grade: grade.name,
      teacherId: teacherRecord.id,
    });
    console.log(`Class: ${cls.classname} (ID: ${cls.id}, Teacher ID: ${cls.teacherId})`);

    // 6. Parent Account
    const parentEmail = "parent.ahmed@sanabel.local";
    const parentPasswordPlain = "Parent#Sanabel2026!";
    const hashedParentPassword = bcrypt.hashSync(parentPasswordPlain, 10);

    let [parentUser] = await User.findOrCreate({
      where: { email: parentEmail },
      defaults: {
        firstName: "Ahmed",
        lastName: "Parent",
        email: parentEmail,
        password: hashedParentPassword,
        role: "Parent",
        isAccess: true,
        otpVerified: true,
      },
    });
    await parentUser.update({
      password: hashedParentPassword,
      role: "Parent",
      isAccess: true,
      otpVerified: true,
    });

    let [parentRecord] = await Parent.findOrCreate({
      where: { userId: parentUser.id },
      defaults: {
        userId: parentUser.id,
      },
    });
    console.log(`Parent: ${parentUser.email} (User ID: ${parentUser.id}, Parent ID: ${parentRecord.id})`);

    // Helper for unique connect code
    const generateUniqueConnectCode = async (): Promise<string> => {
      let code = "";
      let exists = true;
      while (exists) {
        code = Math.floor(10000 + Math.random() * 90000).toString();
        const existing = await Student.findOne({ where: { connectCode: code } });
        if (!existing) exists = false;
      }
      return code;
    };

    // 7. Student 1: Omar Ahmed
    const student1Email = "omar.ahmed@sanabel.local";
    const student1PasswordPlain = "Student#Sanabel2026!";
    const hashedStudent1Password = bcrypt.hashSync(student1PasswordPlain, 10);

    let [student1User] = await User.findOrCreate({
      where: { email: student1Email },
      defaults: {
        firstName: "Omar",
        lastName: "Ahmed",
        email: student1Email,
        password: hashedStudent1Password,
        role: "Student",
        isAccess: true,
        otpVerified: true,
      },
    });
    await student1User.update({
      password: hashedStudent1Password,
      role: "Student",
      isAccess: true,
      otpVerified: true,
    });

    let student1Record = await Student.findOne({ where: { userId: student1User.id } });
    if (!student1Record) {
      const code = await generateUniqueConnectCode();
      student1Record = await Student.create({
        userId: student1User.id,
        organizationId: school.id,
        classId: cls.id,
        ParentId: parentRecord.id,
        gradeId: grade.id,
        grade: grade.name,
        connectCode: code,
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
      await student1Record.update({
        organizationId: school.id,
        classId: cls.id,
        ParentId: parentRecord.id,
        gradeId: grade.id,
        grade: grade.name,
      });
    }
    console.log(`Student 1: ${student1User.email} (User ID: ${student1User.id}, Student ID: ${student1Record.id}, Connect Code: ${student1Record.connectCode})`);

    // 8. Student 2: Layla Ahmed
    const student2Email = "layla.ahmed@sanabel.local";
    const student2PasswordPlain = "Student#Sanabel2026!";
    const hashedStudent2Password = bcrypt.hashSync(student2PasswordPlain, 10);

    let [student2User] = await User.findOrCreate({
      where: { email: student2Email },
      defaults: {
        firstName: "Layla",
        lastName: "Ahmed",
        email: student2Email,
        password: hashedStudent2Password,
        role: "Student",
        isAccess: true,
        otpVerified: true,
      },
    });
    await student2User.update({
      password: hashedStudent2Password,
      role: "Student",
      isAccess: true,
      otpVerified: true,
    });

    let student2Record = await Student.findOne({ where: { userId: student2User.id } });
    if (!student2Record) {
      const code = await generateUniqueConnectCode();
      student2Record = await Student.create({
        userId: student2User.id,
        organizationId: school.id,
        classId: cls.id,
        ParentId: parentRecord.id,
        gradeId: grade.id,
        grade: grade.name,
        connectCode: code,
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
      await student2Record.update({
        organizationId: school.id,
        classId: cls.id,
        ParentId: parentRecord.id,
        gradeId: grade.id,
        grade: grade.name,
      });
    }
    console.log(`Student 2: ${student2User.email} (User ID: ${student2User.id}, Student ID: ${student2Record.id}, Connect Code: ${student2Record.connectCode})`);

    // 9. Solo User (independent Student with no organization, class, or parent)
    const soloUserEmail = "solo.user@sanabel.local";
    const soloUserPasswordPlain = "Solo#Sanabel2026!";
    const hashedSoloUserPassword = bcrypt.hashSync(soloUserPasswordPlain, 10);

    let [soloUser] = await User.findOrCreate({
      where: { email: soloUserEmail },
      defaults: {
        firstName: "Solo",
        lastName: "User",
        email: soloUserEmail,
        password: hashedSoloUserPassword,
        role: "Student",
        organizationId: null,
        isAccess: true,
        otpVerified: true,
      },
    });

    let soloStudentRecord = await Student.findOne({ where: { userId: soloUser.id } });
    if (!soloStudentRecord) {
      const code = await generateUniqueConnectCode();
      soloStudentRecord = await Student.create({
        userId: soloUser.id,
        organizationId: null,
        classId: null,
        ParentId: null,
        grade: "primary",
        connectCode: code,
        treeProgress: 1,
        medal: 1,
        xp: 0,
        water: 0,
        seeders: 0,
        snabelRed: 0,
        snabelBlue: 0,
        snabelYellow: 0,
      });
    }
    console.log(`Solo User: ${soloUser.email} (User ID: ${soloUser.id}, Student ID: ${soloStudentRecord.id}, Connect Code: ${soloStudentRecord.connectCode})`);

    // 10. Attach challenges if available
    const challenges = await Challenge.findAll();
    if (challenges.length > 0) {
      for (const st of [student1Record, student2Record, soloStudentRecord]) {
        for (const ch of challenges) {
          await StudentChallenge.findOrCreate({
            where: { studentId: st.id, challengeId: ch.id },
            defaults: {
              studentId: st.id,
              challengeId: ch.id,
              completionStatus: "NotCompleted",
            },
          });
        }
      }
      console.log(`Attached ${challenges.length} challenges to students.`);
    }

    // 11. Write root txt file
    const rootPath = path.resolve(__dirname, "../../../");
    const txtFilePath = path.join(rootPath, "sanabel school accounts.txt");

    const content = `=====================================================
            SANABEL SCHOOL & CONNECTED ACCOUNTS
=====================================================

1. SCHOOL DETAILS
   - School Name   : ${school.name}
   - School Org ID : ${school.id}
   - Grade         : ${grade.name} (ID: ${grade.id})
   - Class Name    : ${cls.classname} (ID: ${cls.id})

-----------------------------------------------------

2. SCHOOL ADMIN (Scoped to School)
   - Role          : Admin
   - Name          : ${adminUser.firstName} ${adminUser.lastName}
   - Email         : ${adminEmail}
   - Password      : ${adminPasswordPlain}
   - Organization  : ${school.name} (Org ID: ${school.id})
   - Description   : Manages all students, teachers, parents, and classes for this school.

-----------------------------------------------------

3. TEACHER (Assigned to ${cls.classname})
   - Role          : Teacher
   - Name          : ${teacherUser.firstName} ${teacherUser.lastName}
   - Email         : ${teacherEmail}
   - Password      : ${teacherPasswordPlain}
   - Teacher ID    : ${teacherRecord.id}
   - Assigned Class: ${cls.classname} (ID: ${cls.id})
   - Organization  : ${school.name} (Org ID: ${school.id})
   - Description   : Can assign missions, confirm completion, and view progress for students in ${cls.classname}.

-----------------------------------------------------

4. PARENT (Linked to Omar & Layla)
   - Role          : Parent
   - Name          : ${parentUser.firstName} ${parentUser.lastName}
   - Email         : ${parentEmail}
   - Password      : ${parentPasswordPlain}
   - Parent ID     : ${parentRecord.id}
   - Children      : Omar Ahmed & Layla Ahmed
   - Description   : Linked directly to both students to approve missions and monitor their progress.

-----------------------------------------------------

5. STUDENT 1 (Class 4A, Child of Parent Ahmed)
   - Role          : Student (School Student)
   - Name          : ${student1User.firstName} ${student1User.lastName}
   - Email         : ${student1Email}
   - Password      : ${student1PasswordPlain}
   - Student ID    : ${student1Record.id}
   - Connect Code  : ${student1Record.connectCode}
   - School Org ID : ${school.id}
   - Class         : ${cls.classname} (ID: ${cls.id})
   - Parent Link   : Parent ID ${parentRecord.id} (${parentUser.firstName} ${parentUser.lastName})

-----------------------------------------------------

6. STUDENT 2 (Class 4A, Child of Parent Ahmed)
   - Role          : Student (School Student)
   - Name          : ${student2User.firstName} ${student2User.lastName}
   - Email         : ${student2Email}
   - Password      : ${student2PasswordPlain}
   - Student ID    : ${student2Record.id}
   - Connect Code  : ${student2Record.connectCode}
   - School Org ID : ${school.id}
   - Class         : ${cls.classname} (ID: ${cls.id})
   - Parent Link   : Parent ID ${parentRecord.id} (${parentUser.firstName} ${parentUser.lastName})

-----------------------------------------------------

7. SOLO USER (Independent)
   - Role          : Student (Solo User)
   - Name          : ${soloUser.firstName} ${soloUser.lastName}
   - Email         : ${soloUserEmail}
   - Password      : ${soloUserPasswordPlain}
   - User ID       : ${soloUser.id}
   - Student ID    : ${soloStudentRecord.id}
   - Connect Code  : ${soloStudentRecord.connectCode}
   - School Org ID : None
   - Class         : None
   - Parent Link   : None
   - Description   : Independent Solo User with direct mission completion and no school relationships.

=====================================================
RELATIONSHIP GRAPH:
   School: ${school.name} (Org ID: ${school.id})
   ├── Admin: ${adminEmail} (organizationId: ${school.id})
   └── Class: ${cls.classname} (ID: ${cls.id})
       ├── Teacher: ${teacherEmail} (Assigned to Class)
       ├── Student 1: ${student1Email} ──┐ Both children of
       └── Student 2: ${student2Email} ──┴─ Parent: ${parentEmail}

   Independent:
   └── Solo User: ${soloUserEmail} (no organization, class, or parent)
=====================================================
Generated on: ${new Date().toISOString()}
`;

    fs.writeFileSync(txtFilePath, content, "utf-8");
    console.log(`Credentials saved successfully to: ${txtFilePath}`);

    process.exit(0);
  } catch (error) {
    console.error("Error creating school data:", error);
    process.exit(1);
  }
}

createSchoolData();
