const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const XLSX = require("xlsx");
const multer = require("multer");

// Bulk Excel/CSV import hardening, checked without a database: file parsing
// and validation in the upload middleware, the shared per-row contract, and
// the student/parent/grade importers with stubbed models.

const {
  processStudentMiddleware,
  readUploadedWorkbook,
  parseRowSheet,
} = require("../dist/middleware/processExcelfile");
const { describeUploadError } = require("../dist/middleware/uploadExcel");
const { getImportField, hasImportColumn } = require("../dist/helpers/importFieldLookup");
const {
  importRowNumber,
  isValidImportEmail,
  parseImportDate,
  describeRowError,
} = require("../dist/helpers/importRow");
const { generateImportPassword } = require("../dist/helpers/generatePassword");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Organization = require("../dist/models/oraganization.model").default;
const Grade = require("../dist/models/grade.model").default;
const Class = require("../dist/models/class.model").default;
const ImportRun = require("../dist/models/import-run.model").default;
const { addStudent } = require("../dist/controllers/studentController");
const { importGrades } = require("../dist/controllers/adminController");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sanabel-import-test-"));
let fileNo = 0;
const upload = (name, buffer) => {
  const filePath = path.join(tmp, `${(fileNo += 1)}-${name}`);
  fs.writeFileSync(filePath, buffer);
  return { path: filePath, originalname: name };
};
const xlsxBuffer = (sheets, bookType = "xlsx") => {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType });
};
const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const runMiddleware = (file) => {
  const req = { file };
  const res = makeResponse();
  let nextCalled = false;
  processStudentMiddleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
};
const rowsOf = (req) => Object.values(req.processedData)[0];

// ------------------------------------------------------------ file handling

test("UTF-8 CSV without a BOM keeps Arabic text intact", () => {
  const csv = "firstName,lastName\nمُحَمَّد,العَلي\n";
  const { req, nextCalled } = runMiddleware(upload("a.csv", Buffer.from(csv, "utf8")));
  assert.equal(nextCalled, true);
  assert.equal(rowsOf(req)[0].firstName, "مُحَمَّد");
  assert.equal(rowsOf(req)[0].lastName, "العَلي");
});

test("UTF-8 BOM does not stick to the first header", () => {
  const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("firstName,email\nA,a@x.com\n")]);
  const { req } = runMiddleware(upload("bom.csv", buffer));
  assert.deepEqual(req.importHeaders, ["firstName", "email"]);
  assert.equal(rowsOf(req)[0].firstName, "A");
});

test("CSV formulas are never evaluated and their commas do not shift columns", () => {
  const csv = 'firstName,lastName\n"=HYPERLINK(""http://evil.example/x"",""click"")",B\n+cmd,C\n';
  const { req } = runMiddleware(upload("f.csv", Buffer.from(csv)));
  const rows = rowsOf(req);
  assert.equal(rows[0].firstName, '=HYPERLINK("http://evil.example/x","click")');
  assert.equal(rows[0].lastName, "B");
  assert.equal(rows[1].firstName, "+cmd");
});

test("blank rows are skipped and row numbers stay aligned with the sheet", () => {
  const buffer = xlsxBuffer({ S: [["firstName"], ["A"], [], [], ["B"], []] });
  const { req } = runMiddleware(upload("blank.xlsx", buffer));
  const rows = rowsOf(req);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r, i) => importRowNumber(r, i)), [2, 5]);
  // The row number is hidden: it never leaks into the row's own keys.
  assert.deepEqual(Object.keys(rows[0]), ["firstName"]);
});

test("only the first worksheet is imported", () => {
  const buffer = xlsxBuffer({ First: [["firstName"], ["A"]], Second: [["firstName"], ["B"]] });
  const { req } = runMiddleware(upload("two.xlsx", buffer));
  assert.deepEqual(Object.keys(req.processedData), ["First"]);
  assert.equal(rowsOf(req).length, 1);
});

