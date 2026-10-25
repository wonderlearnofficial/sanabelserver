import logger from "../config/logger";
import PlatformSetting from "../models/platform-setting.model";

/**
 * How long a sign-in lasts, set by a Super Admin.
 *
 * - `accessTokenMinutes`: lifetime of the short access token. When it runs out
 *   the app renews it silently with the refresh token.
 * - `refreshTokenDays`: how long a session survives without any use. Every
 *   renewal issues a new refresh token, so an active user stays signed in; one
 *   who is away longer than this signs in again.
 *
 * Token signing is synchronous and runs on every login and renewal, so the
 * policy is cached in memory: loaded at startup, replaced on save, and
 * re-read every minute so every server instance converges on a change.
 *
 * Both limits are also checked against a token's `iat` (see `isTokenTooOld`),
 * so shortening a lifetime cuts sessions already issued instead of waiting for
 * their original expiry.
 */
export interface SessionPolicy {
  accessTokenMinutes: number;
  refreshTokenDays: number;
}

export const SESSION_LIMITS = {
  accessTokenMinutes: { min: 5, max: 24 * 60 },
  refreshTokenDays: { min: 1, max: 730 },
} as const;

const SETTING_KEY = "session";
const RELOAD_MS = 60_000;

/** "30m", "12h", "365d" or a number of seconds, as minutes. */
const parseTtlMinutes = (raw: string | undefined, fallbackMinutes: number): number => {
  const match = /^(\d+)\s*([smhd]?)$/.exec((raw ?? "").trim());
  if (!match) return fallbackMinutes;
  const value = Number(match[1]);
  const unit = match[2] || "s";
  const minutes = unit === "d" ? value * 1440 : unit === "h" ? value * 60 : unit === "m" ? value : value / 60;
  return minutes > 0 ? minutes : fallbackMinutes;
};

/** The environment's lifetimes, used until a Super Admin saves a policy. */
export const defaultSessionPolicy = (): SessionPolicy => ({
  accessTokenMinutes: Math.round(parseTtlMinutes(process.env.ACCESS_TOKEN_TTL, 30)),
  refreshTokenDays: Math.max(1, Math.round(parseTtlMinutes(process.env.REFRESH_TOKEN_TTL, 365 * 1440) / 1440)),
});

let cached: SessionPolicy | null = null;
let reloadTimer: NodeJS.Timeout | null = null;

export const getSessionPolicy = (): SessionPolicy => cached ?? defaultSessionPolicy();

/**
 * Checks a submitted policy. Returns the clean policy, or the field and reason
 * it was refused for.
 */
export const validateSessionPolicy = (
  input: unknown,
): { policy: SessionPolicy } | { field: keyof SessionPolicy; message: string } => {
  const body = (input ?? {}) as Record<string, unknown>;
  const policy = {} as SessionPolicy;
  for (const field of ["accessTokenMinutes", "refreshTokenDays"] as const) {
    const value = body[field];
    const { min, max } = SESSION_LIMITS[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      return { field, message: `${field} must be a whole number from ${min} to ${max}` };
    }
    policy[field] = value;
  }
  if (policy.accessTokenMinutes > policy.refreshTokenDays * 1440) {
    return { field: "accessTokenMinutes", message: "accessTokenMinutes cannot be longer than refreshTokenDays" };
  }
  return { policy };
};

/** Reads the saved policy into the cache. Keeps the last good value on failure. */
export const loadSessionPolicy = async (): Promise<SessionPolicy> => {
  try {
    const row = await PlatformSetting.findByPk(SETTING_KEY);
    const checked = row ? validateSessionPolicy(row.value) : null;
    cached = checked && "policy" in checked ? checked.policy : null;
  } catch (error) {
    logger.error("Could not load the session policy; keeping the previous one", { error });
  }
  return getSessionPolicy();
};

export const saveSessionPolicy = async (policy: SessionPolicy): Promise<SessionPolicy> => {
  await PlatformSetting.upsert({ key: SETTING_KEY, value: { ...policy } });
  cached = { ...policy };
  return getSessionPolicy();
};

/** Loads the policy now and keeps it fresh. Safe to call more than once. */
export const startSessionPolicy = async (): Promise<void> => {
  await loadSessionPolicy();
  if (reloadTimer) return;
  reloadTimer = setInterval(() => void loadSessionPolicy(), RELOAD_MS);
  reloadTimer.unref?.();
};

/** True when a token issued at `iat` (seconds) is older than `limitSeconds`. */
export const isTokenTooOld = (iat: unknown, limitSeconds: number, now: number = Date.now()): boolean =>
  typeof iat === "number" && now / 1000 - iat > limitSeconds;

/** For tests: forget the cached policy. */
export const resetSessionPolicyCache = (): void => {
  cached = null;
};
