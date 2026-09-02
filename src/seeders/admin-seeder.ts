import bcrypt from "bcryptjs";
import User from "../models/user.model";
import Admin from "../models/admin.model";
import Organization from "../models/oraganization.model";
import logger from "../config/logger";

// Bootstrap seeding for administrator accounts.
//
// This runs on EVERY application start (connectToDb -> seedAdmin), so it must
// be safe to execute repeatedly against a live production database.
//
// Safety contract:
//   * An existing account is never modified during normal startup. Its
//     password, role, organization scope and access flags are left untouched.
//   * A missing account is created only when its password is supplied through
//     an environment variable, or when the database contains no administrator
//     at all (genuine first-run bootstrap, where a built-in fallback password
//     is the only way to avoid locking everyone out).
//   * Passwords are changed only by an explicit, opt-in administrative
//     operation: ADMIN_SEED_FORCE_RESET=true. That is intended as a one-off
//     recovery switch and should not be left enabled.
//   * Password values are never logged, neither plaintext nor hash.
//
// Historical note: between 2026-08-31 and 2026-09-01 this seeder performed an
// unconditional upsert, which reset the password, role and organization of the
// managed accounts on every deploy and every process restart.

type AdminScope =
  | { kind: "super" }
  | { kind: "school"; organizationName: string };

interface AdminSeedConfig {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  /** True when the password came from configuration rather than a built-in fallback. */
  passwordFromEnv: boolean;
  /** Name of the variable an operator should set. Used in warnings; never holds a value. */
  passwordEnvVar: string;
  scope: AdminScope;
}

const readEmail = (envVar: string, fallback: string): string =>
  (process.env[envVar] || fallback).toLowerCase().trim();

const buildConfigs = (): AdminSeedConfig[] => {
  const configs: AdminSeedConfig[] = [
    {
      firstName: "Super",
      lastName: "Admin",
      email: readEmail("SUPERADMIN_EMAIL", "superadmin@sanabelalehsan.com"),
      password: process.env.SUPERADMIN_PASSWORD || "SuperAdmin#Sanabel2026!",
      passwordFromEnv: Boolean(process.env.SUPERADMIN_PASSWORD),
      passwordEnvVar: "SUPERADMIN_PASSWORD",
      scope: { kind: "super" },
    },
    {
      firstName: "Nawah",
      lastName: "Admin",
      email: readEmail("NAWAH_ADMIN_EMAIL", "admin.nawah@sanabelalehsan.com"),
      password: process.env.NAWAH_ADMIN_PASSWORD || "Sanabel2026Admin!",
      passwordFromEnv: Boolean(process.env.NAWAH_ADMIN_PASSWORD),
      passwordEnvVar: "NAWAH_ADMIN_PASSWORD",
      scope: { kind: "school", organizationName: "Nawah" },
    },
    {
      firstName: "Ali",
      lastName: "Elmayyah",
      email: readEmail("ALI_ADMIN_EMAIL", "alielmayyah@gmail.com"),
      password: process.env.ALI_ADMIN_PASSWORD || "Ali#Sanabel2026!",
      passwordFromEnv: Boolean(process.env.ALI_ADMIN_PASSWORD),
      passwordEnvVar: "ALI_ADMIN_PASSWORD",
      scope: { kind: "super" },
    },
  ];

  // Legacy pair. Both halves must be supplied, so the password is always explicit.
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const legacyEmail = process.env.ADMIN_EMAIL.toLowerCase().trim();
    if (!configs.some((config) => config.email === legacyEmail)) {
      configs.push({
        firstName: "Admin",
        lastName: "",
        email: legacyEmail,
        password: process.env.ADMIN_PASSWORD,
        passwordFromEnv: true,
        passwordEnvVar: "ADMIN_PASSWORD",
        scope: { kind: "super" },
      });
    }
  }

  return configs;
};

