const test = require("node:test");
const assert = require("node:assert/strict");

const Student = require("../dist/models/student.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;

const {
  ensureStudentChallenges,
  appearChallangesPrimaire,
  appearChallangesSecondaire,
} = require("../dist/controllers/studentController");

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

test("ensureStudentChallenges populates missing student challenge records", async () => {
  const mockChallenges = [
    { id: 1, title: "الصلاة", tasktype: "الصلاة" },
    { id: 2, title: "Tree Stage", tasktype: null },
  ];
  let createdRows = [];

  Challenge.findAll = async () => mockChallenges;
  StudentChallenge.findAll = async () => []; // No existing records
  StudentChallenge.bulkCreate = async (rows) => {
    createdRows = rows;
    return rows;
  };

  await ensureStudentChallenges(123);

  assert.equal(createdRows.length, 2);
  assert.equal(createdRows[0].studentId, 123);
  assert.equal(createdRows[0].challengeId, 1);
  assert.equal(createdRows[0].completionStatus, "NotCompleted");
  assert.equal(createdRows[1].challengeId, 2);
});

test("appearChallangesPrimaire ensures challenges and returns primary trophies", async () => {
  const student = { id: 10, userId: 99 };
  const mockPrimary = [
    {
      studentId: 10,
      challengeId: 1,
      completionStatus: "NotCompleted",
      pointOfStudent: 0,
      challenge: { id: 1, title: "الصلاة", tasktype: "الصلاة" },
    },
  ];

  Student.findOne = async () => student;
  Challenge.findAll = async () => [{ id: 1, title: "الصلاة", tasktype: "الصلاة" }];
  StudentChallenge.findAll = async () => mockPrimary;
  StudentChallenge.bulkCreate = async () => [];

  const req = { user: { id: 99 } };
  const res = makeResponse();

  await appearChallangesPrimaire(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].challenge.title, "الصلاة");
});

test("appearChallangesSecondaire ensures challenges and returns secondary trophies", async () => {
  const student = { id: 10, userId: 99 };
  const mockSecondary = [
    {
      studentId: 10,
      challengeId: 2,
      completionStatus: "NotCompleted",
      pointOfStudent: 0,
      challenge: { id: 2, title: "Tree Stage", tasktype: null },
    },
  ];

  Student.findOne = async () => student;
  Challenge.findAll = async () => [{ id: 2, title: "Tree Stage", tasktype: null }];
  StudentChallenge.findAll = async () => mockSecondary;
  StudentChallenge.bulkCreate = async () => [];

  const req = { user: { id: 99 } };
  const res = makeResponse();

  await appearChallangesSecondaire(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].challenge.title, "Tree Stage");
});
