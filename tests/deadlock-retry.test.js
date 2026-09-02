const test = require("node:test");
const assert = require("node:assert/strict");

const { withDeadlockRetry, utcGameplayDate } = require("../dist/services/studentTodoService");
const Student = require("../dist/models/student.model").default;
const MissionApprovalRequest = require("../dist/models/mission-approval-request.model").default;
const { getMyRequestStatus } = require("../dist/controllers/missionController");

// Sequelize v7 wraps the driver error as `cause`, so that is what the helper
// must read. Anything else must be treated as a real failure, not a blip.
const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), {
  name: "SequelizeDatabaseError",
  cause: { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" },
});

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("withDeadlockRetry runs the work once when nothing goes wrong", async () => {
  let calls = 0;
  const result = await withDeadlockRetry(async () => { calls += 1; return "committed"; });
  assert.equal(result, "committed");
  assert.equal(calls, 1);
});

test("withDeadlockRetry retries a deadlock and returns the later attempt's result", async () => {
  let calls = 0;
  const result = await withDeadlockRetry(async () => {
    calls += 1;
    if (calls === 1) throw deadlock();
    return "committed on retry";
  });
  assert.equal(result, "committed on retry");
  assert.equal(calls, 2);
});

test("withDeadlockRetry gives every attempt a fresh transaction and rolls the failed one back first", async () => {
  // Stands in for sequelize's managed transaction: commit on resolve,
  // rollback on reject, and a brand-new transaction object per call.
  const events = [];
  const transactions = [];
  const managedTransaction = async (work) => {
    const transaction = { id: transactions.length + 1, finished: null };
    transactions.push(transaction);
    events.push(`begin:${transaction.id}`);
    try {
      const value = await work(transaction);
      transaction.finished = "commit";
      events.push(`commit:${transaction.id}`);
      return value;
    } catch (error) {
      transaction.finished = "rollback";
      events.push(`rollback:${transaction.id}`);
      throw error;
    }
  };

  let attempt = 0;
  const result = await withDeadlockRetry(() => managedTransaction(async () => {
    attempt += 1;
    if (attempt === 1) throw deadlock();
    return "ok";
  }));

  assert.equal(result, "ok");
  assert.equal(transactions.length, 2, "each attempt opens its own transaction");
  assert.notEqual(transactions[0], transactions[1], "no transaction object is reused across attempts");
  assert.equal(transactions[0].finished, "rollback");
  assert.equal(transactions[1].finished, "commit");
  assert.deepEqual(events, ["begin:1", "rollback:1", "begin:2", "commit:2"],
    "the failed transaction is fully rolled back before the retry begins");
});

test("withDeadlockRetry does not retry an error that is not a deadlock", async () => {
  for (const error of [
    Object.assign(new Error("duplicate"), { name: "SequelizeUniqueConstraintError" }),
    Object.assign(new Error("timeout"), { name: "SequelizeDatabaseError", cause: { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 } }),
    Object.assign(new Error("bad column"), { name: "SequelizeDatabaseError", cause: { code: "ER_BAD_FIELD_ERROR" } }),
    new Error("Student not found"),
  ]) {
    let calls = 0;
    await assert.rejects(
      () => withDeadlockRetry(async () => { calls += 1; throw error; }),
      (thrown) => thrown === error,
    );
    assert.equal(calls, 1, `${error.name}: business and non-transient failures must surface on the first attempt`);
  }
});

test("withDeadlockRetry never retries a resolved authorization or validation outcome", async () => {
  // Controllers return these as values, never as throws, so the helper must
  // hand them straight back without a second attempt.
  for (const outcome of [{ status: 400 }, { status: 403 }, { status: 404 }, { status: 409 }]) {
    let calls = 0;
    const result = await withDeadlockRetry(async () => { calls += 1; return outcome; });
    assert.deepEqual(result, outcome);
    assert.equal(calls, 1);
  }
});

