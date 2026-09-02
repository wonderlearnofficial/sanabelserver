const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const User = require("../dist/models/user.model").default;
const Student = require("../dist/models/student.model").default;
const Parent = require("../dist/models/parent.model").default;
const Teacher = require("../dist/models/teacher.model").default;
const Challenge = require("../dist/models/challenge.model").default;
const StudentChallenge = require("../dist/models/student-challenge.model").default;

const {
  registration,
  resetPassword,
  updatePassword,
} = require("../dist/controllers/userController");
const {
  resetUserPassword,
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

const fakeTransaction = { transaction: async (work) => work({ fake: "tx" }) };
Object.defineProperty(User, "sequelize", {
  value: fakeTransaction,
  configurable: true,
});

test("registration requires verified OTP before creating account", async () => {
  // Case A: No OTP record found
  User.findOne = async () => null;
  const resNoOtp = makeResponse();
  await registration(
    { body: { email: "new@example.com", password: "SecretPassword123" } },
    resNoOtp
  );
  assert.equal(resNoOtp.statusCode, 403);
  assert.equal(resNoOtp.body.message, "OTP record not found. Verify OTP before registering.");

  // Case B: OTP record exists but is not verified (isAccess is false)
  const unverifiedUser = { email: "new@example.com", isAccess: false, password: null };
  User.findOne = async () => unverifiedUser;
  const resUnverified = makeResponse();
  await registration(
    { body: { email: "new@example.com", password: "SecretPassword123" } },
    resUnverified
  );
  assert.equal(resUnverified.statusCode, 403);
  assert.equal(resUnverified.body.message, "OTP not verified. Verify OTP before resetting password.");

  // Case C: Email already has a registered password
  const alreadyRegistered = { email: "existing@example.com", isAccess: true, password: "hash" };
  User.findOne = async () => alreadyRegistered;
  const resAlreadyRegistered = makeResponse();
  await registration(
    { body: { email: "existing@example.com", password: "SecretPassword123" } },
    resAlreadyRegistered
  );
  assert.equal(resAlreadyRegistered.statusCode, 403);
  assert.equal(resAlreadyRegistered.body.message, "Email is already registered. Login or use another email.");
});

test("registration successfully registers a student and initializes challenges", async () => {
  const pendingUser = {
    id: 50,
    email: "student@test.com",
    isAccess: true,
    password: null,
    role: "Student",
    tokenVersion: 1,
    async update(fields) {
      Object.assign(this, fields);
    },
  };

  User.findOne = async () => pendingUser;
  Student.findOne = async () => null; // Unique connectCode check
  
  let createdStudent = null;
  Student.create = async (fields) => {
    createdStudent = { id: 88, ...fields };
    return createdStudent;
  };

  Challenge.findAll = async () => [
    { id: 1, title: "الصلاة" },
    { id: 2, title: "البر" },
  ];

  let createdChallenges = [];
  StudentChallenge.bulkCreate = async (challenges) => {
    createdChallenges = challenges;
    return challenges;
  };

  const req = {
    body: {
      firstName: "طارق",
      lastName: "أحمد",
      email: "student@test.com",
      password: "MyPassword123",
      role: "Student",
      gender: "Male",
    },
  };

  const res = makeResponse();
  await registration(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message, "Registration successful");
  assert.ok(res.body.data.token, "Access token must be generated");
  assert.ok(res.body.data.refreshToken, "Refresh token must be generated");

  // Student created with unique connectCode and tree stage 1
  assert.ok(createdStudent.connectCode, "Connect code must be generated for parent linking");
  assert.equal(createdStudent.treeProgress, 1);
  assert.equal(createdChallenges.length, 2);
});

test("resetPassword requires OTP verification before resetting", async () => {
  // Case A: User has not verified OTP (otpVerified is false)
  const unverifiedUser = {
    email: "reset@test.com",
    otpVerified: false,
    async update() {},
  };
  User.findOne = async () => unverifiedUser;

  const resUnverified = makeResponse();
  await resetPassword(
    { body: { email: "reset@test.com", newPassword: "NewSecurePassword123" } },
    resUnverified
  );
  assert.equal(resUnverified.statusCode, 403);
  assert.equal(
    resUnverified.body.message,
    "OTP not verified. Please verify OTP before resetting password."
  );

  // Case B: User has verified OTP (otpVerified is true) -> successfully resets
  const verifiedUser = {
    email: "reset@test.com",
    otpVerified: true,
    password: "oldHash",
    resetOTP: "1234",
    otpExpiry: new Date(),
    tokenVersion: 4,
    async update(fields) {
      Object.assign(this, fields);
    },
  };
  User.findOne = async () => verifiedUser;

  const resSuccess = makeResponse();
  await resetPassword(
    { body: { email: "reset@test.com", newPassword: "NewSecurePassword123" } },
    resSuccess
  );
  assert.equal(resSuccess.statusCode, 200);
  assert.equal(resSuccess.body.message, "Password reset successfully");
  assert.equal(verifiedUser.otpVerified, false);
  assert.equal(verifiedUser.resetOTP, null);
  assert.equal(verifiedUser.tokenVersion, 5);
  assert.ok(bcrypt.compareSync("NewSecurePassword123", verifiedUser.password));
});

test("updatePassword validates current password before applying new password", async () => {
  const currentPasswordHash = bcrypt.hashSync("CurrentPassword123", 10);
  const userRecord = {
    id: 10,
    email: "user@test.com",
    password: currentPasswordHash,
    tokenVersion: 9,
    async update(fields) {
      Object.assign(this, fields);
    },
  };

  User.findOne = async () => userRecord;

  // Case A: Incorrect current password
  const resWrong = makeResponse();
  await updatePassword(
    {
      user: { id: 10 },
      body: {
        old_password: "WrongPassword999",
        new_password: "BrandNewPassword123",
      },
    },
    resWrong
  );
  assert.equal(resWrong.statusCode, 500);
  assert.equal(resWrong.body.message, "Incorrect current password");

  // Case B: Correct current password
  const resCorrect = makeResponse();
  await updatePassword(
    {
      user: { id: 10 },
      body: {
        old_password: "CurrentPassword123",
        new_password: "BrandNewPassword123",
      },
    },
    resCorrect
  );
  assert.equal(resCorrect.statusCode, 200);
  assert.equal(resCorrect.body.message, "Password updated successfully");
  assert.equal(resCorrect.body.reauthenticationRequired, true);
  assert.equal(userRecord.tokenVersion, 10);
  assert.ok(bcrypt.compareSync("BrandNewPassword123", userRecord.password));
});

test("Admin password reset revokes every existing session for the target account", async () => {
  const target = {
    id: 77,
    role: "Parent",
    tokenVersion: 6,
    async update(fields) {
      Object.assign(this, fields);
    },
  };
  User.findByPk = async () => target;

  const res = makeResponse();
  await resetUserPassword(
    { params: { userId: "77" }, adminOrganizationId: null },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Password reset successfully");
  assert.equal(target.tokenVersion, 7);
});
