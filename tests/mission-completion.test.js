const test = require("node:test");
const assert = require("node:assert/strict");

const Student = require("../dist/models/student.model").default;
const Task = require("../dist/models/task.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Class = require("../dist/models/class.model").default;
const StudentTodoItem = require("../dist/models/student-todo-item.model").default;
const MissionApprovalRequest = require("../dist/models/mission-approval-request.model").default;

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
  Student.findOne = async () => student;
  StudentTask.findOne = async () => null;
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

test("teacher addPros treats an already-completed student as an idempotent batch result", async () => {
  const student = { id: 10, classId: 4, organizationId: 3 };
  Teacher.findOne = async () => ({ id: 1, userId: 99, organizationId: 3 });
  Task.findOne = async () => ({ id: 5 });
  Student.findOne = async () => student;
  Class.findOne = async () => ({ id: 4, teacherId: 1, organizationId: 3 });
  StudentTask.findOne = async () => ({ id: 77, studentId: 10, taskId: 5, completionSource: "teacher_direct" });
  StudentTodoItem.findOne = async () => ({ id: 88 });
  MissionApprovalRequest.update = async () => [0];
  Object.defineProperty(Student, "sequelize", {
    value: { transaction: async (work) => work({ LOCK: { UPDATE: "UPDATE" } }) },
    configurable: true,
  });

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

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.already_completed, 1);
  assert.equal(res.body.results[0].rewardsGranted, false);
});