test("an Excel date cell becomes its calendar date, not the serial", () => {
  const ws = XLSX.utils.aoa_to_sheet([["DateOfBirth"], [{ t: "n", v: 42077, z: "yyyy-mm-dd" }]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  const parsed = parseRowSheet(readUploadedWorkbook(upload("d.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))));
  assert.equal(parsed.rows[0].DateOfBirth, "2015-03-14");
});

test("empty, fake and corrupt files are refused with 400 and a specific code", () => {
  const cases = [
    ["empty.xlsx", Buffer.alloc(0), "FILE_EMPTY"],
    ["empty.csv", Buffer.alloc(0), "FILE_EMPTY"],
    ["renamed.xlsx", Buffer.from("%PDF-1.4\n1 0 obj\n%%EOF\n"), "INVALID_SPREADSHEET"],
    ["zipjunk.xlsx", Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(512, 0x41)]), "INVALID_SPREADSHEET"],
    ["binary.csv", Buffer.from([0x00, 0x01, 0x02, 0x03]), "INVALID_SPREADSHEET"],
  ];
  const good = xlsxBuffer({ S: [["firstName"], ["A"]] });
  cases.push(["truncated.xlsx", good.subarray(0, Math.floor(good.length / 2)), "INVALID_SPREADSHEET"]);
  for (const [name, buffer, code] of cases) {
    const { res, nextCalled } = runMiddleware(upload(name, buffer));
    assert.equal(nextCalled, false, name);
    assert.equal(res.statusCode, 400, name);
    assert.equal(res.body.code, code, name);
  }
});

test("a header-only file is refused as having no data rows", () => {
  const { res, nextCalled } = runMiddleware(upload("h.xlsx", xlsxBuffer({ S: [["firstName", "email"]] })));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "NO_DATA_ROWS");
});

test("legacy .xls (BIFF8) is accepted", () => {
  const { req, nextCalled } = runMiddleware(upload("old.xls", xlsxBuffer({ S: [["firstName"], ["A"]] }, "biff8")));
  assert.equal(nextCalled, true);
  assert.equal(rowsOf(req)[0].firstName, "A");
});

test("multer limit errors become 413/400 with a message, never 500", () => {
  assert.deepEqual(
    { status: describeUploadError(new multer.MulterError("LIMIT_FILE_SIZE")).status },
    { status: 413 },
  );
  assert.match(describeUploadError(new multer.MulterError("LIMIT_FILE_SIZE")).message, /5 MB/);
  assert.equal(describeUploadError(new multer.MulterError("LIMIT_FILE_COUNT")).status, 400);
  const unexpected = describeUploadError(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "upload"));
  assert.equal(unexpected.status, 400);
  assert.match(unexpected.message, /"upload"/);
  assert.equal(describeUploadError(new Error("other")), null);
});

// ------------------------------------------------------------ row helpers

test("header aliases: case, spaces, documented English and Arabic names", () => {
  const row = { " First Name ": "Ali", "EMAIL ADDRESS": "a@x.com", "Grade Level": "g5", "الفصل": "5A", "المدرسة": "S" };
  assert.equal(getImportField(row, "firstName"), "Ali");
  assert.equal(getImportField(row, "email"), "a@x.com");
  assert.equal(getImportField(row, "grade"), "g5");
  assert.equal(getImportField(row, "class"), "5A");
  assert.equal(getImportField(row, "school", "OrganizationName"), "S");
  assert.equal(getImportField({ "الاسم الأول": "علي" }, "firstName"), "علي");
  assert.equal(hasImportColumn(["Grade Level"], "grade"), true);
  assert.equal(hasImportColumn(["firstName"], "grade"), false);
});

test("email validation rejects what the model's isEmail would reject", () => {
  for (const ok of ["a@x.com", "imp1.s1@e2e.sanabel.local", "o'neil+tag@x.co"]) assert.equal(isValidImportEmail(ok), true, ok);
  for (const bad of ["not-an-email", "a@nodot", "a b@x.com", "a@@x.com", "a@x..com", ".a@x.com", "a.@x.com", "12345"]) {
    assert.equal(isValidImportEmail(bad), false, bad);
  }
});

test("date parsing: serials, ISO and day-first text accepted; garbage is null", () => {
  assert.equal(parseImportDate(42077), "2015-03-14");
  assert.equal(parseImportDate("2015-03-14"), "2015-03-14");
  assert.equal(parseImportDate("14/03/2015"), "2015-03-14");
  assert.equal(parseImportDate(""), undefined);
  assert.equal(parseImportDate(null), undefined);
  assert.equal(parseImportDate("not a date"), null);
  assert.equal(parseImportDate("2015-02-30"), null);
});

test("Sequelize validation errors map to a field-level failure without raw text", () => {
  const failure = describeRowError(4, {
    name: "SequelizeValidationError",
    message: "Validation error: Validation isEmail on email failed",
    errors: [{ path: "email", validatorKey: "isEmail" }],
  }, "x@y");
  assert.deepEqual(failure, { rowNumber: 4, code: "INVALID_EMAIL", message: "email format is invalid", column: "email", email: "x@y" });
  const other = describeRowError(5, new Error("ER_LOCK_DEADLOCK something internal"));
  assert.equal(other.code, "ROW_FAILED");
  assert.doesNotMatch(other.message, /ER_LOCK/);
});

test("import passwords are 10+ characters, mix letters and digits, and differ", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const pw = generateImportPassword();
    assert.ok(pw.length >= 10);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[0-9]/);
    seen.add(pw);
  }
  assert.equal(seen.size, 200);
});

test("off-thread bcrypt hashes verify with bcryptjs (login keeps working)", async () => {
  const bcrypt = require("bcryptjs");
  const { hashPasswordOffThread } = require("../dist/helpers/passwordHashPool");
  const hashes = await Promise.all(["pw-one-23", "pw-two-45", "pw-three-67"].map((pw) => hashPasswordOffThread(pw, 4)));
  assert.equal(await bcrypt.compare("pw-one-23", hashes[0]), true);
  assert.equal(await bcrypt.compare("pw-two-45", hashes[1]), true);
  assert.equal(await bcrypt.compare("wrong", hashes[2]), false);
});

