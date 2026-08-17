const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getShopUnitCosts,
  computeSanabelCostPerColor,
  computeMissingSanabel,
  hasSufficientSanabel,
} = require("../dist/helpers/shopPricing");

const Student = require("../dist/models/student.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const Tree = require("../dist/models/tree.model").default;

const { buyWaterSeeder, growTheTree } = require("../dist/controllers/studentController");

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

// The controllers only use static finders plus instance save(); stubbing the
// model statics exercises the real endpoint logic without a database.
const fakeTransaction = { transaction: async (work) => work({ fake: "tx" }) };

const stubModels = ({ student, studentChallenges = [], trees = {}, maxTreeId = 48 }) => {
  Student.findOne = async () => student;
  Object.defineProperty(Student, "sequelize", {
    value: fakeTransaction,
    configurable: true,
  });
  StudentChallenge.findAll = async () => studentChallenges;
  Tree.findByPk = async (id) => trees[id] || null;
  Tree.max = async () => maxTreeId;
};

const makeStudent = (overrides = {}) => {
  const student = {
    id: 1,
    treeProgress: 1,
    snabelRed: 28,
    snabelBlue: 27,
    snabelYellow: 29,
    water: 0,
    seeders: 0,
    xp: 0,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
    ...overrides,
  };
  return student;
};

const makeChallengeRow = (challenge, pointOfStudent = 0) => ({
  pointOfStudent,
  completionStatus: "NotCompleted",
  challenge,
  saved: false,
  async save() {
    this.saved = true;
  },
});

test("shop pricing discounts only the first tree level and charges per color", () => {
  assert.deepEqual(getShopUnitCosts(1), { waterCost: 10, seederCost: 15 });
  assert.deepEqual(getShopUnitCosts(2), { waterCost: 20, seederCost: 30 });
  assert.equal(computeSanabelCostPerColor(1, 1, 1), 25);
  assert.equal(computeSanabelCostPerColor(2, 1, 5), 70);

  const missing = computeMissingSanabel(10, {
    snabelRed: 3,
    snabelBlue: 12,
    snabelYellow: 0,
  });
  assert.deepEqual(missing, { snabelRed: 7, snabelBlue: 0, snabelYellow: 10 });
  assert.equal(hasSufficientSanabel(10, { snabelRed: 10, snabelBlue: 10, snabelYellow: 10 }), true);
  assert.equal(hasSufficientSanabel(10, { snabelRed: 9, snabelBlue: 10, snabelYellow: 10 }), false);
});

test("buy rejects empty and invalid quantities before touching the database", async () => {
  let findOneCalls = 0;
  Student.findOne = async () => {
    findOneCalls += 1;
    return makeStudent();
  };

  const emptyRes = makeResponse();
  await buyWaterSeeder({ user: { id: 7 }, body: { water: 0, seeders: 0 } }, emptyRes);
  assert.equal(emptyRes.statusCode, 400);

  const negativeRes = makeResponse();
  await buyWaterSeeder({ user: { id: 7 }, body: { water: -1, seeders: 0 } }, negativeRes);
  assert.equal(negativeRes.statusCode, 400);

  assert.equal(findOneCalls, 0);
});

test("buy succeeds for a student with NO water/seeder challenge rows", async () => {
  // Regression for the production bug: the endpoint returned
  // 404 "No water challenge found" and blocked an affordable purchase,
  // which the client then displayed as "insufficient balance".
  const student = makeStudent(); // 28/27/29 coins, treeProgress 1
  stubModels({ student, studentChallenges: [] });

  const res = makeResponse();
  await buyWaterSeeder({ user: { id: 7 }, body: { water: 1, seeders: 0 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Updated successfully");
  assert.equal(student.snabelRed, 18);
  assert.equal(student.snabelBlue, 17);
  assert.equal(student.snabelYellow, 19);
  assert.equal(student.water, 1);
  assert.equal(student.saveCalls, 1);
});

test("insufficient balance returns a structured 400 with per-color missing amounts", async () => {
  const student = makeStudent({ snabelRed: 3, snabelBlue: 12, snabelYellow: 0 });
  stubModels({ student, studentChallenges: [] });

  const res = makeResponse();
  await buyWaterSeeder({ user: { id: 7 }, body: { water: 1, seeders: 0 } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Insufficient/);
  assert.deepEqual(res.body.missing, { snabelRed: 7, snabelBlue: 0, snabelYellow: 10 });
  assert.deepEqual(res.body.required, { snabelRed: 10, snabelBlue: 10, snabelYellow: 10 });
  // Nothing was charged on the failed purchase
  assert.equal(student.snabelRed, 3);
  assert.equal(student.saveCalls, 0);
});

test("water challenge progress counts the purchase exactly once", async () => {
  // Regression: the old handler added the amount to pointOfStudent and then
  // compared (pointOfStudent + amount) again, double-counting every purchase.
  const student = makeStudent();
  const row = makeChallengeRow({ point: 2, xp: 5, water: 3, seeder: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0 });
  stubModels({ student, studentChallenges: [row] });

  const res = makeResponse();
  await buyWaterSeeder({ user: { id: 7 }, body: { water: 1, seeders: 0 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(row.pointOfStudent, 1);
  assert.equal(row.completionStatus, "NotCompleted");
  assert.equal(row.saved, true);
  assert.equal(student.water, 1); // purchase only, no premature challenge reward
});

test("completing a water challenge grants its full reward bundle", async () => {
  const student = makeStudent();
  const row = makeChallengeRow(
    { point: 2, xp: 5, water: 3, seeder: 1, snabelRed: 2, snabelBlue: 2, snabelYellow: 2 },
    1, // one point away from completion
  );
  stubModels({ student, studentChallenges: [row] });

  const res = makeResponse();
  await buyWaterSeeder({ user: { id: 7 }, body: { water: 1, seeders: 0 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(row.completionStatus, "Completed");
  assert.equal(student.xp, 5);
  assert.equal(student.water, 1 + 3); // purchased 1 + challenge reward 3
  assert.equal(student.seeders, 1);
  assert.equal(student.snabelRed, 28 + 2 - 10);
});

test("grow tree rejects when resources are missing and charges nothing", async () => {
  const student = makeStudent({ water: 0, seeders: 5 });
  stubModels({
    student,
    trees: { 1: { id: 1, water: 1, seeders: 1, stage: 1 } },
  });

  const res = makeResponse();
  await growTheTree({ user: { id: 7 } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Not enough/);
  assert.equal(student.treeProgress, 1);
  assert.equal(student.saveCalls, 0);
});

test("grow tree persists stage-challenge completion before responding", async () => {
  // Regression: stage challenges were updated in an un-awaited forEach, so
  // the response could be sent before (or without) the updates being saved.
  const student = makeStudent({ water: 5, seeders: 5 });
  const stageRow = makeChallengeRow({
    category: "treestage",
    point: 1,
    xp: 10,
    snabelRed: 2,
    snabelBlue: 2,
    snabelYellow: 2,
  });
  stubModels({
    student,
    studentChallenges: [stageRow],
    trees: {
      1: { id: 1, water: 1, seeders: 1, stage: 0 },
      2: { id: 2, water: 2, seeders: 2, stage: 1 },
    },
  });

  const res = makeResponse();
  await growTheTree({ user: { id: 7 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(student.treeProgress, 2);
  assert.equal(student.water, 4);
  assert.equal(student.seeders, 4);
  // Saved (not just mutated) by the time the response exists
  assert.equal(stageRow.saved, true);
  assert.equal(stageRow.completionStatus, "Completed");
  assert.equal(stageRow.pointOfStudent, 1);
  assert.equal(student.xp, 10);
  assert.equal(student.snabelRed, 30);
});

test("grow tree rejects at the maximum tree level", async () => {
  const student = makeStudent({ treeProgress: 48, water: 99, seeders: 99 });
  stubModels({
    student,
    trees: { 48: { id: 48, water: 1, seeders: 1, stage: 47 } },
    maxTreeId: 48,
  });

  const res = makeResponse();
  await growTheTree({ user: { id: 7 } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /maximum/i);
  assert.equal(student.treeProgress, 48);
});
