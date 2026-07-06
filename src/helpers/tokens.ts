// Uses require (untyped) to match the existing jsonwebtoken usage in the
// controllers and to avoid the @types/jsonwebtoken StringValue friction on
// env-sourced TTL strings.
const jwt = require("jsonwebtoken");

// Short-lived access token; longer-lived refresh token. Both are env-tunable.
const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || "30m";
const REFRESH_TTL = process.env.REFRESH_TOKEN_TTL || "7d";

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
}

export function signAccessToken(user: TokenUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    accessSecret(),
    { expiresIn: ACCESS_TTL },
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
    },
    refreshSecret(),
    { expiresIn: REFRESH_TTL },
  );
}

export function verifyRefreshToken(token: string): any {
  return jwt.verify(token, refreshSecret());
}