// Resolve the organization for an account that is about to be created. Only
// called on the creation path, so a school never appears just because the
// server restarted.
const resolveScope = async (scope: AdminScope): Promise<number | null> => {
  if (scope.kind === "super") return null;
  const [organization] = await Organization.findOrCreate({
    where: { name: scope.organizationName },
    defaults: { name: scope.organizationName, type: "School" as any },
  });
  return organization.id;
};

// Additive only. Gives an administrator the Admins profile row that database
// V2 treats as authoritative, without ever changing an existing one. The scope
// for a pre-existing account comes from the legacy Users.organizationId, which
// is the same rule the backfill migration used.
const ensureAdminProfile = async (
  user: User,
  organizationId: number | null,
): Promise<void> => {
  if (user.role !== "Admin") return;
  try {
    const existingProfile = await Admin.findOne({ where: { userId: user.id } });
    if (existingProfile) return;
    await Admin.create({ userId: user.id, organizationId });
    logger.info("Created missing Admins profile row", {
      userId: user.id,
      organizationId,
    });
  } catch (error) {
    // A dangling organization reference must not take startup down.
    logger.warn("Could not ensure Admins profile row", { userId: user.id, error });
  }
};

const seedAdmin = async (): Promise<void> => {
  try {
    const configs = buildConfigs();
    const forceReset = process.env.ADMIN_SEED_FORCE_RESET === "true";

    // With no administrator at all, a built-in fallback password is the only
    // route back in, so creation is permitted even without configuration.
    const existingAdminCount = await User.count({ where: { role: "Admin" } });
    const firstRunBootstrap = existingAdminCount === 0;

    if (forceReset) {
      logger.warn(
        "ADMIN_SEED_FORCE_RESET is enabled: managed administrator passwords will be reset on this start. Unset it once recovery is complete.",
      );
    }

    for (const config of configs) {
      try {
        const existing = await User.findOne({ where: { email: config.email } });

        if (existing) {
          if (forceReset) {
            if (!config.passwordFromEnv) {
              logger.warn(
                "Refusing to reset an administrator password to a built-in fallback value",
                { email: config.email, requiredEnvVar: config.passwordEnvVar },
              );
            } else {
              existing.password = bcrypt.hashSync(config.password, 10);
              // Invalidate outstanding tokens, as any password reset should.
              if (typeof (existing as any).tokenVersion === "number") {
                (existing as any).tokenVersion += 1;
              }
              await existing.save();
              logger.warn("Administrator password reset by explicit request", {
                email: config.email,
              });
            }
          }
          // Role, organization scope and access flags are deliberately untouched.
          await ensureAdminProfile(existing, existing.organizationId ?? null);
          continue;
        }

        if (!config.passwordFromEnv && !firstRunBootstrap) {
          logger.warn(
            "Skipping creation of a missing administrator account: no password configured",
            { email: config.email, requiredEnvVar: config.passwordEnvVar },
          );
          continue;
        }

        const organizationId = await resolveScope(config.scope);
        const created = await User.create({
          firstName: config.firstName,
          lastName: config.lastName,
          email: config.email,
          password: bcrypt.hashSync(config.password, 10),
          role: "Admin",
          organizationId,
          isAccess: true,
          otpVerified: true,
        });
        await ensureAdminProfile(created, organizationId);

        if (config.passwordFromEnv) {
          logger.info("Administrator account created", { email: config.email });
        } else {
          logger.warn(
            "Administrator account created with a built-in fallback password during first-run bootstrap. Change it immediately.",
            { email: config.email, recommendedEnvVar: config.passwordEnvVar },
          );
        }
      } catch (accountError) {
        // One bad account must not stop the others from being checked.
        logger.error("Administrator seeding failed for one account", {
          email: config.email,
          error: accountError,
        });
      }
    }
  } catch (error) {
    logger.error("Error during admin seeding:", { error });
  }
};

export default seedAdmin;
