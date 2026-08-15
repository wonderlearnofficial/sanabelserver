import crypto from "crypto";

export const OTP_LENGTH = 4;

export const isValidOTP = (value: string): boolean =>
  new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);

// 4-digit numeric OTP (1000–9999). crypto.randomInt is cryptographically
// secure; the upper bound is exclusive, so 10000 yields a max of 9999.
export default function generateOTP(): string {
  const minimum = 10 ** (OTP_LENGTH - 1);
  const maximum = 10 ** OTP_LENGTH;
  return crypto.randomInt(minimum, maximum).toString();
}
