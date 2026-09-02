const test = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "true";
process.env.DB_SYNC_ON_STARTUP = "false";
process.env.PUSH_NOTIFICATIONS_ENABLED = "false";

const { sequelize, rundb } = require("../dist/config/db_connection");
const { app } = require("../dist/index");
const { signAccessToken } = require("../dist/helpers/tokens");
const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Organization = require("../dist/models/oraganization.model").default;
const Grade = require("../dist/models/grade.model").default;
const Class = require("../dist/models/class.model").default;

const integrationTest = (name, fn) =>
  test(name, { skip: !RUN_INTEGRATION, concurrency: false }, fn);

let server;
let baseUrl;
let authHeader;
let fixture;

const created = {
  users: [],
  students: [],
  teachers: [],
  classes: [],
  grades: [],
  organizations: [],
};

const remember = (bucket, row) => {
  created[bucket].push(row.id);
  return row;
};

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: authHeader,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
  };
};

const resetStudent = async () => {
  // Static updates always issue SQL. Reusing an instance after an HTTP handler
  // changed the same row can otherwise make Sequelize skip a reset because its
  // local dirty-state no longer matches the database.
  await Student.update(
    {
      organizationId: fixture.orgA.id,
      classId: fixture.classA.id,
      gradeId: fixture.gradeA.id,
      grade: fixture.gradeA.name,
    },
    { where: { id: fixture.student.id } },
  );
  await User.update(
    {
      firstName: "Integration",
      lastName: "Student",
      email: fixture.studentEmail,
    },
    { where: { id: fixture.studentUser.id } },
  );
  await fixture.student.reload();
  await fixture.studentUser.reload();
};

const assertStudentState = async (organizationId, classId, context = "") => {
  await fixture.student.reload();
  assert.equal(
    fixture.student.organizationId,
    organizationId,
    `${context} organizationId`,
  );
  assert.equal(fixture.student.classId, classId, `${context} classId`);
};

test.before(async () => {
  if (!RUN_INTEGRATION) return;

  await rundb();
  await sequelize.authenticate();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prefix = `it_admin_${suffix}`;

  const orgA = remember(
    "organizations",
    await Organization.create({ name: `${prefix}_school_a`, type: "School" }),
  );
  const orgB = remember(
    "organizations",
    await Organization.create({ name: `${prefix}_school_b`, type: "School" }),
  );

  const gradeA = remember(
    "grades",
    await Grade.create({ name: `${prefix}_grade_a`, organizationId: orgA.id }),
  );
  const gradeB = remember(
    "grades",
    await Grade.create({ name: `${prefix}_grade_b`, organizationId: orgB.id }),
  );
  const globalGrade = remember(
    "grades",
    await Grade.create({ name: `${prefix}_grade_global`, organizationId: null }),
  );

  const classA = remember(
    "classes",
    await Class.create({
      classname: `${prefix}_class_a`,
      organizationId: orgA.id,
      gradeId: gradeA.id,
      grade: gradeA.name,
    }),
  );
  const classB = remember(
    "classes",
    await Class.create({
      classname: `${prefix}_class_b`,
      organizationId: orgB.id,
      gradeId: gradeB.id,
      grade: gradeB.name,
    }),
  );

  const adminEmail = `${prefix}_admin@example.com`;
  const admin = remember(
    "users",
    await User.create({
      firstName: "Integration",
      lastName: "Admin",
      email: adminEmail,
      password: "integration-only",
      role: "Admin",
      isAccess: true,
      otpVerified: true,
    }),
  );

  const studentEmail = `${prefix}_student@example.com`;
  const studentUser = remember(
    "users",
    await User.create({
      firstName: "Integration",
      lastName: "Student",
      email: studentEmail,
      password: "integration-only",
      role: "Student",
      isAccess: true,
      otpVerified: true,
    }),
  );
  const student = remember(
    "students",
    await Student.create({
      userId: studentUser.id,
      organizationId: orgA.id,
      classId: classA.id,
      gradeId: gradeA.id,
      grade: gradeA.name,
      connectCode: `IT${suffix.slice(-8)}`,
    }),
  );

  const teacherEmail = `${prefix}_teacher@example.com`;
  const teacherUser = remember(
    "users",
    await User.create({
      firstName: "Integration",
      lastName: "Teacher",
      email: teacherEmail,
      password: "integration-only",
      role: "Teacher",
      isAccess: true,
      otpVerified: true,
    }),
  );
  const teacher = remember(
    "teachers",
    await Teacher.create({ userId: teacherUser.id, organizationId: orgA.id }),
  );
  await classA.update({ teacherId: teacher.id });

  const duplicateEmail = `${prefix}_duplicate@example.com`;
  remember(
    "users",
    await User.create({
      firstName: "Existing",
      lastName: "User",
      email: duplicateEmail,
      password: "integration-only",
      role: "Parent",
      isAccess: true,
      otpVerified: true,
    }),
  );

  fixture = {
    prefix,
    admin,
    orgA,
    orgB,
    gradeA,
    gradeB,
    globalGrade,
    classA,
    classB,
    student,
    studentUser,
    studentEmail,
    teacher,
    teacherUser,
    duplicateEmail,
    nonexistentId: 2_147_000_000,
  };

  const token = signAccessToken({
    id: admin.id,
    email: admin.email,
    role: "Admin",
  });
  authHeader = `Bearer ${token}`;

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!RUN_INTEGRATION) return;

  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  // Delete only records created by this test, in foreign-key-safe order.
  if (created.students.length) {
    await Student.destroy({ where: { id: created.students } });
  }
  if (created.classes.length) {
    await Class.destroy({ where: { id: created.classes } });
  }
  if (created.teachers.length) {
    await Teacher.destroy({ where: { id: created.teachers } });
  }
  if (created.grades.length) {
    await Grade.destroy({ where: { id: created.grades } });
  }
  if (created.users.length) {
    await User.destroy({ where: { id: created.users } });
  }
  if (created.organizations.length) {
    await Organization.destroy({ where: { id: created.organizations } });
  }
  await sequelize.close();
});