// ------------------------------------------------------------ importers

const stubImportRun = () => {
  const written = [];
  ImportRun.create = async (row) => { written.push(row); return row; };
  return written;
};
const studentRow = (rowNumber, values) => {
  const row = { firstName: "A", lastName: "B", email: `s${rowNumber}@x.com`, grade: "g5", school: "", class: "5a", ...values };
  Object.defineProperty(row, Symbol.for("sanabel.import.rowNumber"), { value: rowNumber, enumerable: false });
  return row;
};

test("student import: grade and class are required and every failure names its column and sheet row", async () => {
  const written = stubImportRun();
  Organization.findByPk = async () => ({ id: 55, name: "sanabel test school" });
  Grade.findOne = async ({ where }) => (where.name === "g5" && where.organizationId === 55 ? { id: 27, name: "g5" } : null);
  Class.findOne = async () => null;
  User.findOne = async () => null;
  const req = {
    user: { id: 9 },
    adminOrganizationId: 55,
    importHeaders: ["firstName", "lastName", "email", "grade", "school", "class"],
    processedData: {
      S: [
        studentRow(2, { grade: "" }),
        studentRow(3, { class: "" }),
        studentRow(4, { firstName: "" }),
        studentRow(6, { email: "bad@x..com" }),
        studentRow(7, { DateOfBirth: "not a date" }),
        studentRow(8, { school: "another school" }),
        studentRow(9, { class: "missing" }),
      ],
    },
  };
  const res = makeResponse();
  await addStudent(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.created, 0);
  const byRow = Object.fromEntries(res.body.failedEntries.map((f) => [f.rowNumber, f]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(byRow).map(([n, f]) => [n, [f.code, f.column]])),
    {
      2: ["GRADE_REQUIRED", "grade"],
      3: ["CLASS_REQUIRED", "class"],
      4: ["REQUIRED_FIELD_MISSING", "firstName"],
      6: ["INVALID_EMAIL", "email"],
      7: ["INVALID_DATE", "DateOfBirth"],
      8: ["FORBIDDEN_ORGANIZATION", "school"],
      9: ["CLASS_NOT_FOUND", "class"],
    },
  );
  for (const f of res.body.failedEntries) assert.ok(f.message.includes(f.column), JSON.stringify(f));
  assert.equal(written[0].organizationId, 55);
  assert.equal(written[0].failed, 7);
});

test("student import: the class lookup is a v7 where() the v7 model accepts (IMP-01)", async () => {
  stubImportRun();
  const { Where } = require("@sequelize/core");
  let classWhere;
  Organization.findByPk = async () => ({ id: 55, name: "s" });
  Grade.findOne = async () => ({ id: 27, name: "g5" });
  Class.findOne = async ({ where }) => { classWhere = where; return null; };
  User.findOne = async () => null;
  const res = makeResponse();
  await addStudent({ user: { id: 9 }, adminOrganizationId: 55, processedData: { S: [studentRow(2, {})] } }, res);
  const [andClause] = Object.getOwnPropertySymbols(classWhere).map((s) => classWhere[s]);
  assert.ok(andClause instanceof Where, "class filter built with @sequelize/core where()");
  assert.equal(res.body.failedEntries[0].code, "CLASS_NOT_FOUND");
});

test("grade import: a Super Admin's school column scopes creation and lookup to that school", async () => {
  const written = stubImportRun();
  const lookups = [];
  Organization.findOne = async ({ where }) => (where.name === "other school" ? { id: 1, name: "other school" } : null);
  Grade.findOne = async ({ where }) => { lookups.push(where); return null; };
  const created = [];
  Grade.create = async (values) => { created.push(values); return { id: 900, ...values }; };
  const rowA = { name: "Grade 5", school: "Other School" };
  Object.defineProperty(rowA, Symbol.for("sanabel.import.rowNumber"), { value: 2 });
  const rowB = { name: "Grade 6", school: "nowhere" };
  Object.defineProperty(rowB, Symbol.for("sanabel.import.rowNumber"), { value: 3 });
  const res = makeResponse();
  await importGrades({ user: { id: 1 }, adminOrganizationId: null, processedData: { S: [rowA, rowB] } }, res);
  assert.deepEqual(lookups, [{ name: "grade 5", organizationId: 1 }]);
  assert.deepEqual(created, [{ name: "grade 5", organizationId: 1 }]);
  assert.deepEqual(res.body.failedEntries, [
    { rowNumber: 3, code: "ORGANIZATION_NOT_FOUND", message: "school not found; create it before importing", column: "school" },
  ]);
  assert.equal(written.length, 1, "grade imports are recorded in ImportRuns");
  assert.equal(written[0].entityType, "grades");
  assert.equal(written[0].organizationId, 1);
});

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
