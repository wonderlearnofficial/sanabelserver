import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { sequelize, rundb } from "../config/db_connection";

async function seed() {
  try {
    await sequelize.authenticate();
    const models = {
      User: require("../models/user.model").default,
      Parent: require("../models/parent.model").default,
      Student: require("../models/student.model").default,
      Teacher: require("../models/teacher.model").default,
      Organization: require("../models/oraganization.model").default,
      Representative: require("../models/representative.model").default,
      Donation: require("../models/donation.model").default,
      Challenge: require("../models/challenge.model").default,
      Reward: require("../models/reward.model").default,
      TaskCategory: require("../models/task-category.model").default,
      Task: require("../models/task.model").default,
      Class: require("../models/class.model").default,
      Grade: require("../models/grade.model").default,
      StudentTask: require("../models/student-task.model").default,
      StudentChallenge: require("../models/student-challenge.model").default,
      Groupe: require("../models/groupe.model").default,
      Tree: require("../models/tree.model").default,
      MissionApprovalRequest: require("../models/mission-approval-request.model").default,
    };
    
    Object.values(models).forEach((model: any) => {
      model.initModel(sequelize);
    });

    Object.values(models).forEach((model: any) => {
      if (typeof model.associate === "function") {
        model.associate(models);
      }
    });

    const { Organization, Grade, Class, User, Teacher, Student, Challenge, MissionApprovalRequest, StudentChallenge } = models;
    console.log("Connected to DB.");

    // 1. Organization
    let org = await Organization.findOne();
    if (!org) {
      org = await Organization.create({ name: "Test School" });
    }
    const orgId = org.id;

    // 2. Grades
    const gradeNames = ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"];
    const grades = [];
    for (const name of gradeNames) {
      let g = await Grade.findOne({ where: { name } });
      if (!g) g = await Grade.create({ name });
      grades.push(g);
    }

    // 3. Classes
    const classNames = ["Class 1 Red", "Class 2 Blue", "Class 3 Green", "Class 4 Yellow", "Class 5 Purple"];
    const classes = [];
    for (let i = 0; i < 5; i++) {
      let c = await Class.findOne({ where: { classname: classNames[i] } });
      if (!c) {
        c = await Class.create({
          classname: classNames[i],
          gradeId: grades[i].id,
          grade: grades[i].name,
          organizationId: orgId,
        });
      }
      classes.push(c);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash("123456", 10);

    // 4. Teachers
    console.log("Creating Teachers...");
    const teacherData = [
      { firstName: "Teacher", lastName: "One", email: "t1@test.com", classes: [classes[0].id, classes[1].id] },
      { firstName: "Teacher", lastName: "Two", email: "t2@test.com", classes: [classes[2].id, classes[3].id, classes[4].id] }
    ];

    const teachers = [];
    for (const data of teacherData) {
      let user = await User.findOne({ where: { email: data.email } });
      if (!user) {
        user = await User.create({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          password: hashedPassword,
          role: "Teacher",
        });
      }
      let teacher = await Teacher.findOne({ where: { userId: user.id } });
      if (!teacher) {
        teacher = await Teacher.create({ userId: user.id, organizationId: orgId });
      }
      // Assign classes
      for (const classId of data.classes) {
        const c = await Class.findByPk(classId);
        if (c) await c.update({ teacherId: teacher.id });
      }
      teachers.push(teacher);
    }

    // 5. Students
    console.log("Creating Students...");
    const challenges = await Challenge.findAll();

    const generateUniqueConnectCode = () => {
      return Math.random().toString(36).substring(2, 12).toUpperCase();
    };

    let studentIndex = 1;
    for (let cIdx = 0; cIdx < 5; cIdx++) {
      for (let sIdx = 0; sIdx < 4; sIdx++) {
        const email = `s${studentIndex}@test.com`;
        let user = await User.findOne({ where: { email } });
        if (!user) {
          user = await User.create({
            firstName: `Student`,
            lastName: `${studentIndex}`,
            email,
            password: hashedPassword,
            role: "Student",
            isAccess: true,
            otpVerified: true,
          });
        }

        let student = await Student.findOne({ where: { userId: user.id } });
        if (!student) {
          const connectCode = generateUniqueConnectCode();
          student = await Student.create({
            userId: user.id,
            organizationId: orgId,
            classId: classes[cIdx].id,
            gradeId: grades[cIdx].id,
            grade: grades[cIdx].name,
            treeProgress: 1,
            connectCode,
          });

          if (challenges.length > 0) {
            await StudentChallenge.bulkCreate(
              challenges.map((challenge: any) => ({
                studentId: student!.id,
                challengeId: challenge.id,
                completionStatus: "NotCompleted",
              }))
            );
          }
        }
        
        // Add a mission approval request to test teacher view
        if (challenges.length > 0 && student) {
          const chId = challenges[0].id;
          const reqExists = await MissionApprovalRequest.findOne({ where: { studentId: student.id, missionId: chId } });
          if (!reqExists) {
            await MissionApprovalRequest.create({
              studentId: student.id,
              missionId: chId,
              status: "Pending",
              missionDate: new Date(),
            });
          }
        }
        
        studentIndex++;
      }
    }

    console.log("Seeding complete! Passwords are '123456'");
    console.log("Teacher 1: t1@test.com (Classes 1, 2)");
    console.log("Teacher 2: t2@test.com (Classes 3, 4, 5)");
    console.log("Students: s1@test.com through s20@test.com");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding data:", error);
    process.exit(1);
  }
}

seed();
