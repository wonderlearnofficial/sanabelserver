import crypto from "crypto";

// 4-digit numeric OTP (1000–9999). crypto.randomInt is cryptographically
// secure; the upper bound is exclusive, so 10000 yields a max of 9999.
export default function generateOTP(): string {
  return crypto.randomInt(1000, 10000).toString();
}
