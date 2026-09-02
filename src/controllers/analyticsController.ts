import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import User from "../models/user.model";
import logger from "../config/logger";
import { calculateLevel } from "../helpers/levelCalculator";

// Super-Admin-only analytics. Every handler here assumes requireSuperAdmin has
// already run; none of them accept an organization scope from the caller's
// identity, because a super admin is global by definition.
//
// Rules this module follows deliberately:
//  - All aggregation happens in SQL. Nothing loads a full table into Node.
//  - Only metrics the current data can answer truthfully are returned. Where a
//    metric has no source of truth yet (currency spend, tree growth events,
//    purchases) it is reported as unavailable rather than as a confident zero.
//  - Student level is always derived from XP via the canonical progression, never
//    read from the dead Students.level column.

const sql = () => User.sequelize!;

const query = async <T = any>(statement: string, replacements: Record<string, any> = {}) =>
  sql().query(statement, { replacements, type: QueryTypes.SELECT }) as Promise<T[]>;

/** Inclusive date window. Defaults to the last 30 days ending today (UTC). */
const resolveRange = (req: Request) => {
  const today = new Date().toISOString().slice(0, 10);
  const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const to = isDate(req.query.to) ? String(req.query.to) : today;
  const fromDefault = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const from = isDate(req.query.from) ? String(req.query.from) : fromDefault;
  return from <= to ? { from, to } : { from: to, to: from };
};

const parsePaging = (req: Request) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
};

const optionalId = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Metrics with no truthful source in the current schema. Listed explicitly so
 * the UI can state why a panel is empty instead of rendering a zero that reads
 * as "this never happens".
 */
