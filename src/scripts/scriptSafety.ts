// Shared guard for the seed/admin scripts in this folder. They write accounts
// and passwords, so by default they may only touch a local database:
//
//   - NODE_ENV=production            -> refuse
//   - MYSQL_DB_HOST not loopback     -> refuse
//   - `--allow-remote` on argv       -> the operator explicitly accepts both
//
// Credentials are never hardcoded here or in the scripts: connection details
// come from the environment only, and account passwords from named env vars.
// Values are never printed.

const LOOPBACK_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

export const ALLOW_REMOTE_FLAG = "--allow-remote";

export const isLoopbackHost = (host: string | undefined): boolean =>
  LOOPBACK_HOSTS.has(String(host ?? "").trim().toLowerCase());

/** Exits the process unless the target database is local, or the operator passed --allow-remote. */
export const assertSafeScriptTarget = (scriptName: string): void => {
  if (process.argv.includes(ALLOW_REMOTE_FLAG)) {
    console.warn(
      `${scriptName}: ${ALLOW_REMOTE_FLAG} given, skipping the local-database safety check.`,
    );
    return;
  }
  if (process.env.NODE_ENV === "production") {
    console.error(
      `Refusing to run ${scriptName}: NODE_ENV is "production". Pass ${ALLOW_REMOTE_FLAG} only if you really intend this.`,
    );
    process.exit(1);
  }
  if (!isLoopbackHost(process.env.MYSQL_DB_HOST)) {
    console.error(
      `Refusing to run ${scriptName}: MYSQL_DB_HOST is not a loopback host. Pass ${ALLOW_REMOTE_FLAG} only if you really intend a remote database.`,
    );
    process.exit(1);
  }
};

/** Reads a required env var, exiting with a message that names it (never its value). */
export const requireScriptEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}.`);
    process.exit(1);
  }
  return value;
};
