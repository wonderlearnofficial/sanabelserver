const test = require("node:test");
const assert = require("node:assert/strict");

// Regression tests for the administrator bootstrap seeder.
//
// The seeder runs on every application start, including every production
// deploy and every process restart. These tests pin the property that matters:
// an account that already exists is never rewritten. A previous revision of
// this file's subject performed an unconditional upsert and silently reset
// production administrator passwords on each deploy.

const seedAdmin = require("../dist/seeders/admin-seeder").default;
const User = require("../dist/models/user.model").default;
const Admin = require("../dist/models/admin.model").default;
const Organization = require("../dist/models/oraganization.model").default;

const MANAGED_ENV = [
  "SUPERADMIN_EMAIL", "SUPERADMIN_PASSWORD",
  "NAWAH_ADMIN_EMAIL", "NAWAH_ADMIN_PASSWORD",
  "ALI_ADMIN_EMAIL", "ALI_ADMIN_PASSWORD",
  "ADMIN_EMAIL", "ADMIN_PASSWORD",
  "ADMIN_SEED_FORCE_RESET",
];

// A recorded fake database. Every write the seeder attempts is captured so a
// test can assert on writes that should NOT have happened.
const makeWorld = ({ users = [] } = {}) => {
  const world = {
    users: users.map((user, index) => ({
      id: user.id ?? index + 1,
      role: "Admin",
      organizationId: null,
      tokenVersion: 0,
      ...user,
      saves: 0,
      async save() { this.saves += 1; },
    })),
    admins: [],
    organizations: [{ id: 3, name: "Nawah" }],
    created: [],
    adminsCreated: [],
    organizationsCreated: [],
  };

  User.count = async ({ where } = {}) =>
    world.users.filter((user) => !where || user.role === where.role).length;
  User.findOne = async ({ where }) =>
    world.users.find((user) => user.email === where.email) || null;
  User.create = async (values) => {
    const row = { id: 900 + world.users.length, saves: 0, async save() { this.saves += 1; }, ...values };
    world.users.push(row);
    world.created.push(values);
    return row;
  };

  Admin.findOne = async ({ where }) =>
    world.admins.find((admin) => admin.userId === where.userId) || null;
  Admin.create = async (values) => {
    world.admins.push({ id: world.admins.length + 1, ...values });
    world.adminsCreated.push(values);
    return values;
  };

  Organization.findOrCreate = async ({ where, defaults }) => {
    const found = world.organizations.find((org) => org.name === where.name);
    if (found) return [found, false];
    const row = { id: 500 + world.organizations.length, ...defaults };
    world.organizations.push(row);
    world.organizationsCreated.push(defaults);
    return [row, true];
  };

  return world;
};

test.beforeEach(() => {
  for (const key of MANAGED_ENV) delete process.env[key];
});
test.after(() => {
  for (const key of MANAGED_ENV) delete process.env[key];
});

test("first run with an empty database bootstraps the core administrators", async () => {
  const world = makeWorld({ users: [] });
  await seedAdmin();

  const emails = world.created.map((row) => row.email);
  assert.deepEqual(emails, [
    "superadmin@sanabelalehsan.com",
    "admin.nawah@sanabelalehsan.com",
    "alielmayyah@gmail.com",
  ]);
  assert.ok(world.created.every((row) => row.role === "Admin"));
  // Each new administrator gets the authoritative Admins profile row.
  assert.equal(world.adminsCreated.length, 3);
});

test("bootstrap preserves the Super Admin and School Admin distinction", async () => {
  const world = makeWorld({ users: [] });
  await seedAdmin();

  const byEmail = Object.fromEntries(world.created.map((row) => [row.email, row]));
  assert.equal(byEmail["superadmin@sanabelalehsan.com"].organizationId, null);
  assert.equal(byEmail["alielmayyah@gmail.com"].organizationId, null);
  assert.equal(byEmail["admin.nawah@sanabelalehsan.com"].organizationId, 3);

  const scopes = Object.fromEntries(
    world.adminsCreated.map((row) => [row.userId, row.organizationId]),
  );
  const superRow = world.users.find((u) => u.email === "superadmin@sanabelalehsan.com");
  const schoolRow = world.users.find((u) => u.email === "admin.nawah@sanabelalehsan.com");
  assert.equal(scopes[superRow.id], null, "super admin scope must be null");
  assert.equal(scopes[schoolRow.id], 3, "school admin must be locked to its organization");
});

test("second run is idempotent: no new users, no new Admins rows, no writes", async () => {
  const world = makeWorld({ users: [] });
  await seedAdmin();
  const usersAfterFirst = world.users.length;
  const adminsAfterFirst = world.admins.length;

  world.created.length = 0;
  world.adminsCreated.length = 0;
  await seedAdmin();

  assert.equal(world.created.length, 0, "no account may be recreated");
  assert.equal(world.adminsCreated.length, 0, "no duplicate Admins profile row");
  assert.equal(world.users.length, usersAfterFirst);
  assert.equal(world.admins.length, adminsAfterFirst);
  assert.equal(world.users.reduce((sum, user) => sum + user.saves, 0), 0,
    "an existing administrator must not be written to on startup");
});

