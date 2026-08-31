const test = require("node:test");
const assert = require("node:assert/strict");

const Student = require("../dist/models/student.model").default;
const Task = require("../dist/models/task.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const Teacher = require("../dist/models/teacher.model").default;

const { addPros: teacherAddPros } = require("../dist/controllers/teacherController");

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const fakeTransaction = { transaction: async (work) => work({ fake: "tx" }) };
Object.defineProperty(Student, "sequelize", {
  value: fakeTransaction,
  configurable: true,
});

test("teacher can award mission to an entire class of multiple students", async () => {
  const classStudentsMap = {
    101: { id: 101, xp: 10, snabelRed: 5, snabelBlue: 5, snabelYellow: 5, saveCalls: 0, async save() { this.saveCalls += 1; } },
    102: { id: 102, xp: 20, snabelRed: 5, snabelBlue: 5, snabelYellow: 5, saveCalls: 0, async save() { this.saveCalls += 1; } },
    103: { id: 103, xp: 30, snabelRed: 5, snabelBlue: 5, snabelYellow: 5, saveCalls: 0, async save() { this.saveCalls += 1; } },
    104: { id: 104, xp: 40, snabelRed: 5, snabelBlue: 5, snabelYellow: 5, saveCalls: 0, async save() { this.saveCalls += 1; } },
  };

  const task = {
    id: 12,
    title: "تنظيف الفصل والمساعدة",
    type: "التعاون",
    xp: 20,
    snabelRed: 5,
    snabelBlue: 5,
    snabelYellow: 5,
    taskCategory: { title: "التعاون" },
  };

  Teacher.findOne = async () => ({ id: 3, userId: 55, organizationId: 1 });
  // None of the students completed it today
  StudentTask.findAll = async () => [];
  
  let createdTasks = [];
  StudentTask.create = async (record) => {
    createdTasks.push(record);
    return record;
  };

  Task.findOne = async () => task;
  Challenge.findAll = async () => [];
  StudentChallenge.findAll = async () => [];
  Student.findOne = async ({ where }) => classStudentsMap[where.id] || null;

  const req = {
    user: { id: 55 },
    body: {
      taskId: 12,
      studentIds: [101, 102, 103, 104],
      time: "10:30",
      comment: "عمل جماعي رائع!",
    },
  };

  const res = makeResponse();
  await teacherAddPros(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message, "Student tasks recorded successfully");

  // Verified task creation for all 4 students in class
  assert.equal(createdTasks.length, 4);
  const createdIds = createdTasks.map((t) => t.studentId);
  assert.deepEqual(createdIds, [101, 102, 103, 104]);

  // Verified points incremented on every student in class
  assert.equal(classStudentsMap[101].xp, 30); // 10 + 20
  assert.equal(classStudentsMap[102].xp, 40); // 20 + 20
  assert.equal(classStudentsMap[103].xp, 50); // 30 + 20
  assert.equal(classStudentsMap[104].xp, 60); // 40 + 20
  assert.equal(classStudentsMap[101].snabelRed, 10);
});

test("class mission rejects if any student has already completed the task today", async () => {
  Teacher.findOne = async () => ({ id: 3, userId: 55 });
  // Student 103 already did this mission today
  StudentTask.findAll = async () => [{ studentId: 103, taskId: 12 }];

  const req = {
    user: { id: 55 },
    body: {
      taskId: 12,
      studentIds: [101, 102, 103, 104],
      time: "10:30",
    },
  };

  const res = makeResponse();
  await teacherAddPros(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Some students have already completed this task today");
  assert.deepEqual(res.body.existingStudents, [103]);
});
