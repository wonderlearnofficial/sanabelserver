import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";
import logger from "../config/logger";
import ImportRun, { ImportEntityType } from "../models/import-run.model";
import { recordAdminAction } from "./adminAudit";

/**
 * Records the metadata of one bulk-import submission.
 *
 * What a row means
 * ----------------
 * One row = one submitted batch, not one uploaded spreadsheet.
 *
 * The admin Import Wizard splits a chosen file into 50-row chunks and posts
 * each chunk to the entity's import endpoint separately. The server sees only
 * those chunks: a 200-row file arrives as four independent requests with
 * nothing tying them together, so four rows are written. Reporting them as four
 * "imports" would overstate activity, which is why both analytics endpoints
 * label their granularity explicitly rather than calling a row a file.
 *
 * Making a row mean one file would need an import-session identifier minted by
 * the client and carried on every chunk. That is a deliberate change to the
 * upload contract on both sides, not something to infer here — grouping by
 * "same admin, same entity, a few seconds apart" would silently merge two
 * genuinely separate uploads.
 *
 * What is stored
 * --------------
 * Counts, entity type, the acting admin and their organization scope. Never the
 * uploaded file, a row's contents, an email address or a generated password.
 *
 * Failure policy
 * --------------
 * Never throws. The imported records are already written by the time this runs;
 * losing a telemetry row must not turn a successful import into an error for
 * the operator.
 */
export const recordImportRun = async (
  req: Request,
  params: {
    entityType: ImportEntityType;
    succeeded: number;
    failed: number;
    /**
     * The school a Super Admin's batch was imported into, when it targeted
     * exactly one. Ignored for a School Admin, whose own scope always wins.
     */
    targetOrganizationId?: number | null;
  },
): Promise<void> => {
  try {
    const actingUser = (req as Request & { user?: JwtPayload }).user;
    if (!actingUser?.id) return;

    // Resolved by `checkAdmin` from the `Admins` table. `undefined` means this
    // endpoint ran without that middleware, in which case the run is recorded
    // with no organization rather than with a guessed one.
    const scope = (req as Request & { adminOrganizationId?: number | null })
      .adminOrganizationId;

    const succeeded = Math.max(0, Math.trunc(params.succeeded) || 0);
    const failed = Math.max(0, Math.trunc(params.failed) || 0);

    const run = await ImportRun.create({
      adminUserId: actingUser.id,
      organizationId: scope ?? params.targetOrganizationId ?? null,
      entityType: params.entityType,
      totalRows: succeeded + failed,
      succeeded,
      failed,
    });
    // Every import endpoint comes through here, so this is also where each
    // batch reaches the admin activity log.
    await recordAdminAction(req, {
      action: "import.batch",
      targetType: "import",
      targetId: run.id,
      targetLabel: params.entityType,
      organizationId: scope ?? params.targetOrganizationId ?? null,
      details: { entityType: params.entityType, succeeded, failed },
    });
  } catch (error) {
    logger.warn("Failed to record import run telemetry (non-fatal)", { error });
  }
};

/** Documented alongside every count these runs produce. */
export const IMPORT_RUN_GRANULARITY_NOTE =
  "Each recorded run is one submitted import batch of up to 50 rows, not one uploaded file. A single spreadsheet may therefore appear as several runs.";
