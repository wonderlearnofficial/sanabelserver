import dotenv from "dotenv";
dotenv.config();

// STRICT SAFETY GUARD: Never run against anything other than localhost!
if (
  process.env.MYSQL_DB_HOST !== "localhost" &&
  process.env.MYSQL_DB_HOST !== "127.0.0.1"
) {
  console.error(
    "FATAL SAFETY VIOLATION: seed-load-fixtures MUST ONLY RUN AGAINST LOCALHOST!"
  );
  process.exit(1);
}

import bcrypt from "bcryptjs";
import { sequelize, rundb } from "../config/db_connection";
import User, { UserRole } from "../models/user.model";
import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Admin from "../models/admin.model";
import Organization from "../models/oraganization.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import Task from "../models/task.model";
import StudentTask from "../models/student-task.model";
import StudentTodoDay from "../models/student-todo-day.model";
import StudentTodoItem from "../models/student-todo-item.model";
import StudentTodoSource from "../models/student-todo-source.model";
import MissionApprovalRequest from "../models/mission-approval-request.model";

const SHARED_PASSWORD = "LoadTest#Sanabel2026!";
const BATCH_SIZE = 1000;

export async function seedLoadFixtures() {
  console.log("=== SEEDING HIGH-SCALE SYNTHETIC LOAD TEST FIXTURES ===");
  console.log(`Database: ${process.env.MYSQL_DB_NAME} @ ${process.env.MYSQL_DB_HOST}`);

  await rundb();

  // Pre-compute ONE bcrypt hash to avoid 5,000 synchronous bcrypt hashes during seed
  console.log("Pre-computing shared password hash...");
  const hashedPassword = await bcrypt.hash(SHARED_PASSWORD, 10);

  // 1. Organizations (5 test schools)
  console.log("Seeding test organizations...");
  const orgs: Organization[] = [];
  for (let i = 1; i <= 5; i++) {
    const [org] = await Organization.findOrCreate({
      where: { name: `Load Test School ${i}` },
      defaults: { name: `Load Test School ${i}`, type: "School" },
    });
    orgs.push(org);
  }

  // 2. Grades
  console.log("Resolving grades...");
  const grades = await Grade.findAll({ where: { organizationId: null } });
  const gradeIds = grades.map((g) => g.id);
  if (gradeIds.length === 0) {
    const defaultGrade = await Grade.create({ name: "primary", organizationId: null });
    gradeIds.push(defaultGrade.id);
  }

  // 3. Classes (30 classes: 6 per school)
  console.log("Seeding test classes...");
  const classes: Class[] = [];
  for (const org of orgs) {
    for (let c = 1; c <= 6; c++) {
      const [cls] = await Class.findOrCreate({
        where: { classname: `Class-${org.id}-${c}`, organizationId: org.id },
        defaults: {
          classname: `Class-${org.id}-${c}`,
          organizationId: org.id,
          gradeId: gradeIds[(c - 1) % gradeIds.length],
        },
      });
      classes.push(cls);
    }
  }

  // 4. Super Admins (2)
  console.log("Seeding test super admins...");
  for (let i = 1; i <= 2; i++) {
    const email = `load_superadmin_${i}@sanabel.local`;
    let user = await User.findOne({ where: { email } });
    if (!user) {
      user = await User.create({
        firstName: "Super",
        lastName: `Admin${i}`,
        email,
        password: hashedPassword,
        role: UserRole.Admin,
        isAccess: true,
        otpVerified: true,
        organizationId: null,
      });
    }
    await Admin.findOrCreate({
      where: { userId: user.id },
      defaults: { userId: user.id, organizationId: null },
    });
  }

  // 5. School Admins (10: 2 per school)
  console.log("Seeding test school admins...");
  for (const org of orgs) {
    for (let a = 1; a <= 2; a++) {
      const email = `load_schooladmin_${org.id}_${a}@sanabel.local`;
      let user = await User.findOne({ where: { email } });
      if (!user) {
        user = await User.create({
          firstName: `AdminOrg${org.id}`,
          lastName: `User${a}`,
          email,
          password: hashedPassword,
          role: UserRole.Admin,
          isAccess: true,
          otpVerified: true,
          organizationId: org.id,
        });
      }
      await Admin.findOrCreate({
        where: { userId: user.id },
        defaults: { userId: user.id, organizationId: org.id },
      });
    }
  }

  // 6. Teachers (200: 40 per school)
  console.log("Seeding test teachers (200)...");
  const teacherUsersData: any[] = [];
  const existingTeacherCount = await User.count({ where: { email: { [require("sequelize").Op.like]: "load_teacher_%" } } });
  if (existingTeacherCount < 200) {
    for (let i = existingTeacherCount + 1; i <= 200; i++) {
      const org = orgs[(i - 1) % orgs.length];
      teacherUsersData.push({
        firstName: "Teacher",
        lastName: `Test${i}`,
        email: `load_teacher_${i}@sanabel.local`,
        password: hashedPassword,
        role: UserRole.Teacher,
        isAccess: true,
        otpVerified: true,
        organizationId: org.id,
      });
    }
    const createdTeachers = await User.bulkCreate(teacherUsersData);
    const teacherProfiles = createdTeachers.map((u) => ({
      userId: u.id,
      organizationId: u.organizationId,
    }));
    await Teacher.bulkCreate(teacherProfiles, { ignoreDuplicates: true });
  }

  // 7. Parents (200)
  console.log("Seeding test parents (200)...");
  const parentUsersData: any[] = [];
  const existingParentCount = await User.count({ where: { email: { [require("sequelize").Op.like]: "load_parent_%" } } });
  if (existingParentCount < 200) {
    for (let i = existingParentCount + 1; i <= 200; i++) {
      const org = orgs[(i - 1) % orgs.length];
      parentUsersData.push({
        firstName: "Parent",
        lastName: `Test${i}`,
        email: `load_parent_${i}@sanabel.local`,
        password: hashedPassword,
        role: UserRole.Parent,
        isAccess: true,
        otpVerified: true,
        organizationId: org.id,
      });
    }
    const createdParents = await User.bulkCreate(parentUsersData);
    const parentProfiles = createdParents.map((u) => ({
      userId: u.id,
      organizationId: u.organizationId,
    }));
    await Parent.bulkCreate(parentProfiles, { ignoreDuplicates: true });
  }

  // 8. Students (5,000 synthetic students: 4,000 School + 1,000 Solo)
  console.log("Checking student fixture count...");
  const currentStudentCount = await User.count({
    where: { email: { [require("sequelize").Op.like]: "load_student_%" } },
  });

  if (currentStudentCount < 5000) {
    const toCreate = 5000 - currentStudentCount;
    console.log(`Seeding ${toCreate} synthetic students in batches...`);
    const allParents = await Parent.findAll({ attributes: ["id"], limit: 200 });
    const parentIds = allParents.map((p) => p.id);

    for (let batchStart = 0; batchStart < toCreate; batchStart += BATCH_SIZE) {
      const chunk = Math.min(BATCH_SIZE, toCreate - batchStart);
      const userChunk: any[] = [];
      const startIndex = currentStudentCount + batchStart + 1;

      for (let i = 0; i < chunk; i++) {
        const studentIndex = startIndex + i;
        const isSolo = studentIndex > 4000; // First 4,000 are School, last 1,000 are Solo
        const org = isSolo ? null : orgs[(studentIndex - 1) % orgs.length];

        userChunk.push({
          firstName: isSolo ? "Solo" : "Student",
          lastName: `Test${studentIndex}`,
          email: `load_student_${studentIndex}@sanabel.local`,
          password: hashedPassword,
          role: UserRole.Student,
          isAccess: true,
          otpVerified: true,
          organizationId: org ? org.id : null,
        });
      }

      const createdUsers = await User.bulkCreate(userChunk);

      const studentChunk = createdUsers.map((user, idx) => {
        const studentIndex = startIndex + idx;
        const isSolo = studentIndex > 4000;
        const org = isSolo ? null : orgs[(studentIndex - 1) % orgs.length];
        // Pick a class from the student's own school; a class in another school
        // breaks organization isolation and leaderboard scoping.
        const orgClasses = org ? classes.filter((c: any) => c.organizationId === org.id) : [];
        const assignedClass = orgClasses.length ? orgClasses[Math.floor((studentIndex - 1) / orgs.length) % orgClasses.length] : null;
        const assignedParentId = parentIds.length > 0 ? parentIds[(studentIndex - 1) % parentIds.length] : null;

        return {
          userId: user.id,
          organizationId: org ? org.id : null,
          classId: assignedClass ? assignedClass.id : null,
          gradeId: assignedClass ? assignedClass.gradeId : null,
          ParentId: isSolo ? null : assignedParentId,
          treeProgress: 1,
          connectCode: `L${studentIndex.toString().padStart(6, "0")}`,
          xp: Math.floor(Math.random() * 2500),
          snabelRed: Math.floor(Math.random() * 50) + 10,
          snabelBlue: Math.floor(Math.random() * 50) + 10,
          snabelYellow: Math.floor(Math.random() * 50) + 10,
          water: Math.floor(Math.random() * 10),
          seeders: Math.floor(Math.random() * 10),
        };
      });

      await Student.bulkCreate(studentChunk);
      console.log(`  Seeded students ${startIndex}..${startIndex + chunk - 1}`);
    }
  }

  // 9. Tasks & Historical Completions
  console.log("Seeding task completions (StudentTasks)...");
  const existingCompletions = await StudentTask.count();
  const availableTasks = await Task.findAll({ attributes: ["id"], limit: 50 });
  const taskIds = availableTasks.map((t) => t.id);

  if (existingCompletions < 10000 && taskIds.length > 0) {
    const students = await Student.findAll({ attributes: ["id"], limit: 2000 });
    const completionChunk: any[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (let i = 0; i < 10000; i++) {
      const student = students[i % students.length];
      const taskId = taskIds[i % taskIds.length];
      const daysAgo = i % 28;
      const d = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

      completionChunk.push({
        studentId: student.id,
        taskId: taskId,
        date: d,
        completionStatus: "Completed",
        completionSource: i % 2 === 0 ? "approval_teacher" : "approval_parent",
        completionKey: `load_${student.id}_${taskId}_${d}_${i}`,
        createdAt: new Date(Date.now() - daysAgo * 86400000),
        updatedAt: new Date(Date.now() - daysAgo * 86400000),
      });

      if (completionChunk.length >= BATCH_SIZE) {
        await StudentTask.bulkCreate(completionChunk, { ignoreDuplicates: true });
        completionChunk.length = 0;
      }
    }
    if (completionChunk.length > 0) {
      await StudentTask.bulkCreate(completionChunk, { ignoreDuplicates: true });
    }
    console.log("  Seeded 10,000 StudentTasks");
  }

  // 10. Student Todo Days and Items
  console.log("Seeding Student To-Do Days and Items...");
  const existingTodoCount = await StudentTodoItem.count();
  if (existingTodoCount < 3000 && taskIds.length > 0) {
    const students = await Student.findAll({ attributes: ["id"], limit: 1000 });
    const today = new Date().toISOString().slice(0, 10);

    const todoItemsData: any[] = [];
    for (let s = 0; s < students.length; s++) {
      const student = students[s];
      for (let t = 0; t < 3; t++) {
        const taskId = taskIds[(s + t) % taskIds.length];
        todoItemsData.push({
          studentId: student.id,
          taskId: taskId,
          status: t === 0 ? "completed" : "todo",
          todoDate: today,
          isActive: true,
          activeKey: `load_${student.id}_${taskId}`,
        });
      }
    }
    const createdItems = await StudentTodoItem.bulkCreate(todoItemsData, { ignoreDuplicates: true });
    console.log(`  Seeded ${createdItems.length} StudentTodoItems`);

    const todoDaysData: any[] = createdItems.map((item) => ({
      studentTodoItemId: item.id,
      studentId: item.studentId,
      taskId: item.taskId,
      missionDate: today,
      status: item.status === "completed" ? "completed" : "todo",
    }));
    await StudentTodoDay.bulkCreate(todoDaysData, { ignoreDuplicates: true });
    console.log(`  Seeded ${todoDaysData.length} StudentTodoDays`);
  }

  // 11. Mission Approval Requests
  console.log("Seeding MissionApprovalRequests...");
  const existingApprovals = await MissionApprovalRequest.count();
  if (existingApprovals < 2000 && taskIds.length > 0) {
    const students = await Student.findAll({ attributes: ["id"], limit: 1000 });
    const teachers = await Teacher.findAll({ attributes: ["userId"], limit: 50 });
    const today = new Date().toISOString().slice(0, 10);
    const approvalChunk: any[] = [];

    for (let i = 0; i < 2000; i++) {
      const student = students[i % students.length];
      const teacher: any = teachers[i % teachers.length];
      const taskId = taskIds[i % taskIds.length];

      approvalChunk.push({
        studentId: student.id,
        missionId: taskId,
        missionDate: today,
        status: i % 3 === 0 && teacher ? "approved" : i % 3 === 1 ? "pending" : "denied",
        teacherIds: teacher ? [teacher.userId] : [],
        parentIds: [],
        approvedById: i % 3 === 0 && teacher ? teacher.userId : null,
        approvedByType: i % 3 === 0 ? "teacher" : null,
        approvedAt: i % 3 === 0 && teacher ? new Date() : null,
      });

      if (approvalChunk.length >= BATCH_SIZE) {
        await MissionApprovalRequest.bulkCreate(approvalChunk, { ignoreDuplicates: true });
        approvalChunk.length = 0;
      }
    }
    if (approvalChunk.length > 0) {
      await MissionApprovalRequest.bulkCreate(approvalChunk, { ignoreDuplicates: true });
    }
    console.log("  Seeded 2,000 MissionApprovalRequests");
  }

  // Summary counts
  const [counts] = await sequelize.query(`
    SELECT 'Users' as tbl, count(*) as count FROM Users UNION ALL
    SELECT 'Students', count(*) FROM Students UNION ALL
    SELECT 'Teachers', count(*) FROM Teachers UNION ALL
    SELECT 'Parents', count(*) FROM Parents UNION ALL
    SELECT 'Admins', count(*) FROM Admins UNION ALL
    SELECT 'Organizations', count(*) FROM Organizations UNION ALL
    SELECT 'Classes', count(*) FROM Classes UNION ALL
    SELECT 'StudentTasks', count(*) FROM StudentTasks UNION ALL
    SELECT 'StudentTodoDays', count(*) FROM StudentTodoDays UNION ALL
    SELECT 'StudentTodoItems', count(*) FROM StudentTodoItems UNION ALL
    SELECT 'MissionApprovalRequests', count(*) FROM MissionApprovalRequests
  `);

  console.log("=== SYNTHETIC FIXTURES COMPLETE ===");
  console.log(counts);
}

if (require.main === module) {
  seedLoadFixtures()
    .then(() => {
      console.log("Seeding finished successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}
