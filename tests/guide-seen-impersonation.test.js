// Phase 0 P0: an admin impersonating a Student holds a real Student token, so
// `PATCH /users/seen-guides` from that session used to overwrite the real
// Student's onboarding state. Impersonation-minted tokens now carry `imp: true`
// and the endpoint refuses them.
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;
const AdminImpersonationHandoff = require("../dist/models/admin-impersonation-handoff.model").default;
const {
  markGuideSeen,
  refreshAccessToken,
  exchangeImpersonationHandoff,
} = require("../dist/controllers/userController");
const { signAccessToken, signRefreshToken } = require("../dist/helpers/tokens");

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

test("an ordinary session can still mark a guide seen", async () => {
  const originalFindOne = User.findOne;
  const updates = [];

  try {
    User.findOne = async () => ({
      id: 42,
      seenGuides: ["student-home"],
      async update(values) {
        updates.push(values);
        return this;
      },
    });

    const req = {
      user: { id: 42, email: "student@example.com", role: "Student" },
      body: { guideId: "student-tree" },
    };
    const res = makeResponse();

    await markGuideSeen(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.seenGuides, ["student-home", "student-tree"]);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].seenGuides, ["student-home", "student-tree"]);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("an impersonated session is refused and mutates nothing", async () => {
  const originalFindOne = User.findOne;
  let lookups = 0;

  try {
    User.findOne = async () => {
      lookups += 1;
      return {
        id: 42,
        seenGuides: [],
        async update() {
          throw new Error("seenGuides must not be written from an impersonated session");
        },
      };
    };

    const req = {
      user: { id: 42, email: "student@example.com", role: "Student", imp: true },
      body: { guideId: "student-tree" },
    };
    const res = makeResponse();

    await markGuideSeen(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "IMPERSONATED_SESSION");
    // Refused before any read or write of the target account.
    assert.equal(lookups, 0);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("only impersonation-minted tokens carry the imp claim", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "guide-seen-test-secret";

  try {
    const tokenUser = {
      id: 42,
      email: "student@example.com",
      role: "Student",
      tokenVersion: 2,
    };

    const ordinary = jwt.decode(signAccessToken(tokenUser));
    assert.equal(ordinary.imp, undefined);
    assert.equal(ordinary.tokenVersion, 2);

    const impersonated = jwt.decode(signAccessToken({ ...tokenUser, imp: true }));
    assert.equal(impersonated.imp, true);

    // The refresh token carries it too, so a renewal cannot launder an
    // impersonated session into an ordinary one.
    assert.equal(jwt.decode(signRefreshToken({ ...tokenUser, imp: true })).imp, true);
    assert.equal(jwt.decode(signRefreshToken(tokenUser)).imp, undefined);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("refreshing an impersonated session keeps the imp claim", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "guide-seen-test-secret";

  try {
    User.findByPk = async () => ({
      id: 42,
      email: "student@example.com",
      role: "Student",
      tokenVersion: 2,
      isAccess: true,
    });

    const refreshToken = signRefreshToken({
      id: 42,
      email: "student@example.com",
      role: "Student",
      tokenVersion: 2,
      imp: true,
    });

    const req = { body: { refreshToken } };
    const res = makeResponse();

    await refreshAccessToken(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(jwt.decode(res.body.data.token).imp, true);
    assert.equal(jwt.decode(res.body.data.refreshToken).imp, true);
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("the impersonation exchange mints a token the seen-guides endpoint refuses", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originals = {
    update: AdminImpersonationHandoff.update,
    findHandoff: AdminImpersonationHandoff.findOne,
    findUser: User.findByPk,
    findStudent: Student.findByPk,
    findChallenges: Challenge.findAll,
    findStudentChallenges: StudentChallenge.findAll,
  };
  process.env.JWT_SECRET = "guide-seen-test-secret";

  try {
    AdminImpersonationHandoff.update = async () => [1];
    AdminImpersonationHandoff.findOne = async () => ({
      id: 1,
      actorAdminUserId: 1,
      targetUserId: 50,
      targetStudentId: 26,
      expiresAt: new Date(Date.now() + 60000),
      usedAt: new Date(),
    });
    User.findByPk = async () => ({
      id: 50,
      email: "omar@test.local",
      role: "Student",
      firstName: "Omar",
      lastName: "Ahmed",
      tokenVersion: 1,
    });
    Student.findByPk = async () => ({ id: 26, userId: 50, organizationId: 11 });
    Challenge.findAll = async () => [];
    StudentChallenge.findAll = async () => [];

    const res = makeResponse();
    await exchangeImpersonationHandoff(
      { body: { code: "handoff_code_1234567890abcdef123456" } },
      res,
    );

    assert.equal(res.statusCode, 200);
    const claims = jwt.decode(res.body.data.user.token);
    assert.equal(claims.imp, true);
    assert.equal(claims.id, 50);

    // The claim reaches the endpoint through `authenticateToken`, which spreads
    // the verified payload onto req.user.
    const guideRes = makeResponse();
    await markGuideSeen(
      { user: { ...claims }, body: { guideId: "student-home" } },
      guideRes,
    );
    assert.equal(guideRes.statusCode, 403);
  } finally {
    AdminImpersonationHandoff.update = originals.update;
    AdminImpersonationHandoff.findOne = originals.findHandoff;
    User.findByPk = originals.findUser;
    Student.findByPk = originals.findStudent;
    Challenge.findAll = originals.findChallenges;
    StudentChallenge.findAll = originals.findStudentChallenges;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("refreshing an ordinary session does not gain the imp claim", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindByPk = User.findByPk;
  process.env.JWT_SECRET = "guide-seen-test-secret";

  try {
    User.findByPk = async () => ({
      id: 42,
      email: "student@example.com",
      role: "Student",
      tokenVersion: 2,
      isAccess: true,
    });

    const refreshToken = signRefreshToken({
      id: 42,
      email: "student@example.com",
      role: "Student",
      tokenVersion: 2,
    });

    const res = makeResponse();
    await refreshAccessToken({ body: { refreshToken } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(jwt.decode(res.body.data.token).imp, undefined);
  } finally {
    User.findByPk = originalFindByPk;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
