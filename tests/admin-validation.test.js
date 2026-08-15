const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createGrade,
  updateGrade,
  updateStudent,
  updateUser,
} = require("../dist/controllers/adminController");

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

test("admin student update rejects classId zero before database writes", async () => {
  const res = makeResponse();
  await updateStudent(
    { params: { studentId: "30" }, body: { classId: 0 } },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /classId/);
});

test("admin user update rejects organizationId zero before database writes", async () => {
  const res = makeResponse();
  await updateUser(
    { params: { userId: "54" }, body: { organizationId: "0" } },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /organizationId/);
});

test("grade writes reject invalid relationship and route IDs", async () => {
  const createResponse = makeResponse();
  await createGrade(
    { body: { name: "primary", organizationId: 0 } },
    createResponse,
  );
  assert.equal(createResponse.statusCode, 400);
  assert.match(createResponse.body.message, /organizationId/);

  const updateResponse = makeResponse();
  await updateGrade(
    { params: { gradeId: "0" }, body: { name: "primary" } },
    updateResponse,
  );
  assert.equal(updateResponse.statusCode, 400);
  assert.match(updateResponse.body.message, /grade id/i);
});
