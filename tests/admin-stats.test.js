const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Parent = require("../dist/models/parent.model").default;
const Organization = require("../dist/models/oraganization.model").default;
const Class = require("../dist/models/class.model").default;

const { getAdminStats } = require("../dist/controllers/adminController");

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

test("admin stats returns all dashboard counts from one call", async () => {
  User.count = async () => 120;
  Student.count = async () => 80;
  Teacher.count = async () => 15;
  Parent.count = async () => 20;
  Organization.count = async () => 3;
  Class.count = async () => 12;

  const res = makeResponse();
  await getAdminStats({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, {
    users: 120,
    students: 80,
    teachers: 15,
    parents: 20,
    organizations: 3,
    classes: 12,
  });
});

test("admin stats reports a 500 without leaking internals when counting fails", async () => {
  User.count = async () => {
    throw new Error("db gone");
  };

  const res = makeResponse();
  await getAdminStats({}, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "Internal Server Error");
});
