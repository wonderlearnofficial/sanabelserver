const test = require("node:test");
const assert = require("node:assert/strict");

const Organization = require("../dist/models/oraganization.model").default;
const { createOrganization, updateOrganization } = require("../dist/controllers/adminController");

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

// A Super Admin request: no adminOrganizationId.
const superReq = (extra = {}) => ({
  user: { id: 1, email: "super@example.invalid" },
  adminOrganizationId: null,
  params: {},
  body: {},
  query: {},
  ...extra,
});

test("a new school keeps the capitals it was typed with", async () => {
  let created;
  Organization.findOne = async () => null;
  Organization.create = async (values) => {
    created = values;
    return { id: 40, ...values };
  };

  const res = makeResponse();
  await createOrganization(superReq({ body: { name: "  Al Noor School " } }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(created.name, "Al Noor School");
});

test("creating a school refuses a name that differs only in case", async () => {
  Organization.findOne = async () => ({ id: 3, name: "al noor school" });
  Organization.create = async () => assert.fail("must not create");

  const res = makeResponse();
  await createOrganization(superReq({ body: { name: "AL NOOR SCHOOL" } }), res);

  assert.equal(res.statusCode, 409);
});

test("renaming keeps capitals and may change only the case of its own name", async () => {
  let updated;
  let lookup;
  Organization.findByPk = async () => ({
    id: 86,
    name: "load test school 5",
    async update(values) {
      updated = values;
      Object.assign(this, values);
    },
  });
  // The duplicate check excludes the school being renamed.
  Organization.findOne = async (options) => {
    lookup = options;
    return null;
  };

  const res = makeResponse();
  await updateOrganization(
    superReq({ params: { organizationId: "86" }, body: { name: "Load Test School 5" } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(updated.name, "Load Test School 5");
  assert.ok(lookup, "a duplicate check ran");
});

test("renaming refuses another school's name in any case", async () => {
  Organization.findByPk = async () => ({
    id: 86,
    name: "load test school 5",
    update: async () => assert.fail("must not update"),
  });
  Organization.findOne = async () => ({ id: 85, name: "Load Test School 4" });

  const res = makeResponse();
  await updateOrganization(
    superReq({ params: { organizationId: "86" }, body: { name: "load TEST school 4" } }),
    res,
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.field, "name");
});

test("renaming refuses an empty name", async () => {
  Organization.findByPk = async () => ({
    id: 86,
    name: "load test school 5",
    update: async () => assert.fail("must not update"),
  });

  const res = makeResponse();
  await updateOrganization(superReq({ params: { organizationId: "86" }, body: { name: "   " } }), res);

  assert.equal(res.statusCode, 400);
});
