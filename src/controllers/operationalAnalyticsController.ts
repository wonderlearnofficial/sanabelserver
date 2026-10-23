import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import logger from "../config/logger";
import User from "../models/user.model";
import { getOperationalSnapshot } from "../services/operationalMetrics";
import { IMPORT_RUN_GRANULARITY_NOTE } from "../helpers/importRunRecorder";

const sql = () => User.sequelize!;
const query = async <T = any>(statement: string, replacements: Record<string, any> = {}) =>
  sql().query(statement, { replacements, type: QueryTypes.SELECT }) as Promise<T[]>;

const safeLimit = (value: unknown, fallback = 10, maximum = 50) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(1, Math.floor(parsed)))
    : fallback;
};

const resolveRange = (req: Request) => {
  const today = new Date().toISOString().slice(0, 10);
  const validDate = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
  };
  const to = validDate(req.query.to) ?? today;
  const defaultFrom = new Date(`${to}T00:00:00.000Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const from = validDate(req.query.from) ?? defaultFrom.toISOString().slice(0, 10);
  return from <= to ? { from, to } : { from: to, to: from };
};

const percentDelta = (current: unknown, previous: unknown) => {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  return previousValue > 0
    ? Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1))
    : null;
};

export const dashboard = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const limit = safeLimit(req.query.limit, 8, 20);
    const replacements = { from, to, limit };
    const [
      [today],
      recentCompletions,
      recentApprovals,
      recentAssignments,
      recentRegistrations,
      completionTrend,
      [firstCompletion],
    ] = await Promise.all([
      query(`
        SELECT
          (SELECT COUNT(*) FROM StudentTasks st
             WHERE st.completionStatus='Completed' AND st.date=UTC_DATE()) AS completionsToday,
          (SELECT COUNT(*) FROM StudentTasks st
             WHERE st.completionStatus='Completed' AND st.date=DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)) AS completionsYesterday,
          (SELECT COUNT(DISTINCT st.studentId) FROM StudentTasks st
             WHERE st.completionStatus='Completed' AND st.date=UTC_DATE()) AS activeUsersToday,
          (SELECT COUNT(DISTINCT st.studentId) FROM StudentTasks st
             WHERE st.completionStatus='Completed' AND st.date=DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)) AS activeUsersYesterday,
          (SELECT COUNT(*) FROM MissionApprovalRequests WHERE status='pending') AS pendingApprovals,
          (SELECT COUNT(*) FROM MissionApprovalRequests
             WHERE status='pending' AND createdAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)) AS pendingApprovalsOver24h,
          (SELECT COUNT(*) FROM Users WHERE DATE(createdAt)=UTC_DATE()) AS newUsersToday,
          (SELECT COUNT(*) FROM Users WHERE DATE(createdAt)=DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)) AS newUsersYesterday,
          (SELECT COUNT(*) FROM StudentTodoSources
             WHERE sourceType IN ('teacher','parent') AND DATE(createdAt)=UTC_DATE()) AS assignmentsToday,
          (SELECT COUNT(*) FROM StudentTodoSources
             WHERE sourceType IN ('teacher','parent') AND DATE(createdAt)=DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)) AS assignmentsYesterday,
          (SELECT COUNT(DISTINCT s.organizationId)
             FROM StudentTasks st JOIN Students s ON s.id=st.studentId
             WHERE st.completionStatus='Completed' AND st.date=UTC_DATE()
               AND s.organizationId IS NOT NULL) AS activeOrganizationsToday,
          (SELECT COUNT(DISTINCT s.organizationId)
             FROM StudentTasks st JOIN Students s ON s.id=st.studentId
             WHERE st.completionStatus='Completed' AND st.date=DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)
               AND s.organizationId IS NOT NULL) AS activeOrganizationsYesterday
      `),
      query(`
        SELECT st.id, st.createdAt AS occurredAt, st.date, st.completionSource,
               CONCAT_WS(' ', u.firstName, u.lastName) AS studentName,
               t.title AS missionTitle, o.name AS organizationName,
               CONCAT_WS(' ', tu.firstName, tu.lastName) AS teacherName,
               CONCAT_WS(' ', pu.firstName, pu.lastName) AS parentName
        FROM StudentTasks st
        JOIN Students s ON s.id=st.studentId
        LEFT JOIN Users u ON u.id=s.userId
        LEFT JOIN Tasks t ON t.id=st.taskId
        LEFT JOIN Organizations o ON o.id=s.organizationId
        LEFT JOIN Teachers te ON te.id=st.teacherId
        LEFT JOIN Users tu ON tu.id=te.userId
        LEFT JOIN Parents pa ON pa.id=st.parentId
        LEFT JOIN Users pu ON pu.id=pa.userId
        WHERE st.completionStatus='Completed'
        ORDER BY st.createdAt DESC, st.id DESC LIMIT :limit
      `, replacements),
      query(`
        SELECT mar.id, mar.createdAt AS occurredAt, mar.missionDate, mar.status,
               TIMESTAMPDIFF(HOUR, mar.createdAt, UTC_TIMESTAMP()) AS ageHours,
               CONCAT_WS(' ', u.firstName, u.lastName) AS studentName,
               t.title AS missionTitle, o.name AS organizationName,
               COALESCE(JSON_LENGTH(mar.parentIds), 0) AS requestedParentCount,
               COALESCE(JSON_LENGTH(mar.teacherIds), 0) AS requestedTeacherCount
        FROM MissionApprovalRequests mar
        LEFT JOIN Students s ON s.id=mar.studentId
        LEFT JOIN Users u ON u.id=s.userId
        LEFT JOIN Tasks t ON t.id=mar.missionId
        LEFT JOIN Organizations o ON o.id=s.organizationId
        ORDER BY mar.createdAt DESC, mar.id DESC LIMIT :limit
      `, replacements),
      query(`
        SELECT sts.id, sts.createdAt AS occurredAt, sts.sourceType, sti.status,
               CONCAT_WS(' ', su.firstName, su.lastName) AS studentName,
               t.title AS missionTitle, o.name AS organizationName,
               CASE WHEN sts.sourceType='teacher'
                    THEN CONCAT_WS(' ', tu.firstName, tu.lastName)
                    ELSE CONCAT_WS(' ', pu.firstName, pu.lastName) END AS assignedBy
        FROM StudentTodoSources sts
        JOIN StudentTodoItems sti ON sti.id=sts.todoItemId
        JOIN Students s ON s.id=sti.studentId
        LEFT JOIN Users su ON su.id=s.userId
        LEFT JOIN Tasks t ON t.id=sti.taskId
        LEFT JOIN Organizations o ON o.id=s.organizationId
        LEFT JOIN Teachers te ON sts.sourceType='teacher' AND te.id=sts.sourceId
        LEFT JOIN Users tu ON tu.id=te.userId
        LEFT JOIN Parents pa ON sts.sourceType='parent' AND pa.id=sts.sourceId
        LEFT JOIN Users pu ON pu.id=pa.userId
        WHERE sts.sourceType IN ('teacher','parent')
        ORDER BY sts.createdAt DESC, sts.id DESC LIMIT :limit
      `, replacements),
      query(`
        SELECT u.id, u.createdAt AS occurredAt, u.role,
               CONCAT_WS(' ', u.firstName, u.lastName) AS name,
               (u.password IS NOT NULL) AS registered,
               (u.otpVerified = 1) AS verified,
               (u.isAccess = 1) AS accessEnabled,
               CASE
                 WHEN u.role='Student' AND s.organizationId IS NULL THEN 'solo'
                 WHEN u.role='Student' AND s.organizationId IS NOT NULL THEN 'school_student'
                 ELSE LOWER(u.role)
               END AS segment,
               o.name AS organizationName
        FROM Users u
        LEFT JOIN Students s ON u.role='Student' AND s.userId=u.id
        LEFT JOIN Teachers te ON u.role='Teacher' AND te.userId=u.id
        LEFT JOIN Admins a ON u.role='Admin' AND a.userId=u.id
        LEFT JOIN Organizations o ON o.id=COALESCE(s.organizationId, te.organizationId, a.organizationId)
        ORDER BY u.createdAt DESC, u.id DESC LIMIT :limit
      `, replacements),
      query(`
        SELECT st.date, COUNT(*) AS completions, COUNT(DISTINCT st.studentId) AS activeUsers
        FROM StudentTasks st
        WHERE st.completionStatus='Completed' AND st.date BETWEEN :from AND :to
        GROUP BY st.date ORDER BY st.date ASC
      `, replacements),
      query(`SELECT MIN(date) AS firstCompletionDate FROM StudentTasks WHERE completionStatus='Completed'`),
    ]);

    const kpi = (value: unknown, previous: unknown) => ({
      value: Number(value || 0),
      previousValue: Number(previous || 0),
      deltaPercent: percentDelta(value, previous),
    });

    return res.status(200).json({
      data: {
        today: {
          activeUsers: kpi(today.activeUsersToday, today.activeUsersYesterday),
          completions: kpi(today.completionsToday, today.completionsYesterday),
          pendingApprovals: {
            value: Number(today.pendingApprovals || 0),
            olderThan24Hours: Number(today.pendingApprovalsOver24h || 0),
            deltaPercent: null,
          },
          newUsers: kpi(today.newUsersToday, today.newUsersYesterday),
          assignments: kpi(today.assignmentsToday, today.assignmentsYesterday),
          activeOrganizations: kpi(today.activeOrganizationsToday, today.activeOrganizationsYesterday),
        },
        recentCompletions,
        recentApprovals,
        recentAssignments,
        recentRegistrations,
        completionTrend,
        alerts: [
          ...(Number(today.pendingApprovalsOver24h || 0) > 0
            ? [{ type: "old_pending_approvals", severity: "warning", count: Number(today.pendingApprovalsOver24h) }]
            : []),
        ],
        range: { from, to },
        dataAvailability: {
          completionsFrom: firstCompletion?.firstCompletionDate ?? null,
          economyHistory: false,
          messageKey: "analytics.forwardLookingMetricsNotice",
        },
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("analytics.dashboard failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const emails = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const limit = safeLimit(req.query.limit, 20, 100);
    const replacements = { from, to, limit };
    const [[totals], byPurpose, failureTrend, failureCategories, recentFailures, [availability]] = await Promise.all([
      query(`
        SELECT
          SUM(status IN ('send_accepted','delivered','bounced') AND DATE(createdAt)=UTC_DATE()) AS acceptedToday,
          SUM(status='send_failed' AND DATE(createdAt)=UTC_DATE()) AS failedToday,
          SUM(status='send_failed' AND createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)) AS failedLastHour,
          SUM(status IN ('send_accepted','delivered','bounced')) AS acceptedInRange,
          SUM(status='send_failed') AS failedInRange,
          SUM(status='delivered') AS deliveredInRange,
          SUM(status='bounced') AS bouncedInRange
        FROM EmailEvents WHERE DATE(createdAt) BETWEEN :from AND :to
      `, replacements),
      query(`
        SELECT purpose,
               SUM(status IN ('send_accepted','delivered','bounced')) AS accepted,
               SUM(status='send_failed') AS failed
        FROM EmailEvents WHERE DATE(createdAt) BETWEEN :from AND :to
        GROUP BY purpose ORDER BY accepted DESC, purpose ASC
      `, replacements),
      query(`
        SELECT DATE(createdAt) AS date, SUM(status='send_failed') AS failures
        FROM EmailEvents WHERE DATE(createdAt) BETWEEN :from AND :to
        GROUP BY DATE(createdAt) ORDER BY date ASC
      `, replacements),
      query(`
        SELECT COALESCE(failureCategory, 'unknown') AS category, COUNT(*) AS failures
        FROM EmailEvents
        WHERE status='send_failed' AND DATE(createdAt) BETWEEN :from AND :to
        GROUP BY category ORDER BY failures DESC
      `, replacements),
      query(`
        SELECT id, userId, purpose, provider, failureCode, failureCategory, createdAt
        FROM EmailEvents WHERE status='send_failed'
        ORDER BY createdAt DESC, id DESC LIMIT :limit
      `, replacements),
      query(`SELECT MIN(createdAt) AS dataAvailableFrom FROM EmailEvents`),
    ]);
    const delivered = Number(totals.deliveredInRange || 0);
    const bounced = Number(totals.bouncedInRange || 0);
    const deliveryResolved = delivered + bounced;

    return res.status(200).json({
      data: {
        totals: {
          acceptedToday: Number(totals.acceptedToday || 0),
          failedToday: Number(totals.failedToday || 0),
          failedLastHour: Number(totals.failedLastHour || 0),
          acceptedInRange: Number(totals.acceptedInRange || 0),
          failedInRange: Number(totals.failedInRange || 0),
          deliveryRate: deliveryResolved > 0
            ? Number(((delivered / deliveryResolved) * 100).toFixed(1))
            : null,
        },
        deliveryTrackingAvailable: deliveryResolved > 0,
        terminology: {
          accepted: "Provider accepted the send request; inbox delivery is not proven.",
          delivered: "Recorded only after a verified provider delivery event.",
          failed: "The provider or configuration rejected the send attempt.",
        },
        byPurpose,
        failureTrend,
        failureCategories,
        recentFailures,
        alerts: Number(totals.failedLastHour || 0) >= 5
          ? [{ type: "email_failure_spike", severity: "warning", count: Number(totals.failedLastHour) }]
          : [],
        dataAvailableFrom: availability?.dataAvailableFrom ?? null,
        historicalDataAvailable: false,
        range: { from, to },
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("analytics.emails failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const activity = async (req: Request, res: Response) => {
  try {
    const limit = safeLimit(req.query.limit, 30, 100);
    const rows = await query(`
      SELECT * FROM (
        SELECT CONCAT('completion:', st.id) AS id, 'mission_completed' AS type,
               st.createdAt AS occurredAt, CONCAT_WS(' ', u.firstName, u.lastName) AS subject,
               t.title AS entity, o.name AS organization, st.completionSource AS source, 'completed' AS status
        FROM StudentTasks st
        JOIN Students s ON s.id=st.studentId LEFT JOIN Users u ON u.id=s.userId
        LEFT JOIN Tasks t ON t.id=st.taskId LEFT JOIN Organizations o ON o.id=s.organizationId
        WHERE st.completionStatus='Completed'
        UNION ALL
        SELECT CONCAT('approval:', mar.id), 'approval_requested', mar.createdAt,
               CONCAT_WS(' ', u.firstName, u.lastName), t.title, o.name, mar.approvedByType, mar.status
        FROM MissionApprovalRequests mar
        LEFT JOIN Students s ON s.id=mar.studentId LEFT JOIN Users u ON u.id=s.userId
        LEFT JOIN Tasks t ON t.id=mar.missionId LEFT JOIN Organizations o ON o.id=s.organizationId
        UNION ALL
        SELECT CONCAT('registration:', u.id), 'user_registered', u.createdAt,
               CONCAT_WS(' ', u.firstName, u.lastName), u.role, o.name, LOWER(u.role),
               CASE WHEN u.otpVerified=1 THEN 'verified' WHEN u.password IS NOT NULL THEN 'registered' ELSE 'incomplete' END
        FROM Users u
        LEFT JOIN Students s ON u.role='Student' AND s.userId=u.id
        LEFT JOIN Teachers te ON u.role='Teacher' AND te.userId=u.id
        LEFT JOIN Admins a ON u.role='Admin' AND a.userId=u.id
        LEFT JOIN Organizations o ON o.id=COALESCE(s.organizationId, te.organizationId, a.organizationId)
        UNION ALL
        SELECT CONCAT('assignment:', sts.id), 'mission_assigned', sts.createdAt,
               CONCAT_WS(' ', u.firstName, u.lastName), t.title, o.name, sts.sourceType, sti.status
        FROM StudentTodoSources sts JOIN StudentTodoItems sti ON sti.id=sts.todoItemId
        JOIN Students s ON s.id=sti.studentId LEFT JOIN Users u ON u.id=s.userId
        LEFT JOIN Tasks t ON t.id=sti.taskId LEFT JOIN Organizations o ON o.id=s.organizationId
        WHERE sts.sourceType IN ('teacher','parent')
      ) activity
      ORDER BY occurredAt DESC, id DESC LIMIT :limit
    `, { limit });
    return res.status(200).json({ data: rows, generatedAt: new Date().toISOString() });
  } catch (error) {
    logger.error("analytics.activity failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const dataQuality = async (_req: Request, res: Response) => {
  try {
    const [[counts], organizationsWithoutTeachers] = await Promise.all([
      query(`
        SELECT
          (SELECT COUNT(*) FROM Students WHERE userId IS NULL) AS studentsWithoutUser,
          (SELECT COUNT(*) FROM Users u WHERE u.role='Student' AND NOT EXISTS
             (SELECT 1 FROM Students s WHERE s.userId=u.id)) AS studentUsersWithoutProfile,
          (SELECT COUNT(*) FROM Students WHERE classId IS NOT NULL AND organizationId IS NULL) AS classedStudentsWithoutOrganization,
          (SELECT COUNT(*) FROM Students WHERE classId IS NULL AND organizationId IS NOT NULL) AS unclassedStudentsWithOrganization,
          (SELECT COUNT(*) FROM Classes WHERE organizationId IS NULL) AS classesWithoutOrganization,
          (SELECT COUNT(*) FROM Teachers WHERE organizationId IS NULL) AS teachersWithoutOrganization
      `),
      query(`
        SELECT o.id, o.name FROM Organizations o
        WHERE NOT EXISTS (SELECT 1 FROM Teachers t WHERE t.organizationId=o.id)
        ORDER BY o.name ASC LIMIT 50
      `),
    ]);
    return res.status(200).json({
      data: {
        counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value || 0)])),
        organizationsWithoutTeachers,
        generatedFromCurrentState: true,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("analytics.dataQuality failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Global import telemetry for a Super Admin.
//
// This endpoint previously reported `available: false` — correct when it was
// written, because nothing recorded an import. `ImportRuns` now does, so the
// endpoint reads it. What has not changed is the honesty: rows exist only from
// the instrumentation cutover onward, `dataAvailableFrom` reports the first one,
// and nothing before it is reconstructed or estimated.
//
// `available` stays false until a run has actually been recorded, so an empty
// table reads as "no measurements yet" rather than as "zero imports happened".
// The org-scoped equivalent for a School Admin is `GET /admin/import-analytics`.
export const imports = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const [[totals], byEntity, recent] = await Promise.all([
      query(`
        SELECT
          COUNT(*)            AS runs,
          SUM(totalRows)      AS totalRows,
          SUM(succeeded)      AS succeeded,
          SUM(failed)         AS failed,
          MIN(createdAt)      AS firstRunAt
        FROM ImportRuns
      `),
      query(`
        SELECT entityType,
               COUNT(*)       AS runs,
               SUM(totalRows) AS totalRows,
               SUM(succeeded) AS succeeded,
               SUM(failed)    AS failed
        FROM ImportRuns
        WHERE DATE(createdAt) BETWEEN :from AND :to
        GROUP BY entityType
        ORDER BY runs DESC
      `, { from, to }),
      query(`
        SELECT r.id, r.entityType, r.totalRows, r.succeeded, r.failed, r.createdAt,
               o.name AS organizationName
        FROM ImportRuns r
        LEFT JOIN Organizations o ON o.id = r.organizationId
        ORDER BY r.createdAt DESC
        LIMIT :limit
      `, { limit: safeLimit(req.query.limit, 10, 50) }),
    ]);

    const runs = Number(totals?.runs || 0);

    return res.status(200).json({
      data: {
        available: runs > 0,
        dataAvailableFrom: totals?.firstRunAt ?? null,
        range: { from, to },
        totals: {
          runs,
          totalRows: Number(totals?.totalRows || 0),
          succeeded: Number(totals?.succeeded || 0),
          failed: Number(totals?.failed || 0),
        },
        byEntity: byEntity.map((row: any) => ({
          entityType: row.entityType,
          runs: Number(row.runs || 0),
          totalRows: Number(row.totalRows || 0),
          succeeded: Number(row.succeeded || 0),
          failed: Number(row.failed || 0),
        })),
        recentRuns: recent,
        granularity: "batch" as const,
        note: `${IMPORT_RUN_GRANULARITY_NOTE} Runs are recorded from the ImportRuns instrumentation cutover onward; imports performed before it are not represented and are not estimated.`,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("analytics.imports failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Server, database and API health for a Super Admin.
//
// Everything here is either measured live or a bounded in-process aggregate.
// Deliberately absent, because exposing it would leak more than it explains:
// the connection string, the database host or user, any credential, request
// headers, tokens, an environment dump, or raw SQL.
export const systemHealth = async (req: Request, res: Response) => {
  const started = Date.now();
  let databaseStatus: "connected" | "unavailable" = "connected";
  let databaseVersion: string | null = null;
  let appliedMigrations: number | null = null;
  let latestMigration: string | null = null;

  try {
    // Reachability and round-trip latency in one trivial query.
    await sql().query("SELECT 1");

    // Engine version matters operationally: local development runs MySQL
    // 8.0.x while production runs 9.4.x, so behaviour proven on one does not
    // automatically hold on the other. The version string alone identifies no
    // host and no credential.
    const [versionRow] = await query<{ version: string }>("SELECT VERSION() AS version");
    databaseVersion = versionRow?.version ?? null;

    // Migration state, as a count and the newest name. Names are already in
    // the repository, so this reveals nothing new — it answers "is this
    // server running the schema I think it is".
    const [migrationRow] = await query<{ applied: number; latest: string | null }>(
      "SELECT COUNT(*) AS applied, MAX(name) AS latest FROM SequelizeMeta",
    );
    appliedMigrations = Number(migrationRow?.applied ?? 0);
    latestMigration = migrationRow?.latest ?? null;
  } catch (error) {
    databaseStatus = "unavailable";
    logger.error("analytics.systemHealth database check failed", { error });
  }

  const snapshot = getOperationalSnapshot(safeLimit(req.query.windowMinutes, 60, 180));
  const memory = process.memoryUsage();

  return res.status(200).json({
    data: {
      api: "online",
      database: databaseStatus,
      databaseLatencyMs: Date.now() - started,
      databaseVersion,
      appliedMigrations,
      latestMigration,
      // Seconds since this process started. Not platform uptime: a restart or
      // a second instance resets it, which is what `coverage` below says.
      processUptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      memory: {
        heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(1)),
        rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
      },
      ...snapshot,
      note: "Request metrics and process figures are bounded in-memory aggregates for this server process; they reset on restart, cover only the instance that answered this request, and are not historical logs.",
    },
    generatedAt: new Date().toISOString(),
  });
};
