// Phase 3C: the Teacher and Parent authenticated profile responses included the
// whole `Users` row, which carried the password hash, the OTP fields,
// tokenVersion, the push subscription and the stored location. These tests hold
// the allowlist in place and prove the account-age field the tutorial needs is
// the User row's own timestamp.
//
// Sentinel values below are synthetic and are never printed: assertions check
// key names recursively, so a failure does not dump the payload.
const test = require("node:test");
const assert = require("node:assert/strict");

const { teacherData } = require("../dist/controllers/teacherController");
const { parentData } = require("../dist/controllers/parentController");
const { studentData } = require("../dist/controllers/studentController");
const {
  PROFILE_FORBIDDEN_USER_ATTRIBUTES,
  accountCreatedAtIso,
} = require("../dist/helpers/accountIdentity");
const Teacher = require("../dist/models/teacher.model").default;
const Parent = require("../dist/models/parent.model").default;
const Student = require("../dist/models/student.model").default;
const Tree = require("../dist/models/tree.model").default;
const StudentTask = require("../dist/models/student-task.model").default;

const USER_CREATED_AT = new Date("2026-04-17T06:30:00.000Z");
const ROLE_ROW_CREATED_AT = new Date("2026-09-01T00:00:00.000Z");

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
  setHeader() {},
});

/** Every key present anywhere in the payload, at any depth. */
const collectKeys = (value, found = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, found));
    return found;
  }
  if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => {
      found.add(key);
      collectKeys(value[key], found);
    });
  }
  return found;
};

/**
 * What Sequelize would return without an attribute allowlist. The controller is
 * expected to ask for a narrower set; `requestedAttributes` records what it
 * actually asked for so the test can assert the projection, not just the stub.
 */
const buildUserRow = (over = {}) => ({
  id: 50,
  firstName: "Omar",
  lastName: "Ahmed",
  email: "omar@test.local",
  role: "Teacher",
  profileImg: { avatar: "omar" },
  gender: "male",
  dateOfBirth: "2000-01-01",
  isAccess: true,
  seenGuides: [],
  createdAt: USER_CREATED_AT,
  // The fields that must never leave the server.
  password: "SENTINEL_NOT_FOR_CLIENTS",
  resetOTP: "SENTINEL_NOT_FOR_CLIENTS",
  otpExpiry: new Date("2026-04-17T07:00:00.000Z"),
  otpVerified: true,
  otpAttempts: 0,
  otpLockedUntil: null,
  tokenVersion: 3,
  pushSubscription: { endpoint: "SENTINEL_NOT_FOR_CLIENTS" },
  location: { lat: 0, lng: 0 },
  ...over,
});

/** Applies the controller's own `attributes` list, the way Sequelize would. */
const project = (row, attributes) =>
  attributes
    ? Object.fromEntries(
        attributes.filter((key) => key in row).map((key) => [key, row[key]]),
      )
    : { ...row };

const stubRoleModel = (model, roleRow, capture) => {
  const original = model.findOne;
  model.findOne = async (options) => {
    const include = (options?.include ?? [])[0];
    capture.attributes = include?.attributes ? [...include.attributes] : null;
    const user = project(buildUserRow(), capture.attributes);
    const row = { ...roleRow, user, createdAt: ROLE_ROW_CREATED_AT };
    return { ...row, toJSON: () => ({ ...row }) };
  };
  return () => {
    model.findOne = original;
  };
};

const adultCases = [
  {
    name: "Teacher",
    handler: teacherData,
    model: Teacher,
    roleRow: { id: 9, userId: 50, organizationId: 11 },
  },
  {
    name: "Parent",
    handler: parentData,
    model: Parent,
    roleRow: { id: 4, userId: 50 },
  },
];

