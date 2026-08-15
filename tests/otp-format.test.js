const test = require("node:test");
const assert = require("node:assert/strict");

const {
  default: generateOTP,
  isValidOTP,
  OTP_LENGTH,
} = require("../dist/helpers/generateOtp");

test("generated OTPs match the four-digit API contract", () => {
  for (let index = 0; index < 100; index += 1) {
    const otp = generateOTP();
    assert.equal(otp.length, OTP_LENGTH);
    assert.equal(isValidOTP(otp), true);
  }
});

test("OTP validation rejects incomplete, six-digit, and non-numeric values", () => {
  assert.equal(isValidOTP("1234"), true);
  assert.equal(isValidOTP("123"), false);
  assert.equal(isValidOTP("123456"), false);
  assert.equal(isValidOTP("12a4"), false);
});