const UNAVAILABLE_METRICS = {
  xpIssued: "StudentTasks stores no reward snapshot; any figure would be recomputed from today's mission values, not what was actually awarded.",
  snabelIssued: "Same as xpIssued — no per-completion reward snapshot exists.",
  snabelSpent: "No transaction record exists for shop spending.",
  waterPurchases: "No purchase history table exists.",
  fertilizerPurchases: "No purchase history table exists.",
  treeGrowthEvents: "Only the current tree stage is stored; growth events are not recorded.",
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const overview = async (req: Request, res: Response) => {
  try {
    const [[people], [missions], [approvals], [firstCompletion]] = await Promise.all([
      query(`
        SELECT
          (SELECT COUNT(*) FROM Users)                                                       AS totalUsers,
          (SELECT COUNT(*) FROM Students WHERE classId IS NULL)                              AS soloUsers,
          (SELECT COUNT(*) FROM Students WHERE classId IS NOT NULL)                          AS schoolStudents,
          (SELECT COUNT(*) FROM Teachers)                                                    AS teachers,
          (SELECT COUNT(*) FROM Parents)                                                     AS parents,
          (SELECT COUNT(*) FROM Admins WHERE organizationId IS NOT NULL)                     AS schoolAdmins,
          (SELECT COUNT(*) FROM Admins WHERE organizationId IS NULL)                         AS superAdmins,
          (SELECT COUNT(*) FROM Organizations)                                               AS organizations,
          (SELECT COUNT(*) FROM Classes)                                                     AS classes
      `),
      query(`
        SELECT
          SUM(date = CURDATE())                                     AS completionsToday,
          SUM(date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY))          AS completionsThisWeek,
          SUM(date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY))         AS completionsThisMonth,
          COUNT(*)                                                  AS completionsAllTime,
          COUNT(DISTINCT CASE WHEN date = CURDATE() THEN studentId END) AS activeStudentsToday
        FROM StudentTasks
        WHERE completionStatus = 'Completed'
      `),
      query(`
        SELECT
          SUM(status = 'pending')                                    AS pending,
          SUM(status = 'approved')                                   AS approved,
          SUM(status = 'denied')                                     AS denied,
          SUM(status = 'approved' AND DATE(approvedAt) = CURDATE())  AS approvedToday,
          SUM(status = 'denied'   AND DATE(approvedAt) = CURDATE())  AS deniedToday
        FROM MissionApprovalRequests
      `),
      query(`SELECT MIN(date) AS firstCompletionDate FROM StudentTasks WHERE completionStatus='Completed'`),
    ]);

    const approvedCount = Number(approvals.approved || 0);
    const deniedCount = Number(approvals.denied || 0);
    const resolved = approvedCount + deniedCount;

    return res.status(200).json({
      data: {
        people: {
          totalUsers: Number(people.totalUsers || 0),
          soloUsers: Number(people.soloUsers || 0),
          schoolStudents: Number(people.schoolStudents || 0),
          teachers: Number(people.teachers || 0),
          parents: Number(people.parents || 0),
          schoolAdmins: Number(people.schoolAdmins || 0),
          superAdmins: Number(people.superAdmins || 0),
          organizations: Number(people.organizations || 0),
          classes: Number(people.classes || 0),
        },
        missions: {
          completionsToday: Number(missions.completionsToday || 0),
          completionsThisWeek: Number(missions.completionsThisWeek || 0),
          completionsThisMonth: Number(missions.completionsThisMonth || 0),
          completionsAllTime: Number(missions.completionsAllTime || 0),
          activeStudentsToday: Number(missions.activeStudentsToday || 0),
        },
        approvals: {
          pending: Number(approvals.pending || 0),
          approved: approvedCount,
          denied: deniedCount,
          approvedToday: Number(approvals.approvedToday || 0),
          deniedToday: Number(approvals.deniedToday || 0),
          // Null, not 0, when nothing has ever been resolved — a 0% rate would
          // read as "requests get rejected", which is not what the data says.
          approvalRate: resolved > 0 ? Number(((approvedCount / resolved) * 100).toFixed(1)) : null,
          denialRate: resolved > 0 ? Number(((deniedCount / resolved) * 100).toFixed(1)) : null,
          resolvedTotal: resolved,
        },
        dataAvailableFrom: firstCompletion?.firstCompletionDate ?? null,
        unavailableMetrics: UNAVAILABLE_METRICS,
      },
    });
  } catch (error) {
    logger.error("analytics.overview failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Completions (paginated table: who completed what)
// ---------------------------------------------------------------------------

const completions = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const { page, limit, offset } = parsePaging(req);
    const search = typeof req.query.search === "string" && req.query.search.trim()
      ? `%${req.query.search.trim()}%`
      : null;
    const organizationId = optionalId(req.query.organizationId);
    const classId = optionalId(req.query.classId);
    const taskId = optionalId(req.query.taskId);
    const categoryId = optionalId(req.query.categoryId);
    const source = typeof req.query.source === "string" && req.query.source ? req.query.source : null;

    const where = `
      WHERE st.completionStatus = 'Completed'
        AND st.date BETWEEN :from AND :to
        AND (:organizationId IS NULL OR s.organizationId = :organizationId)
        AND (:classId        IS NULL OR s.classId        = :classId)
        AND (:taskId         IS NULL OR st.taskId        = :taskId)
        AND (:categoryId     IS NULL OR t.categoryId     = :categoryId)
        AND (:source         IS NULL OR st.completionSource = :source)
        AND (:search IS NULL OR CONCAT_WS(' ', u.firstName, u.lastName, u.email, t.title) LIKE :search)
    `;
    const replacements = { from, to, organizationId, classId, taskId, categoryId, source, search, limit, offset };

    const [rows, [countRow]] = await Promise.all([
      query(`
        SELECT st.id, st.date, st.createdAt AS completedAt, st.completionSource,
               s.id AS studentId, s.classId, s.organizationId, s.xp,
               u.firstName, u.lastName, u.email,
               CASE WHEN s.classId IS NULL THEN 'solo' ELSE 'school' END AS studentType,
               o.name AS organizationName, c.classname AS className,
               t.id AS taskId, t.title AS missionTitle, tc.title AS categoryTitle,
               st.teacherId, st.parentId,
               tu.firstName AS confirmedByTeacherFirstName, tu.lastName AS confirmedByTeacherLastName,
               pu.firstName AS confirmedByParentFirstName,  pu.lastName AS confirmedByParentLastName
        FROM StudentTasks st
        JOIN Students s        ON s.id = st.studentId
        LEFT JOIN Users u      ON u.id = s.userId
        LEFT JOIN Organizations o ON o.id = s.organizationId
        LEFT JOIN Classes c    ON c.id = s.classId
        LEFT JOIN Tasks t      ON t.id = st.taskId
        LEFT JOIN TaskCategories tc ON tc.id = t.categoryId
        LEFT JOIN Teachers te  ON te.id = st.teacherId
        LEFT JOIN Users tu     ON tu.id = te.userId
        LEFT JOIN Parents pa   ON pa.id = st.parentId
        LEFT JOIN Users pu     ON pu.id = pa.userId
        ${where}
        ORDER BY st.date DESC, st.id DESC
        LIMIT :limit OFFSET :offset
      `, replacements),
      query(`
        SELECT COUNT(*) AS total
        FROM StudentTasks st
        JOIN Students s   ON s.id = st.studentId
        LEFT JOIN Users u ON u.id = s.userId
        LEFT JOIN Tasks t ON t.id = st.taskId
        ${where}
      `, replacements),
    ]);

    return res.status(200).json({
      data: rows.map((row) => ({
        id: row.id,
        date: row.date,
        completedAt: row.completedAt,
        completionSource: row.completionSource,
        student: {
          id: row.studentId,
          name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null,
          email: row.email ?? null,
          type: row.studentType,
          // Derived from XP — never Students.level, which is dead state.
          level: calculateLevel(Number(row.xp || 0)).level,
        },
        organization: row.organizationName ?? null,
        className: row.className ?? null,
        mission: { id: row.taskId, title: row.missionTitle ?? null, category: row.categoryTitle ?? null },
        confirmedBy: row.teacherId
          ? { type: "teacher", name: `${row.confirmedByTeacherFirstName ?? ""} ${row.confirmedByTeacherLastName ?? ""}`.trim() || null }
          : row.parentId
            ? { type: "parent", name: `${row.confirmedByParentFirstName ?? ""} ${row.confirmedByParentLastName ?? ""}`.trim() || null }
            : null,
      })),
      total: Number(countRow?.total || 0),
      page,
      limit,
      range: { from, to },
    });
  } catch (error) {
    logger.error("analytics.completions failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

const missions = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const organizationId = optionalId(req.query.organizationId);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const replacements = { from, to, organizationId, limit };

    const topFor = (clause: string) => `
      SELECT t.id, t.title, tc.title AS category, COUNT(*) AS completions
      FROM StudentTasks st
      JOIN Students s ON s.id = st.studentId
      LEFT JOIN Tasks t ON t.id = st.taskId
      LEFT JOIN TaskCategories tc ON tc.id = t.categoryId
      WHERE st.completionStatus='Completed' AND ${clause}
        AND (:organizationId IS NULL OR s.organizationId = :organizationId)
      GROUP BY t.id, t.title, tc.title
      ORDER BY completions DESC, t.id ASC
      LIMIT :limit
    `;

    const [today, week, month, allTime, byCategory, bySource, trend] = await Promise.all([
      query(topFor("st.date = CURDATE()"), replacements),
      query(topFor("st.date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)"), replacements),
      query(topFor("st.date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)"), replacements),
      query(topFor("1=1"), replacements),
      query(`
        SELECT COALESCE(tc.title, 'Uncategorised') AS category, COUNT(*) AS completions
        FROM StudentTasks st
        JOIN Students s ON s.id = st.studentId
        LEFT JOIN Tasks t ON t.id = st.taskId
        LEFT JOIN TaskCategories tc ON tc.id = t.categoryId
        WHERE st.completionStatus='Completed' AND st.date BETWEEN :from AND :to
          AND (:organizationId IS NULL OR s.organizationId = :organizationId)
        GROUP BY category ORDER BY completions DESC
      `, replacements),
      query(`
        SELECT COALESCE(st.completionSource, 'unrecorded') AS source, COUNT(*) AS completions
        FROM StudentTasks st
        JOIN Students s ON s.id = st.studentId
        WHERE st.completionStatus='Completed' AND st.date BETWEEN :from AND :to
          AND (:organizationId IS NULL OR s.organizationId = :organizationId)
        GROUP BY source ORDER BY completions DESC
      `, replacements),
      query(`
        SELECT st.date, COUNT(*) AS completions, COUNT(DISTINCT st.studentId) AS students
        FROM StudentTasks st
        JOIN Students s ON s.id = st.studentId
        WHERE st.completionStatus='Completed' AND st.date BETWEEN :from AND :to
          AND (:organizationId IS NULL OR s.organizationId = :organizationId)
        GROUP BY st.date ORDER BY st.date ASC
      `, replacements),
    ]);

    return res.status(200).json({
      data: {
        top: { today, week, month, allTime },
        byCategory,
        bySource,
        trend,
        range: { from, to },
        note: "Completion counts are exact. Reward totals per mission are not reported — see unavailableMetrics on /overview.",
      },
    });
  } catch (error) {
    logger.error("analytics.missions failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Users / engagement
// ---------------------------------------------------------------------------

const users = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const replacements = { from, to, limit };

    const [daily, mostActive, [averages], [split], inactive] = await Promise.all([
      query(`
        SELECT date, COUNT(DISTINCT studentId) AS uniqueStudents, COUNT(*) AS completions
        FROM StudentTasks
        WHERE completionStatus='Completed' AND date BETWEEN :from AND :to
        GROUP BY date ORDER BY date ASC
      `, replacements),
      query(`
        SELECT s.id AS studentId, u.firstName, u.lastName, s.xp,
               CASE WHEN s.classId IS NULL THEN 'solo' ELSE 'school' END AS studentType,
               COUNT(*) AS completions
        FROM StudentTasks st
        JOIN Students s   ON s.id = st.studentId
        LEFT JOIN Users u ON u.id = s.userId
        WHERE st.completionStatus='Completed' AND st.date BETWEEN :from AND :to
        GROUP BY s.id, u.firstName, u.lastName, s.xp, studentType
        ORDER BY completions DESC, s.id ASC
        LIMIT :limit
      `, replacements),
      query(`
        SELECT COUNT(*) AS completions, COUNT(DISTINCT studentId) AS activeStudents
        FROM StudentTasks
        WHERE completionStatus='Completed' AND date BETWEEN :from AND :to
      `, replacements),
      query(`
        SELECT
          SUM(CASE WHEN s.classId IS NULL     THEN 1 ELSE 0 END) AS soloCompletions,
          SUM(CASE WHEN s.classId IS NOT NULL THEN 1 ELSE 0 END) AS schoolCompletions,
          COUNT(DISTINCT CASE WHEN s.classId IS NULL     THEN s.id END) AS soloActiveStudents,
          COUNT(DISTINCT CASE WHEN s.classId IS NOT NULL THEN s.id END) AS schoolActiveStudents
        FROM StudentTasks st
        JOIN Students s ON s.id = st.studentId
        WHERE st.completionStatus='Completed' AND st.date BETWEEN :from AND :to
      `, replacements),
      query(`
        SELECT s.id AS studentId, u.firstName, u.lastName, u.email,
               CASE WHEN s.classId IS NULL THEN 'solo' ELSE 'school' END AS studentType,
               (SELECT MAX(date) FROM StudentTasks x WHERE x.studentId=s.id AND x.completionStatus='Completed') AS lastCompletionDate
        FROM Students s
        LEFT JOIN Users u ON u.id = s.userId
        WHERE NOT EXISTS (
          SELECT 1 FROM StudentTasks st
          WHERE st.studentId = s.id AND st.completionStatus='Completed'
            AND st.date BETWEEN :from AND :to
        )
        ORDER BY lastCompletionDate IS NULL DESC, lastCompletionDate ASC, s.id ASC
        LIMIT :limit
      `, replacements),
    ]);

    const activeStudents = Number(averages?.activeStudents || 0);
    return res.status(200).json({
      data: {
        dailyUniqueStudents: daily,
        mostActiveStudents: mostActive.map((row) => ({
          ...row,
          level: calculateLevel(Number(row.xp || 0)).level,
        })),
        averageCompletionsPerActiveStudent:
          activeStudents > 0
            ? Number((Number(averages.completions || 0) / activeStudents).toFixed(2))
            : null,
        activeStudents,
        soloVsSchool: split,
        inactiveInRange: inactive,
        range: { from, to },
        note: "Engagement is measured by mission completions. Login/session events are not recorded, so session-based activity is not reported.",
      },
    });
  } catch (error) {
    logger.error("analytics.users failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

const organizations = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const rows = await query(`
      SELECT o.id, o.name, o.type,
        (SELECT COUNT(*) FROM Students s WHERE s.organizationId=o.id)                          AS students,
        (SELECT COUNT(*) FROM Teachers t WHERE t.organizationId=o.id)                          AS teachers,
        (SELECT COUNT(*) FROM Classes  c WHERE c.organizationId=o.id)                          AS classes,
        (SELECT COUNT(*) FROM Admins   a WHERE a.organizationId=o.id)                          AS schoolAdmins,
        (SELECT COUNT(DISTINCT s2.ParentId) FROM Students s2
           WHERE s2.organizationId=o.id AND s2.ParentId IS NOT NULL)                           AS linkedParents,
        (SELECT COUNT(*) FROM StudentTasks st JOIN Students s3 ON s3.id=st.studentId
           WHERE s3.organizationId=o.id AND st.completionStatus='Completed'
             AND st.date BETWEEN :from AND :to)                                                AS completionsInRange,
        (SELECT COUNT(DISTINCT st.studentId) FROM StudentTasks st JOIN Students s4 ON s4.id=st.studentId
           WHERE s4.organizationId=o.id AND st.completionStatus='Completed'
             AND st.date BETWEEN :from AND :to)                                                AS activeStudentsInRange,
        (SELECT COUNT(*) FROM MissionApprovalRequests mar JOIN Students s5 ON s5.id=mar.studentId
           WHERE s5.organizationId=o.id AND mar.status='pending')                              AS pendingApprovals,
        (SELECT COUNT(*) FROM MissionApprovalRequests mar2 JOIN Students s6 ON s6.id=mar2.studentId
           WHERE s6.organizationId=o.id AND mar2.status='approved')                            AS approvedTotal,
        (SELECT COUNT(*) FROM MissionApprovalRequests mar3 JOIN Students s7 ON s7.id=mar3.studentId
           WHERE s7.organizationId=o.id AND mar3.status='denied')                              AS deniedTotal
      FROM Organizations o
      ORDER BY o.name ASC
    `, { from, to });

    return res.status(200).json({
      data: rows.map((row) => {
        const resolved = Number(row.approvedTotal || 0) + Number(row.deniedTotal || 0);
        return {
          ...row,
          approvalRate: resolved > 0 ? Number(((Number(row.approvedTotal) / resolved) * 100).toFixed(1)) : null,
        };
      }),
      range: { from, to },
    });
  } catch (error) {
    logger.error("analytics.organizations failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

const approvals = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const [[totals], byType, oldestPending, slowest] = await Promise.all([
      query(`
        SELECT
          SUM(status='pending')  AS pending,
          SUM(status='approved') AS approved,
          SUM(status='denied')   AS denied,
          COUNT(*)               AS total,
          AVG(CASE WHEN status<>'pending' AND approvedAt IS NOT NULL
                   THEN TIMESTAMPDIFF(MINUTE, createdAt, approvedAt) END) AS avgResolutionMinutes
        FROM MissionApprovalRequests
      `),
      query(`
        SELECT COALESCE(approvedByType,'unresolved') AS approverType,
               SUM(status='approved') AS approved,
               SUM(status='denied')   AS denied
        FROM MissionApprovalRequests
        GROUP BY approverType ORDER BY approved DESC
      `),
      query(`
        SELECT mar.id, mar.studentId, mar.missionDate, mar.createdAt,
               TIMESTAMPDIFF(HOUR, mar.createdAt, NOW()) AS pendingHours,
               t.title AS missionTitle, u.firstName, u.lastName, o.name AS organizationName
        FROM MissionApprovalRequests mar
        LEFT JOIN Tasks t    ON t.id = mar.missionId
        LEFT JOIN Students s ON s.id = mar.studentId
        LEFT JOIN Users u    ON u.id = s.userId
        LEFT JOIN Organizations o ON o.id = s.organizationId
        WHERE mar.status='pending'
        ORDER BY mar.createdAt ASC
        LIMIT :limit
      `, { limit }),
      query(`
        SELECT o.id, o.name,
               AVG(TIMESTAMPDIFF(MINUTE, mar.createdAt, mar.approvedAt)) AS avgResolutionMinutes,
               COUNT(*) AS resolved
        FROM MissionApprovalRequests mar
        JOIN Students s ON s.id = mar.studentId
        JOIN Organizations o ON o.id = s.organizationId
        WHERE mar.status <> 'pending' AND mar.approvedAt IS NOT NULL
        GROUP BY o.id, o.name
        ORDER BY avgResolutionMinutes DESC
        LIMIT :limit
      `, { limit }),
    ]);

    const approved = Number(totals?.approved || 0);
    const denied = Number(totals?.denied || 0);
    const resolved = approved + denied;
    const teacherRow = byType.find((row) => row.approverType === "teacher");
    const parentRow = byType.find((row) => row.approverType === "parent");

    return res.status(200).json({
      data: {
        totals: {
          pending: Number(totals?.pending || 0),
          approved,
          denied,
          total: Number(totals?.total || 0),
          approvalRate: resolved > 0 ? Number(((approved / resolved) * 100).toFixed(1)) : null,
          denialRate: resolved > 0 ? Number(((denied / resolved) * 100).toFixed(1)) : null,
          avgResolutionMinutes: totals?.avgResolutionMinutes != null
            ? Number(Number(totals.avgResolutionMinutes).toFixed(1))
            : null,
        },
        byApproverType: byType,
        teacherApprovals: Number(teacherRow?.approved || 0),
        parentApprovals: Number(parentRow?.approved || 0),
        oldestPending,
        slowestOrganizations: slowest,
        // Stated explicitly so a zero is read as "no data yet", not "broken".
        observations: {
          parentApprovalsObserved: Number(parentRow?.approved || 0) > 0,
          denialsObserved: denied > 0,
        },
      },
    });
  } catch (error) {
    logger.error("analytics.approvals failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Assignments / To-Do
// ---------------------------------------------------------------------------

const assignments = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveRange(req);
    const [[status], bySource, [durations]] = await Promise.all([
      query(`
        SELECT
          SUM(status='todo')             AS active,
          SUM(status='pending_approval') AS pendingApproval,
          SUM(status='completed')        AS completed,
          COUNT(*)                       AS total
        FROM StudentTodoDays
        WHERE missionDate BETWEEN :from AND :to
      `, { from, to }),
      query(`
        SELECT sts.sourceType,
               COUNT(DISTINCT d.id)           AS items,
               SUM(d.status='completed')      AS completedItems
        FROM StudentTodoSources sts
        JOIN StudentTodoDays d ON d.studentTodoItemId = sts.todoItemId
        WHERE d.missionDate BETWEEN :from AND :to
        GROUP BY sts.sourceType
        ORDER BY items DESC
      `, { from, to }),
      query(`
        SELECT AVG(TIMESTAMPDIFF(MINUTE, createdAt, completedAt)) AS avgAssignmentToCompletionMinutes,
               COUNT(*) AS sample
        FROM StudentTodoDays
        WHERE status='completed' AND completedAt IS NOT NULL
          AND missionDate BETWEEN :from AND :to
      `, { from, to }),
    ]);

    const total = Number(status?.total || 0);
    const completed = Number(status?.completed || 0);
    return res.status(200).json({
      data: {
        status: {
          active: Number(status?.active || 0),
          pendingApproval: Number(status?.pendingApproval || 0),
          completed,
          total,
          completionRate: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : null,
        },
        bySource: bySource.map((row) => ({
          sourceType: row.sourceType,
          items: Number(row.items || 0),
          completedItems: Number(row.completedItems || 0),
          completionRate: Number(row.items) > 0
            ? Number(((Number(row.completedItems) / Number(row.items)) * 100).toFixed(1))
            : null,
        })),
        avgAssignmentToCompletionMinutes: durations?.avgAssignmentToCompletionMinutes != null
          ? Number(Number(durations.avgAssignmentToCompletionMinutes).toFixed(1))
          : null,
        durationSample: Number(durations?.sample || 0),
        range: { from, to },
        note: "To-Do data begins at the 20260901000000 migration; rows created by its backfill represent historical completions, not real assignment events.",
      },
    });
  } catch (error) {
    logger.error("analytics.assignments failed", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export { overview, completions, missions, users, organizations, approvals, assignments };
