import User from "../models/user.model";

// After MAX_OTP_ATTEMPTS consecutive wrong codes, the account is locked from
// OTP verification for OTP_LOCK_MINUTES. Both are env-configurable.
export const MAX_OTP_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
export const OTP_LOCK_MINUTES = Number(process.env.OTP_LOCK_MINUTES) || 15;

export function isOtpLocked(user: User): boolean {
  return !!user.otpLockedUntil && new Date(user.otpLockedUntil) > new Date();
}

export async function recordOtpFailure(user: User): Promise<void> {
  const attempts = (user.otpAttempts || 0) + 1;
  if (attempts >= MAX_OTP_ATTEMPTS) {
    await user.update({
      otpAttempts: 0, // reset the counter once the lock kicks in
      otpLockedUntil: new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000),
    });
  } else {
    await user.update({ otpAttempts: attempts });
  }
}

export async function clearOtpFailures(user: User): Promise<void> {
  if (user.otpAttempts || user.otpLockedUntil) {
    await user.update({ otpAttempts: 0, otpLockedUntil: null });
  }
}
