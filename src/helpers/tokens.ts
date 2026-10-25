// Uses require (untyped) to match the existing jsonwebtoken usage in the
// controllers and to avoid the @types/jsonwebtoken StringValue friction on
// env-sourced TTL strings.
const jwt = require("jsonwebtoken");
import { getSessionPolicy } from "./sessionPolicy";

// Short-lived access token; long-lived, rolling refresh token. A Super Admin
// sets both lifetimes from the admin console (helpers/sessionPolicy.ts); the
// ACCESS_TOKEN_TTL / REFRESH_TOKEN_TTL environment values are the defaults
// until then. The refresh endpoint issues a replacement refresh token on every
// successful renewal, so an active user stays signed in, while one who is away
// longer than the refresh lifetime must sign in again.
const accessTtlSeconds = (): number => getSessionPolicy().accessTokenMinutes * 60;
const refreshTtlSeconds = (): number => getSessionPolicy().refreshTokenDays * 24 * 60 * 60;

function accessSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

// Falls back to a derived secret so refresh tokens are always signed with a
// different key than access tokens even if REFRESH_TOKEN_SECRET is unset.
function refreshSecret(): string {
  return process.env.REFRESH_TOKEN_SECRET || `${accessSecret()}_refresh`;
}

export interface TokenUser {
  id: number;
  email: string;
  role: string;
  tokenVersion?: number;
  // Set only by the admin impersonation exchange. An impersonated session is a
  // real session on the target account, so endpoints that write the account's
  // own preferences must be able to tell the two apart. Omitted (never `false`)
  // on ordinary login tokens so their payload is unchanged.
  imp?: boolean;
}

export function signAccessToken(user: TokenUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      // Access tokens must be revocable too. Password resets, password changes,
      // logout, and other security-sensitive account updates rotate this value.
      tokenVersion: user.tokenVersion ?? 0,
      ...(user.imp === true ? { imp: true } : {}),
    },
    accessSecret(),
    { expiresIn: accessTtlSeconds() },
  );
}

export function signRefreshToken(user: TokenUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
      type: "refresh",
      // Carried so a renewal cannot silently upgrade an impersonated session
      // into an ordinary one.
      ...(user.imp === true ? { imp: true } : {}),
    },
    refreshSecret(),
    { expiresIn: refreshTtlSeconds() },
  );
}

export function verifyRefreshToken(token: string): any {
  return jwt.verify(token, refreshSecret());
}
