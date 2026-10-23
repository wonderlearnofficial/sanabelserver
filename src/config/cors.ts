import type { CorsOptions } from "cors";

type CorsEnvironment = {
  [key: string]: string | undefined;
  CORS_ORIGINS?: string;
  NODE_ENV?: string;
};

// These are origins emitted by installed Capacitor/Ionic applications. They
// must remain available in production because native WebViews do not use the
// public website's origin.
export const NATIVE_APP_ORIGINS = [
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
] as const;

// Browser development origins are deliberately limited to the known Ionic and
// Vite ports. A different port can be opted in through CORS_ORIGINS.
export const DEVELOPMENT_WEB_ORIGINS = [
  "http://localhost:8100",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:8100",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
] as const;

const normalizeConfiguredOrigin = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  // URL.origin canonicalizes host casing/default ports while the pathname
  // check prevents a typo such as https://example.com/app from silently being
  // broadened to the whole origin.
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      !parsed.username &&
      !parsed.password
    ) {
      return parsed.origin;
    }
  } catch {
    // Invalid entries are ignored below.
  }

  // Keep malformed, path-bearing and non-web entries inert instead of making
  // startup availability depend on an optional CORS entry.
  return "";
};

export const buildAllowedOrigins = (
  environment: CorsEnvironment = process.env,
): ReadonlySet<string> => {
  const configured = (environment.CORS_ORIGINS || "")
    .split(",")
    .map(normalizeConfiguredOrigin)
    .filter(Boolean);
  const development =
    environment.NODE_ENV === "production" ? [] : DEVELOPMENT_WEB_ORIGINS;

  return new Set([...NATIVE_APP_ORIGINS, ...development, ...configured]);
};

export const isOriginAllowed = (
  origin: string | undefined,
  environment: CorsEnvironment = process.env,
): boolean => {
  // Native clients and server-to-server/health requests can omit Origin.
  if (!origin) return true;
  return buildAllowedOrigins(environment).has(origin);
};

export class CorsOriginDeniedError extends Error {
  readonly status = 403;

  constructor() {
    super("Origin not allowed by CORS");
    this.name = "CorsOriginDeniedError";
  }
}

export const createCorsOptions = (
  environment: CorsEnvironment = process.env,
): CorsOptions => {
  const allowedOrigins = buildAllowedOrigins(environment);

  return {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new CorsOriginDeniedError());
    },
    maxAge: 86400,
  };
};
