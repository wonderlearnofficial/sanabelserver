/**
 * Account identity projection shared by the authenticated profile endpoints.
 *
 * Two rules live here so all three roles cannot drift apart:
 *
 *   1. `PROFILE_USER_ATTRIBUTES` is the allowlist of `Users` columns a profile
 *      response may carry. Including the whole model leaks the password hash,
 *      the OTP fields, `tokenVersion`, the push subscription and the stored
 *      location — none of which any client reads.
 *   2. `accountCreatedAtIso` normalises `Users.createdAt` to one ISO string (or
 *      null), so Tutorial V2 account-age eligibility sees the same shape for a
 *      Student, a Teacher and a Parent.
 *
 * Account age is the *user* lifecycle, never the role row: a `Teachers` or
 * `Parents` row is written when the profile is linked, which imports and
 * re-linking can move.
 */
export const PROFILE_USER_ATTRIBUTES = [
  "id",
  "firstName",
  "lastName",
  "email",
  "role",
  "profileImg",
  "gender",
  "dateOfBirth",
  "isAccess",
  "seenGuides",
  "createdAt",
] as const;

/** Columns a profile response must never carry, for the regression tests. */
export const PROFILE_FORBIDDEN_USER_ATTRIBUTES = [
  "password",
  "resetOTP",
  "otpExpiry",
  "otpVerified",
  "otpAttempts",
  "otpLockedUntil",
  "tokenVersion",
  "pushSubscription",
  "location",
] as const;

export const accountCreatedAtIso = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};
