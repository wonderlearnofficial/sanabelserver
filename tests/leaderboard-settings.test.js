const test = require("node:test");
const assert = require("node:assert/strict");

const Organization = require("../dist/models/oraganization.model").default;
const {
  getLeaderboardSettings,
  updateLeaderboardSettings,
} = require("../dist/controllers/adminController");

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

test("School Admin getLeaderboardSettings only returns their own organization", async () => {
  const originalFindByPk = Organization.findByPk;
  try {
    let requestedId;
    Organization.findByPk = async (id, options) => {
      requestedId = id;
      return {
        id: 5,
        name: "Test Academy",
        leaderboardScope: "same_grade",
        leaderboardLimit: 30,
        hideZeroXpStudents: true,
      };
    };

    const req = {
      adminOrganizationId: 5,
      params: {},
      query: {},
    };
    const res = makeResponse();

    await getLeaderboardSettings(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requestedId, 5);
    assert.equal(res.body.organizations.length, 1);
    assert.equal(res.body.organizations[0].name, "Test Academy");
    assert.equal(res.body.organizations[0].leaderboardScope, "same_grade");
  } finally {
    Organization.findByPk = originalFindByPk;
  }
});

test("Super Admin getLeaderboardSettings returns all organizations or by :orgId", async () => {
  const originalFindAndCountAll = Organization.findAndCountAll;
  const originalFindByPk = Organization.findByPk;
  try {
    Organization.findAndCountAll = async (options) => ({
      count: 2,
      rows: [
        { id: 1, name: "School One", leaderboardScope: "all_school", leaderboardLimit: 50, hideZeroXpStudents: true },
        { id: 2, name: "School Two", leaderboardScope: "same_class", leaderboardLimit: 20, hideZeroXpStudents: false },
      ],
    });

    const reqList = {
      adminOrganizationId: null,
      params: {},
      query: { page: "1", limit: "10" },
    };
    const resList = makeResponse();

    await getLeaderboardSettings(reqList, resList);

    assert.equal(resList.statusCode, 200);
    assert.equal(resList.body.total, 2);
    assert.equal(resList.body.organizations.length, 2);

    Organization.findByPk = async (id) => ({
      id: Number(id),
      name: "Target School",
      leaderboardScope: "same_grade",
      leaderboardLimit: 25,
      hideZeroXpStudents: true,
    });

    const reqSingle = {
      adminOrganizationId: null,
      params: { orgId: "2" },
      query: {},
    };
    const resSingle = makeResponse();

    await getLeaderboardSettings(reqSingle, resSingle);

    assert.equal(resSingle.statusCode, 200);
    assert.equal(resSingle.body.organizations[0].id, 2);
  } finally {
    Organization.findAndCountAll = originalFindAndCountAll;
    Organization.findByPk = originalFindByPk;
  }
});

test("updateLeaderboardSettings rejects invalid scope, limit, and non-boolean hideZeroXp", async () => {
  const reqInvalidScope = {
    adminOrganizationId: 5,
    params: { orgId: "5" },
    body: { leaderboardScope: "all_galaxy" },
  };
  const resInvalidScope = makeResponse();
  await updateLeaderboardSettings(reqInvalidScope, resInvalidScope);
  assert.equal(resInvalidScope.statusCode, 400);
  assert.match(resInvalidScope.body.message, /leaderboardScope must be one of/);

  const reqInvalidLimitLow = {
    adminOrganizationId: 5,
    params: { orgId: "5" },
    body: { leaderboardLimit: 0 },
  };
  const resInvalidLimitLow = makeResponse();
  await updateLeaderboardSettings(reqInvalidLimitLow, resInvalidLimitLow);
  assert.equal(resInvalidLimitLow.statusCode, 400);
  assert.match(resInvalidLimitLow.body.message, /leaderboardLimit must be an integer between 1 and 500/);

  const reqInvalidLimitHigh = {
    adminOrganizationId: 5,
    params: { orgId: "5" },
    body: { leaderboardLimit: 501 },
  };
  const resInvalidLimitHigh = makeResponse();
  await updateLeaderboardSettings(reqInvalidLimitHigh, resInvalidLimitHigh);
  assert.equal(resInvalidLimitHigh.statusCode, 400);

  const reqInvalidHideZero = {
    adminOrganizationId: 5,
    params: { orgId: "5" },
    body: { hideZeroXpStudents: "not_a_bool" },
  };
  const resInvalidHideZero = makeResponse();
  await updateLeaderboardSettings(reqInvalidHideZero, resInvalidHideZero);
  assert.equal(resInvalidHideZero.statusCode, 400);
  assert.match(resInvalidHideZero.body.message, /hideZeroXpStudents must be a boolean/);
});

test("School Admin cannot update another organization's settings", async () => {
  const req = {
    adminOrganizationId: 5,
    params: { orgId: "99" },
    body: { leaderboardScope: "same_grade" },
  };
  const res = makeResponse();

  await updateLeaderboardSettings(req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /You can only update your own organization/);
});

test("School Admin can update their own organization settings", async () => {
  const originalFindByPk = Organization.findByPk;
  try {
    let updatedPayload;
    const fakeOrg = {
      id: 5,
      name: "My School",
      leaderboardScope: "all_school",
      leaderboardLimit: 50,
      hideZeroXpStudents: true,
      update: async (fields) => {
        updatedPayload = fields;
        Object.assign(fakeOrg, fields);
        return fakeOrg;
      },
    };
    Organization.findByPk = async () => fakeOrg;

    const req = {
      adminOrganizationId: 5,
      params: { orgId: "5" },
      body: {
        leaderboardScope: "same_grade",
        leaderboardLimit: 25,
        hideZeroXpStudents: false,
      },
    };
    const res = makeResponse();

    await updateLeaderboardSettings(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(updatedPayload, {
      leaderboardScope: "same_grade",
      leaderboardLimit: 25,
      hideZeroXpStudents: false,
    });
    assert.equal(res.body.organization.leaderboardScope, "same_grade");
    assert.equal(res.body.organization.leaderboardLimit, 25);
    assert.equal(res.body.organization.hideZeroXpStudents, false);
  } finally {
    Organization.findByPk = originalFindByPk;
  }
});