test("withDeadlockRetry stays bounded and rethrows the original error", async () => {
  let calls = 0;
  const error = deadlock();
  await assert.rejects(
    () => withDeadlockRetry(async () => { calls += 1; throw error; }),
    (thrown) => thrown === error,
  );
  assert.equal(calls, 3, "three attempts total, then give up so the caller can return its own clean 500");

  calls = 0;
  await assert.rejects(() => withDeadlockRetry(async () => { calls += 1; throw deadlock(); }, 2));
  assert.equal(calls, 2, "the bound is configurable and still enforced");
});

test("getMyRequestStatus reads the requested day and never lets one day bleed into another", async () => {
  const originalStudentFindOne = Student.findOne;
  const originalRequestFindAll = MissionApprovalRequest.findAll;
  const today = utcGameplayDate();
  const past = "2026-08-30";
  const rowsByDate = {
    [past]: [{ id: 1, missionDate: past, status: "pending" }],
    [today]: [{ id: 2, missionDate: today, status: "approved" }],
  };
  const seen = [];
  Student.findOne = async () => ({ id: 26, classId: 10 });
  MissionApprovalRequest.findAll = async (options) => {
    seen.push(options.where);
    return rowsByDate[options.where.missionDate] || [];
  };

  try {
    const call = async (query) => {
      const response = makeResponse();
      await getMyRequestStatus({ query, user: { id: 53 } }, response);
      return response;
    };

    const explicitPast = await call({ taskId: "7", missionDate: past });
    assert.equal(explicitPast.statusCode, 200);
    assert.equal(explicitPast.body.data.id, 1, "an explicit past date returns that day's request");
    assert.equal(explicitPast.body.missionDate, past);
    assert.deepEqual(seen.at(-1), { studentId: 26, missionId: 7, missionDate: past });

    const explicitToday = await call({ taskId: "7", missionDate: today });
    assert.equal(explicitToday.body.data.id, 2, "an explicit today returns today's request, not the older one");

    const implicit = await call({ taskId: "7" });
    assert.equal(implicit.body.data.id, 2, "omitting missionDate falls back to the server's canonical today");
    assert.deepEqual(seen.at(-1), { studentId: 26, missionId: 7, missionDate: today });
    assert.equal(implicit.body.serverToday, today);

    const emptyDay = await call({ taskId: "7", missionDate: "2026-08-29" });
    assert.equal(emptyDay.body.data, null, "a day with no request is null, never another day's row");
  } finally {
    Student.findOne = originalStudentFindOne;
    MissionApprovalRequest.findAll = originalRequestFindAll;
  }
});

test("getMyRequestStatus rejects a bad taskId, a malformed date, and a future date", async () => {
  const originalStudentFindOne = Student.findOne;
  const originalRequestFindAll = MissionApprovalRequest.findAll;
  let queried = 0;
  Student.findOne = async () => ({ id: 26, classId: 10 });
  MissionApprovalRequest.findAll = async () => { queried += 1; return []; };

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  try {
    const call = async (query) => {
      const response = makeResponse();
      await getMyRequestStatus({ query, user: { id: 53 } }, response);
      return response;
    };

    for (const query of [{}, { taskId: "abc" }, { taskId: "0" }, { taskId: "-3" }, { taskId: "1.5" }]) {
      const response = await call(query);
      assert.equal(response.statusCode, 400, JSON.stringify(query));
      assert.match(response.body.message, /taskId/);
    }

    for (const missionDate of ["2026-02-30", "30-08-2026", "2026-8-3", "", "not-a-date", "2026-08-30T00:00:00Z"]) {
      const response = await call({ taskId: "7", missionDate });
      assert.equal(response.statusCode, 400, missionDate);
      assert.match(response.body.message, /Invalid date/);
    }

    const future = await call({ taskId: "7", missionDate: tomorrow.toISOString().slice(0, 10) });
    assert.equal(future.statusCode, 400, "a device set a day ahead cannot read tomorrow");
    assert.match(future.body.message, /Future mission dates/);

    assert.equal(queried, 0, "no rejected request ever reaches the database");
  } finally {
    Student.findOne = originalStudentFindOne;
    MissionApprovalRequest.findAll = originalRequestFindAll;
  }
});
