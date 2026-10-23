const test = require("node:test");
const assert = require("node:assert/strict");

const ImportRun = require("../dist/models/import-run.model").default;
const {
  recordImportRun,
  IMPORT_RUN_GRANULARITY_NOTE,
} = require("../dist/helpers/importRunRecorder");

// Import telemetry, checked without a database by stubbing the model's writer.
//
// Two properties matter and neither is visible from the endpoint's response:
// the row must carry no spreadsheet contents, and a telemetry failure must not
// turn a completed import into an error for the operator.

const withStubbedCreate = async (callback) => {
  const original = ImportRun.create;
  const written = [];
  ImportRun.create = async (row) => {
    written.push(row);
    return row;
  };
  try {
    await callback(written);
  } finally {
    ImportRun.create = original;
  }
};

const requestFor = (overrides = {}) => ({
  user: { id: 7, email: "admin@example.invalid", role: "Admin" },
  adminOrganizationId: 11,
  ...overrides,
});

test("records counts, entity and the acting admin's resolved scope", async () => {
  await withStubbedCreate(async (written) => {
    await recordImportRun(requestFor(), {
      entityType: "students",
      succeeded: 48,
      failed: 2,
    });

    assert.equal(written.length, 1);
    assert.deepEqual(written[0], {
      adminUserId: 7,
      // Taken from `req.adminOrganizationId`, which checkAdmin resolves from
      // the Admins table — never from the request body or a query parameter.
      organizationId: 11,
      entityType: "students",
      totalRows: 50,
      succeeded: 48,
      failed: 2,
    });
  });
});

test("stores no row contents, file, address or password", async () => {
  await withStubbedCreate(async (written) => {
    await recordImportRun(requestFor(), {
      entityType: "teachers",
      succeeded: 1,
      failed: 0,
    });

    const row = written[0];
    assert.deepEqual(Object.keys(row).sort(), [
      "adminUserId",
      "entityType",
      "failed",
      "organizationId",
      "succeeded",
      "totalRows",
    ]);
    for (const forbidden of ["file", "rows", "email", "password", "payload", "contents"]) {
      assert.equal(row[forbidden], undefined, `${forbidden} must never be persisted`);
    }
  });
});

test("a Super Admin's run is recorded with no organization, not a guessed one", async () => {
  await withStubbedCreate(async (written) => {
    await recordImportRun(requestFor({ adminOrganizationId: null }), {
      entityType: "organizations",
      succeeded: 3,
      failed: 0,
    });
    assert.equal(written[0].organizationId, null);
  });

  await withStubbedCreate(async (written) => {
    // No checkAdmin ahead of the handler: scope is unknown, so it stays null
    // rather than being inferred.
    const request = requestFor();
    delete request.adminOrganizationId;
    await recordImportRun(request, { entityType: "grades", succeeded: 1, failed: 0 });
    assert.equal(written[0].organizationId, null);
  });
});

test("a telemetry failure never propagates to the import response", async () => {
  const original = ImportRun.create;
  ImportRun.create = async () => {
    throw new Error("ImportRuns table is unavailable");
  };
  try {
    // The imported records are already written by this point. Rejecting here
    // would report a successful import as a server error.
    await recordImportRun(requestFor(), {
      entityType: "classes",
      succeeded: 5,
      failed: 0,
    });
  } finally {
    ImportRun.create = original;
  }
});

test("an unauthenticated request records nothing", async () => {
  await withStubbedCreate(async (written) => {
    await recordImportRun({}, { entityType: "parents", succeeded: 1, failed: 0 });
    assert.equal(written.length, 0);
  });
});

test("negative and fractional counts are normalized", async () => {
  await withStubbedCreate(async (written) => {
    await recordImportRun(requestFor(), {
      entityType: "students",
      succeeded: -5,
      failed: 2.7,
    });
    assert.equal(written[0].succeeded, 0);
    assert.equal(written[0].failed, 2);
    assert.equal(written[0].totalRows, 2);
  });
});

test("the batch granularity is stated, not implied", () => {
  // Both analytics endpoints publish this note. A count of runs is a count of
  // submitted batches; presenting it as a count of uploaded files would
  // overstate import activity roughly fourfold for a 200-row spreadsheet.
  assert.match(IMPORT_RUN_GRANULARITY_NOTE, /batch/i);
  assert.match(IMPORT_RUN_GRANULARITY_NOTE, /not one uploaded file/i);
});
