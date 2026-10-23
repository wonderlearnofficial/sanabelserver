import { Op } from "@sequelize/core";
import User from "../models/user.model";

// After MAX_OTP_ATTEMPTS consecutive wrong codes, the account is locked from
// OTP verification for OTP_LOCK_MINUTES. Both are env-configurable.
export const MAX_OTP_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
export const OTP_LOCK_MINUTES = Number(process.env.OTP_LOCK_MINUTES) || 15;

export function isOtpLocked(user: User): boolean {
  return !!user.otpLockedUntil && new Date(user.otpLockedUntil) > new Date();
}

// Records one wrong code. The increment runs in the database
// (otpAttempts = otpAttempts + 1), so parallel guesses cannot each read the
// same stale count and slip past the threshold. The lock is then derived from
// the same row and applied with a conditional UPDATE. Returns true when the
// account is now locked.
export async function recordOtpFailure(user: User): Promise<boolean> {
  await User.increment({ otpAttempts: 1 }, { where: { id: user.id } });

  const fresh = await User.findByPk(user.id, {
    attributes: ["id", "otpAttempts", "otpLockedUntil"],
  });
  const attempts = Number(fresh?.otpAttempts) || 0;
  if (attempts < MAX_OTP_ATTEMPTS) return false;

  await User.update(
    {
      otpAttempts: 0, // reset the counter once the lock kicks in
      otpLockedUntil: new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000),
    },
    { where: { id: user.id, otpAttempts: { [Op.gte]: MAX_OTP_ATTEMPTS } } },
  );
  return true;
}

export async function clearOtpFailures(user: User): Promise<void> {
  if (user.otpAttempts || user.otpLockedUntil) {
    await user.update({ otpAttempts: 0, otpLockedUntil: null });
  }
}