adultCases.forEach(({ name, handler, model, roleRow }) => {
  test(`${name} profile asks for an explicit attribute allowlist`, async () => {
    const capture = {};
    const restore = stubRoleModel(model, roleRow, capture);
    try {
      const res = makeResponse();
      await handler({ user: { id: 50, role: name } }, res);
      assert.equal(res.statusCode, 200);
      assert.ok(
        Array.isArray(capture.attributes),
        `${name} profile must not include the whole User model`,
      );
      PROFILE_FORBIDDEN_USER_ATTRIBUTES.forEach((field) => {
        assert.ok(
          !capture.attributes.includes(field),
          `${name} allowlist must not request ${field}`,
        );
      });
    } finally {
      restore();
    }
  });

  test(`${name} profile response carries no auth secret at any depth`, async () => {
    const capture = {};
    const restore = stubRoleModel(model, roleRow, capture);
    try {
      const res = makeResponse();
      await handler({ user: { id: 50, role: name } }, res);
      const keys = collectKeys(res.body);
      PROFILE_FORBIDDEN_USER_ATTRIBUTES.forEach((field) => {
        assert.ok(!keys.has(field), `${name} response exposed ${field}`);
      });
      // Belt and braces: the sentinel must not survive as a value either.
      assert.ok(!JSON.stringify(res.body).includes("SENTINEL_NOT_FOR_CLIENTS"));
    } finally {
      restore();
    }
  });

  test(`${name} profile keeps the fields the client actually reads`, async () => {
    const capture = {};
    const restore = stubRoleModel(model, roleRow, capture);
    try {
      const res = makeResponse();
      await handler({ user: { id: 50, role: name } }, res);
      const user = res.body.data.user;
      ["firstName", "lastName", "email", "profileImg", "gender", "dateOfBirth", "isAccess", "seenGuides"].forEach(
        (field) => assert.ok(field in user, `${name} response lost ${field}`),
      );
      assert.equal(res.body.data.id, roleRow.id);
      if (name === "Teacher") assert.equal(res.body.data.organizationId, 11);
    } finally {
      restore();
    }
  });

  test(`${name} accountCreatedAt is the User row timestamp, as ISO`, async () => {
    const capture = {};
    const restore = stubRoleModel(model, roleRow, capture);
    try {
      const res = makeResponse();
      await handler({ user: { id: 50, role: name } }, res);
      assert.equal(res.body.data.accountCreatedAt, USER_CREATED_AT.toISOString());
      assert.notEqual(
        res.body.data.accountCreatedAt,
        ROLE_ROW_CREATED_AT.toISOString(),
      );
    } finally {
      restore();
    }
  });

  test(`${name} accountCreatedAt is null when the User row has none`, async () => {
    const original = model.findOne;
    try {
      model.findOne = async () => {
        const row = { ...roleRow, user: { firstName: "Omar", email: "omar@test.local" } };
        return { ...row, toJSON: () => ({ ...row }) };
      };
      const res = makeResponse();
      await handler({ user: { id: 50, role: name } }, res);
      assert.equal(res.body.data.accountCreatedAt, null);
    } finally {
      model.findOne = original;
    }
  });
});

test("all three roles report account age in the same shape", async () => {
  const results = {};
  const restores = adultCases.map(({ name, model, roleRow }) => {
    const capture = {};
    const restore = stubRoleModel(model, roleRow, capture);
    return { name, restore };
  });
  try {
    for (const { name, handler } of adultCases) {
      const res = makeResponse();
      await handler({ user: { id: 50, role: name } }, res);
      results[name] = res.body.data.accountCreatedAt;
    }
  } finally {
    restores.forEach(({ restore }) => restore());
  }

  const originals = {
    student: Student.findOne,
    tree: Tree.findOne,
    tasks: StudentTask.findAll,
  };
  try {
    Student.findOne = async () => ({
      id: 26,
      userId: 50,
      organizationId: null,
      classId: null,
      treeProgress: 1,
      createdAt: ROLE_ROW_CREATED_AT,
      user: { firstName: "Omar", email: "omar@test.local", seenGuides: [], createdAt: USER_CREATED_AT },
    });
    Tree.findOne = async () => ({ id: 1, seeders: 1, water: 1, stage: 1, treeProgress: 1 });
    StudentTask.findAll = async () => [];
    const res = makeResponse();
    await studentData({ user: { id: 50, role: "Student" } }, res);
    results.Student = res.body.data.accountCreatedAt;
  } finally {
    Student.findOne = originals.student;
    Tree.findOne = originals.tree;
    StudentTask.findAll = originals.tasks;
  }

  const expected = USER_CREATED_AT.toISOString();
  assert.deepEqual(results, { Teacher: expected, Parent: expected, Student: expected });
});

test("the shared normaliser accepts Date, string and number, and rejects the rest", () => {
  assert.equal(accountCreatedAtIso(USER_CREATED_AT), USER_CREATED_AT.toISOString());
  assert.equal(accountCreatedAtIso("2026-04-17T06:30:00.000Z"), USER_CREATED_AT.toISOString());
  assert.equal(accountCreatedAtIso(USER_CREATED_AT.getTime()), USER_CREATED_AT.toISOString());
  [null, undefined, "", "not-a-date", new Date("nope"), {}, []].forEach((value) =>
    assert.equal(accountCreatedAtIso(value), null),
  );
});
