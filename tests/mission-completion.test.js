const test = require("node:test");
const assert = require("node:assert/strict");

const Student = require("../dist/models/student.model").default;
const Task = require("../dist/models/task.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const Teacher = require("../dist/models/teacher.model").default;

const { completeMissionForStudent } = require("../dist/helpers/completeMission");
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

test("completeMissionForStudent grants XP, Sanabel points, and progresses challenges", async () => {
  const student = {
    id: 10,
    xp: 50,
    snabelRed: 10,
    snabelBlue: 20,
    snabelYellow: 15,
    saved: false,
    async save() {
      this.saved = true;
    },
  };

  const task = {
    id: 5,
    title: "مساعدة الوالدين",
    type: "الأسرة والمجتمع",
    xp: 25,
    snabelRed: 5,
    snabelBlue: 10,
    snabelYellow: 0,
    taskCategory: { title: "الأسرة والمجتمع" },
  };

  const challengeXp = {
    id: 101,
    title: "بطل النقاط",
    category: "xp",
    point: 100,
    xp: 50,
    snabelRed: 10,
    snabelBlue: 10,
    snabelYellow: 10,
  };

  const studentChallenge = {
    studentId: 10,
    challengeId: 101,
    pointOfStudent: 80,
    completionStatus: "NotCompleted",
    challenge: challengeXp,
    saved: false,
    async save() {
      this.saved = true;
    },
  };

  let studentTaskCreated = null;
  Student.findByPk = async () => student;
  Task.findOne = async () => task;
  StudentTask.create = async (data) => {
    studentTaskCreated = data;
    return data;
  };
  Challenge.findAll = async () => [challengeXp];
  StudentChallenge.findAll = async () => [studentChallenge];

  await completeMissionForStudent({
    studentId: 10,
    taskId: 5,
    missionDate: "2026-08-21",
    approverId: 2,
    approverType: "teacher",
    transaction: {},
  });

  // Task rewards applied
  // 50 + 25 (task) + 50 (challenge completed because 80 + 25 >= 100) = 125
  assert.equal(student.xp, 125);
  assert.equal(student.snabelRed, 25); // 10 + 5 (task) + 10 (challenge)
  assert.equal(student.snabelBlue, 40); // 20 + 10 (task) + 10 (challenge)
  assert.equal(student.snabelYellow, 25); // 15 + 0 (task) + 10 (challenge)

  // Challenge completed
  assert.equal(studentChallenge.pointOfStudent, 105);
  assert.equal(studentChallenge.completionStatus, "Completed");

  // StudentTask created with teacher approver metadata
  assert.equal(studentTaskCreated.studentId, 10);
  assert.equal(studentTaskCreated.taskId, 5);
  assert.equal(studentTaskCreated.teacherId, 2);
  assert.equal(studentTaskCreated.completionStatus, "Completed");
});

test("teacher addPros validates parameters and prevents duplicates on the same day", async () => {
  Teacher.findOne = async () => ({ id: 1, userId: 99 });
  StudentTask.findAll = async () => [{ studentId: 10, taskId: 5 }];

  const req = {
    user: { id: 99 },
    body: {
      taskId: 5,
      studentIds: [10],
      time: "12:00",
    },
  };

  const res = makeResponse();
  await teacherAddPros(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Some students have already completed this task today");
  assert.deepEqual(res.body.existingStudents, [10]);
});
