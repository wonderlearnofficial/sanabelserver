const test = require("node:test");
const assert = require("node:assert/strict");

// Reorder and retarget are the two new student mutations. Both must be pure
// with respect to the reward engine: nothing here may create a StudentTask,
// change a To-Do status, or resolve an approval request.

const Student = require("../dist/models/student.model").default;
const Class = require("../dist/models/class.model").default;
const StudentTodoItem = require("../dist/models/student-todo-item.model").default;
const StudentTodoSource = require("../dist/models/student-todo-source.model").default;
const StudentTask = require("../dist/models/student-task.model").default;
const MissionApprovalRequest = require("../dist/models/mission-approval-request.model").default;
const MissionApprovalRequestEvent = require("../dist/models/mission-approval-request-event.model").default;
const { reorderMyTodo } = require("../dist/controllers/todoController");
const { retargetApproval } = require("../dist/controllers/missionController");
const { addOrAssignTodo } = require("../dist/services/studentTodoService");

const tx = { LOCK: { UPDATE: "UPDATE" } };
Object.defineProperty(Student, "sequelize", {
  value: { transaction: async (work) => work(tx) },
  configurable: true,
});

const makeResponse = () => ({
  statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const asStudent = (body, params = {}) => ({ user: { id: 9, role: "Student" }, body, params });

test.beforeEach(() => {
  Student.findOne = async () => ({ id: 5, userId: 9, classId: 4, ParentId: 7, organizationId: 3 });
  StudentTodoItem.update = async () => [1];
  MissionApprovalRequestEvent.create = async (values) => values;
});

// ---------------------------------------------------------------- reorder

test("reorder: persists positions for the student's own actionable items", async () => {
  const updates = [];
  StudentTodoItem.findAll = async ({ where }) => {
    assert.equal(where.studentId, 5, "ownership must come from the session student");
    return [{ id: 41, status: "todo" }, { id: 55, status: "pending_approval" }];
  };
  StudentTodoItem.update = async (values, options) => { updates.push({ ...values, id: options.where.id }); return [1]; };

  const res = makeResponse();
  await reorderMyTodo(asStudent({ items: [{ id: 41, position: 0 }, { id: 55, position: 1 }] }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(updates, [{ position: 0, id: 41 }, { position: 1, id: 55 }]);
});

test("reorder: repeating the same payload is idempotent", async () => {
  StudentTodoItem.findAll = async () => [{ id: 41, status: "todo" }];
  let calls = 0;
  StudentTodoItem.update = async () => { calls += 1; return [1]; };
  for (let i = 0; i < 2; i++) {
    const res = makeResponse();
    await reorderMyTodo(asStudent({ items: [{ id: 41, position: 0 }] }), res);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(calls, 2, "same writes, same result — no side effects accumulate");
});

test("reorder: a foreign item id is refused with 403", async () => {
  // The DB returns only the rows that really belong to this student.
  StudentTodoItem.findAll = async () => [{ id: 41, status: "todo" }];
  const res = makeResponse();
  await reorderMyTodo(asStudent({ items: [{ id: 41, position: 0 }, { id: 999, position: 1 }] }), res);
  assert.equal(res.statusCode, 403);
});

test("reorder: duplicate ids are refused with 400", async () => {
  const res = makeResponse();
  await reorderMyTodo(asStudent({ items: [{ id: 41, position: 0 }, { id: 41, position: 1 }] }), res);
  assert.equal(res.statusCode, 400);
});

test("reorder: completed history cannot be reordered", async () => {
  StudentTodoItem.findAll = async () => [{ id: 41, status: "completed" }];
  const res = makeResponse();
  await reorderMyTodo(asStudent({ items: [{ id: 41, position: 0 }] }), res);
  assert.equal(res.statusCode, 409);
});

test("reorder: empty and malformed payloads are refused with 400", async () => {
  for (const items of [[], [{ id: "abc", position: 0 }], [{ id: 41, position: -2 }], undefined]) {
    const res = makeResponse();
    await reorderMyTodo(asStudent({ items }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(items));
  }
});

// ---------------------------------------------------------------- placement

test("new To-Do items land on top of the manual order", async () => {
  StudentTask.findOne = async () => null;
  StudentTodoItem.findOne = async () => null;
  StudentTodoItem.min = async () => -3;
  let created = null;
  StudentTodoItem.create = async (values) => { created = values; return { id: 77, ...values }; };
  StudentTodoSource.findOrCreate = async () => [{}, true];

  await addOrAssignTodo({ studentId: 5, taskId: 3, sourceType: "student", sourceId: 5, transaction: tx });
  assert.equal(created.position, -4, "one above the current topmost item");

  StudentTodoItem.min = async () => null;
  await addOrAssignTodo({ studentId: 5, taskId: 4, sourceType: "student", sourceId: 5, transaction: tx });
  assert.equal(created.position, 0, "first ever item starts at 0");
});

// ---------------------------------------------------------------- retarget

const pendingRequest = () => {
  const request = {
    id: 12, studentId: 5, status: "pending", parentIds: [], teacherIds: [2],
    updatedWith: null,
    async update(values) { this.updatedWith = values; Object.assign(this, values); return this; },
  };
  MissionApprovalRequest.findOne = async ({ where }) => (where.id === 12 && where.studentId === 5 ? request : null);
  return request;
};

test("retarget: pending request moves to another eligible approver and records an event", async () => {
  const request = pendingRequest();
  Class.findByPk = async () => ({ id: 4, teacherId: 2 });
  const events = [];
  MissionApprovalRequestEvent.create = async (values) => { events.push(values); return values; };

  const res = makeResponse();
  await retargetApproval(asStudent({ approverType: "parent", approverId: 7 }, { requestId: "12" }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(request.updatedWith, { parentIds: [7], teacherIds: [] });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "RETARGETED");
  assert.deepEqual(events[0].targetApproverIds, { parentIds: [7], teacherIds: [] });
  assert.equal(res.body.data.status, "pending", "retarget never resolves the request");
  assert.equal(res.body.rewardsGranted, undefined, "retarget never rewards");
});

test("retarget: an approver who is not currently eligible is refused with 403", async () => {
  pendingRequest();
  Class.findByPk = async () => ({ id: 4, teacherId: 2 });
  const res = makeResponse();
  // Teacher 99 does not teach this student's class.
  await retargetApproval(asStudent({ approverType: "teacher", approverId: 99 }, { requestId: "12" }), res);
  assert.equal(res.statusCode, 403);
});

test("retarget: another student's request is invisible (404)", async () => {
  pendingRequest();
  Class.findByPk = async () => ({ id: 4, teacherId: 2 });
  const res = makeResponse();
  await retargetApproval(asStudent({ approverType: "teacher", approverId: 2 }, { requestId: "999" }), res);
  assert.equal(res.statusCode, 404);
});

test("retarget: a resolved request is refused with 409 and history stays intact", async () => {
  const request = pendingRequest();
  request.status = "approved";
  Class.findByPk = async () => ({ id: 4, teacherId: 2 });
  const res = makeResponse();
  await retargetApproval(asStudent({ approverType: "teacher", approverId: 2 }, { requestId: "12" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(request.updatedWith, null, "resolved request must not be touched");
});

test("retarget: malformed approver input is refused with 400", async () => {
  pendingRequest();
  for (const body of [{ approverType: "admin", approverId: 2 }, { approverType: "teacher", approverId: "abc" }, {}]) {
    const res = makeResponse();
    await retargetApproval(asStudent(body, { requestId: "12" }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});