test("an existing administrator's password hash survives startup", async () => {
  const originalHash = "$2a$10$existingProductionHashValueXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const world = makeWorld({
    users: [{ id: 50, email: "superadmin@sanabelalehsan.com", password: originalHash }],
  });
  process.env.SUPERADMIN_PASSWORD = "SomethingDifferentFromTheDeployEnv!";

  await seedAdmin();
  await seedAdmin();
  await seedAdmin();

  const row = world.users.find((user) => user.id === 50);
  assert.equal(row.password, originalHash, "deploy must not reset a live password");
  assert.equal(row.saves, 0);
});

test("an existing administrator's scope, role and access flags survive startup", async () => {
  const world = makeWorld({
    users: [{
      id: 51,
      email: "admin.nawah@sanabelalehsan.com",
      password: "$2a$10$schoolAdminHash",
      organizationId: 3,
      isAccess: false,
      otpVerified: false,
    }],
  });
  process.env.NAWAH_ADMIN_PASSWORD = "IgnoredBecauseTheAccountExists!";

  await seedAdmin();

  const row = world.users.find((user) => user.id === 51);
  assert.equal(row.organizationId, 3, "configured scope must not overwrite live scope");
  assert.equal(row.isAccess, false);
  assert.equal(row.otpVerified, false);
  assert.equal(row.saves, 0);
});

test("a pre-existing administrator without an Admins row gets one, scoped from the legacy column", async () => {
  const world = makeWorld({
    users: [{ id: 51, email: "admin.nawah@sanabelalehsan.com", password: "$2a$10$hash", organizationId: 3 }],
  });

  await seedAdmin();
  await seedAdmin();

  const profiles = world.admins.filter((admin) => admin.userId === 51);
  assert.equal(profiles.length, 1, "exactly one profile row, even across repeated runs");
  assert.equal(profiles[0].organizationId, 3);
});

test("a missing account is not created with a built-in password once administrators exist", async () => {
  const world = makeWorld({
    users: [{ id: 1, email: "someone.else@sanabelalehsan.com", password: "$2a$10$hash" }],
  });

  await seedAdmin();

  assert.equal(world.created.length, 0,
    "a deleted administrator must not silently return with a repository-visible password");
});

test("a missing account is created when its password is supplied by configuration", async () => {
  const world = makeWorld({
    users: [{ id: 1, email: "someone.else@sanabelalehsan.com", password: "$2a$10$hash" }],
  });
  process.env.SUPERADMIN_PASSWORD = "AnExplicitlyConfiguredValue!";

  await seedAdmin();

  assert.deepEqual(world.created.map((row) => row.email), ["superadmin@sanabelalehsan.com"]);
});

test("ADMIN_SEED_FORCE_RESET resets only when a password is configured, and bumps tokenVersion", async () => {
  const originalHash = "$2a$10$originalHashValue";
  const world = makeWorld({
    users: [
      { id: 50, email: "superadmin@sanabelalehsan.com", password: originalHash, tokenVersion: 4 },
      { id: 43, email: "alielmayyah@gmail.com", password: originalHash, tokenVersion: 1 },
    ],
  });
  process.env.ADMIN_SEED_FORCE_RESET = "true";
  process.env.SUPERADMIN_PASSWORD = "DeliberateRecoveryValue!";

  await seedAdmin();

  const reset = world.users.find((user) => user.id === 50);
  assert.notEqual(reset.password, originalHash, "configured account must be reset");
  assert.match(reset.password, /^\$2[aby]\$/, "must be stored as a bcrypt hash");
  assert.equal(reset.tokenVersion, 5, "outstanding tokens must be invalidated");

  const untouched = world.users.find((user) => user.id === 43);
  assert.equal(untouched.password, originalHash,
    "an account with no configured password must not be reset to a built-in value");
  assert.equal(untouched.tokenVersion, 1);
});

test("force reset does not change an existing account's scope", async () => {
  const world = makeWorld({
    users: [{ id: 51, email: "admin.nawah@sanabelalehsan.com", password: "$2a$10$h", organizationId: 3 }],
  });
  process.env.ADMIN_SEED_FORCE_RESET = "true";
  process.env.NAWAH_ADMIN_PASSWORD = "DeliberateRecoveryValue!";

  await seedAdmin();

  assert.equal(world.users.find((user) => user.id === 51).organizationId, 3);
});

test("no organization is created just because the server restarted", async () => {
  const world = makeWorld({
    users: [
      { id: 50, email: "superadmin@sanabelalehsan.com", password: "$2a$10$h" },
      { id: 51, email: "admin.nawah@sanabelalehsan.com", password: "$2a$10$h", organizationId: 3 },
      { id: 43, email: "alielmayyah@gmail.com", password: "$2a$10$h" },
    ],
  });

  await seedAdmin();

  assert.equal(world.organizationsCreated.length, 0);
});

test("one failing account does not stop the others", async () => {
  const world = makeWorld({ users: [] });
  const realCreate = User.create;
  let attempt = 0;
  User.create = async (values) => {
    attempt += 1;
    if (attempt === 1) throw new Error("simulated database failure");
    return realCreate(values);
  };

  await seedAdmin();

  assert.deepEqual(world.created.map((row) => row.email), [
    "admin.nawah@sanabelalehsan.com",
    "alielmayyah@gmail.com",
  ]);
});

test("a seeding failure never takes startup down", async () => {
  makeWorld({ users: [] });
  User.count = async () => { throw new Error("database unreachable"); };
  await seedAdmin();
});
