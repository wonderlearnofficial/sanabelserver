const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_TASK_CATEGORY_TITLES,
  buildCategoryCounts,
} = require("../dist/helpers/taskCategoryStats");

test("category statistics always include the four core mission categories", () => {
  const counts = buildCategoryCounts([], {});

  assert.deepEqual(Object.keys(counts), DEFAULT_TASK_CATEGORY_TITLES);
  assert.deepEqual(Object.values(counts), [0, 0, 0, 0]);
});

test("category statistics normalize database strings and bad values", () => {
  const [firstTitle, secondTitle] = DEFAULT_TASK_CATEGORY_TITLES;
  const counts = buildCategoryCounts([], {
    [firstTitle]: "3",
    [secondTitle]: "not-a-number",
  });

  assert.equal(counts[firstTitle], 3);
  assert.equal(counts[secondTitle], 0);
});
