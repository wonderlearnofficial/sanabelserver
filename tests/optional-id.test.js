const test = require("node:test");
const assert = require("node:assert/strict");

const {
  InvalidOptionalIdError,
  parseOptionalPositiveId,
} = require("../dist/helpers/optionalId");

test("optional relationship IDs preserve missing and clear values", () => {
  assert.equal(parseOptionalPositiveId(undefined, "classId"), undefined);
  assert.equal(parseOptionalPositiveId(null, "classId"), null);
  assert.equal(parseOptionalPositiveId("", "classId"), null);
});

test("optional relationship IDs accept positive integer strings", () => {
  assert.equal(parseOptionalPositiveId("42", "classId"), 42);
  assert.equal(parseOptionalPositiveId(7, "classId"), 7);
});

test("optional relationship IDs reject zero, negatives, decimals, and text", () => {
  for (const value of [0, "0", -1, 1.5, "abc"]) {
    assert.throws(
      () => parseOptionalPositiveId(value, "classId"),
      InvalidOptionalIdError,
    );
  }
});
