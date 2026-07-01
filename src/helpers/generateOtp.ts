import crypto from "crypto";

export default function generateOTP(length = 4): string {
  return crypto.randomInt(1000, 9999).toString();
}
