import { Request } from "express";
import User from "../models/user.model";
import logger from "../config/logger";

/**
 * Sign-in and activity tracking for the admin console's session controls.
 *
 * Every write here is best-effort: a failed tracking update must never fail
 * the sign-in or the request that triggered it. The writes are `silent`, so
 * they do not move `updatedAt`, which other screens read as "profile edited".
 */

/** How stale `lastActiveAt` may get before an authenticated request refreshes it. */
export const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const USER_AGENT_MAX = 255;

const userAgentOf = (req: Request): string | null => {
  const raw = req.headers["user-agent"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value.slice(0, USER_AGENT_MAX) : null;
};

/** A successful password sign-in. */
export const recordSignIn = async (req: Request, userId: number): Promise<void> => {
  const now = new Date();
  try {
    await User.update(
      { lastLoginAt: now, lastActiveAt: now, lastLoginUserAgent: userAgentOf(req) } as any,
      { where: { id: userId }, silent: true },
    );
  } catch (error) {
    logger.warn("Could not record sign-in", { userId, error });
  }
};

/**
 * An authenticated request. Writes only when the stored value is older than
 * the interval, so an active user costs one small update every few minutes,
 * not one per request.
 */
export const recordActivity = (userId: number, lastActiveAt: Date | null | undefined): void => {
  const now = Date.now();
  const last = lastActiveAt ? new Date(lastActiveAt).getTime() : 0;
  if (now - last < ACTIVITY_WRITE_INTERVAL_MS) return;
  User.update({ lastActiveAt: new Date(now) } as any, { where: { id: userId }, silent: true }).catch(
    (error: unknown) => logger.warn("Could not record activity", { userId, error }),
  );
};