const relationshipCases = () => [
  {
    name: "null clears class",
    body: { classId: null },
    status: 200,
    organizationId: () => fixture.orgA.id,
    classId: () => null,
  },
  {
    name: "empty string clears class",
    body: { classId: "" },
    status: 200,
    organizationId: () => fixture.orgA.id,
    classId: () => null,
  },
  {
    name: "zero class is rejected",
    body: { classId: 0 },
    status: 400,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
  {
    name: "missing relationship values leave them unchanged",
    body: { lastName: "Student" },
    status: 200,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
  {
    name: "valid class in current organization is accepted",
    body: () => ({ classId: fixture.classA.id }),
    status: 200,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
  {
    name: "nonexistent class is rejected",
    body: () => ({ classId: fixture.nonexistentId }),
    status: 422,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
  {
    name: "class belonging to another organization is rejected",
    body: () => ({ classId: fixture.classB.id }),
    status: 422,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
  {
    name: "null clears organization and class",
    body: { organizationId: null },
    status: 200,
    organizationId: () => null,
    classId: () => null,
  },
  {
    name: "empty string clears organization and class",
    body: { organizationId: "" },
    status: 200,
    organizationId: () => null,
    classId: () => null,
  },
  {
    name: "zero organization is rejected",
    body: { organizationId: 0 },
    status: 400,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
  {
    name: "valid organization and matching class are accepted",
    body: () => ({
      organizationId: fixture.orgB.id,
      classId: fixture.classB.id,
    }),
    status: 200,
    organizationId: () => fixture.orgB.id,
    classId: () => fixture.classB.id,
  },
  {
    name: "nonexistent organization is rejected",
    body: () => ({ organizationId: fixture.nonexistentId }),
    status: 422,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
  {
    name: "organization/class mismatch is rejected",
    body: () => ({
      organizationId: fixture.orgB.id,
      classId: fixture.classA.id,
    }),
    status: 422,
    organizationId: () => fixture.orgA.id,
    classId: () => fixture.classA.id,
  },
];

integrationTest(
  "ERR-004 PATCH /admin/students/:id validates relationship IDs without FK 500s",
  async () => {
    for (const scenario of relationshipCases()) {
      await resetStudent();
      const body =
        typeof scenario.body === "function" ? scenario.body() : scenario.body;
      const response = await request(
        "PATCH",
        `/admin/students/${fixture.student.id}`,
        body,
      );
      assert.equal(
        response.status,
        scenario.status,
        `${scenario.name}: ${JSON.stringify(response.body)}`,
      );
      assert.notEqual(response.status, 500, scenario.name);
      await assertStudentState(
        scenario.organizationId(),
        scenario.classId(),
        scenario.name,
      );
    }
  },
);

integrationTest(
  "ERR-004 PATCH /admin/users/:id validates relationship IDs without FK 500s",
  async () => {
    for (const scenario of relationshipCases()) {
      await resetStudent();
      const body =
        typeof scenario.body === "function" ? scenario.body() : scenario.body;
      const response = await request(
        "PATCH",
        `/admin/users/${fixture.studentUser.id}`,
        body,
      );
      assert.equal(
        response.status,
        scenario.status,
        `${scenario.name}: ${JSON.stringify(response.body)}`,
      );
      assert.notEqual(response.status, 500, scenario.name);
      await assertStudentState(
        scenario.organizationId(),
        scenario.classId(),
        scenario.name,
      );
    }
  },
);

integrationTest(
  "bulk imported student can be repaired with grade/class from Admin edit",
  async () => {
    // This is the incomplete state created by the historical importer: the
    // account and Student profile exist, but Grade/Class are absent.
    await Student.update(
      {
        organizationId: fixture.orgA.id,
        classId: null,
        gradeId: null,
        grade: null,
      },
      { where: { id: fixture.student.id } },
    );

    const repair = await request(
      "PATCH",
      `/admin/users/${fixture.studentUser.id}`,
      {
        organizationId: fixture.orgA.id,
        gradeId: fixture.gradeA.id,
        classId: fixture.classA.id,
      },
    );
    assert.equal(repair.status, 200, JSON.stringify(repair.body));

    await fixture.student.reload();
    assert.equal(fixture.student.organizationId, fixture.orgA.id);
    assert.equal(fixture.student.gradeId, fixture.gradeA.id);
    assert.equal(fixture.student.grade, fixture.gradeA.name);
    assert.equal(fixture.student.classId, fixture.classA.id);

    const refetched = await request(
      "GET",
      `/admin/students/${fixture.student.id}`,
    );
    assert.equal(refetched.status, 200, JSON.stringify(refetched.body));
    assert.equal(refetched.body.data.student.gradeId, fixture.gradeA.id);
    assert.equal(refetched.body.data.student.classId, fixture.classA.id);
  },
);

integrationTest(
  "ERR-005 GET /admin/teachers returns empty and populated results with associations",
  async () => {
    const empty = await request(
      "GET",
      `/admin/teachers?page=1&limit=25&organizationId=${fixture.orgB.id}`,
    );
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.total, 0);
    assert.deepEqual(empty.body.data, []);

    const populated = await request(
      "GET",
      `/admin/teachers?page=1&limit=25&search=${encodeURIComponent(fixture.teacherUser.email)}`,
    );
    assert.equal(populated.status, 200, JSON.stringify(populated.body));
    const matchingTeacher = populated.body.data.find(
      (row) => row.user.email === fixture.teacherUser.email,
    );
    assert.ok(matchingTeacher, JSON.stringify(populated.body));
    assert.equal(matchingTeacher.organization.id, fixture.orgA.id);
    assert.ok(
      matchingTeacher.Classes.some(
        (row) => row.id === fixture.classA.id && row.GradeEntity.id === fixture.gradeA.id,
      ),
    );
  },
);

integrationTest(
  "ERR-005 GET /admin/grades returns empty, global, and organization grades",
  async () => {
    const empty = await request(
      "GET",
      `/admin/grades?limit=1000&search=${encodeURIComponent(`${fixture.prefix}_missing`)}`,
    );
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.total, 0);
    assert.deepEqual(empty.body.data, []);

    const populated = await request(
      "GET",
      `/admin/grades?limit=1000&search=${encodeURIComponent(fixture.prefix)}`,
    );
    assert.equal(populated.status, 200, JSON.stringify(populated.body));
    assert.equal(populated.body.total, 3);

    const global = populated.body.data.find(
      (row) => row.id === fixture.globalGrade.id,
    );
    const schoolGrade = populated.body.data.find(
      (row) => row.id === fixture.gradeA.id,
    );
    assert.equal(global.Organization, null);
    assert.equal(schoolGrade.Organization.id, fixture.orgA.id);
  },
);

integrationTest(
  "ERR-006 duplicate emails are 409 and transactions roll back relationship changes",
  async () => {
    await resetStudent();
    const studentPatch = await request(
      "PATCH",
      `/admin/students/${fixture.student.id}`,
      {
        email: fixture.duplicateEmail,
        organizationId: fixture.orgB.id,
        classId: fixture.classB.id,
      },
    );
    assert.equal(studentPatch.status, 409, JSON.stringify(studentPatch.body));
    await assertStudentState(fixture.orgA.id, fixture.classA.id);
    await fixture.studentUser.reload();
    assert.equal(fixture.studentUser.email, fixture.studentEmail);

    const userPatch = await request(
      "PATCH",
      `/admin/users/${fixture.studentUser.id}`,
      {
        email: fixture.duplicateEmail,
        organizationId: fixture.orgB.id,
        classId: fixture.classB.id,
      },
    );
    assert.equal(userPatch.status, 409, JSON.stringify(userPatch.body));
    await assertStudentState(fixture.orgA.id, fixture.classA.id);
    await fixture.studentUser.reload();
    assert.equal(fixture.studentUser.email, fixture.studentEmail);

    const create = await request("POST", "/admin/users", {
      firstName: "Duplicate",
      lastName: "Email",
      email: fixture.duplicateEmail,
      role: "Parent",
    });
    assert.equal(create.status, 409, JSON.stringify(create.body));
  },
);

integrationTest(
  "ERR-006 duplicate grade is 409 and invalid grade organization is 400",
  async () => {
    const duplicate = await request("POST", "/admin/grades", {
      name: fixture.gradeA.name.toUpperCase(),
      organizationId: fixture.orgA.id,
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

    const badOrganization = await request("POST", "/admin/grades", {
      name: `${fixture.prefix}_bad_org_grade`,
      organizationId: fixture.nonexistentId,
    });
    assert.equal(badOrganization.status, 400, JSON.stringify(badOrganization.body));
    assert.notEqual(badOrganization.status, 500);
  },
);
