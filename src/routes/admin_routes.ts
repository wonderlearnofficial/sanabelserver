import { authenticateToken } from "../middleware/auth";
import { checkAdmin, requireSuperAdmin } from "../middleware/checkrole";
import * as adminController from "../controllers/adminController";
import * as analyticsController from "../controllers/analyticsController";
import * as appConfigController from "../controllers/appConfigController";
import upload from "../middleware/uploadExcel";
import { processStudentMiddleware } from "../middleware/processExcelfile";

export const router = require("express").Router();

// ---------------------------------------------------------------------------
// Super-Admin-only analytics
//
// Chain: authenticateToken -> checkAdmin (resolves scope from Admins) ->
// requireSuperAdmin (rejects any admin with an organizationId). A school admin,
// teacher, parent or student receives 403 on every route below regardless of
// whether the client renders the navigation for it.
// ---------------------------------------------------------------------------
const superAdminOnly = [authenticateToken, checkAdmin, requireSuperAdmin];

/**
 * @swagger
 * /admin/analytics/overview:
 *   get:
 *     summary: Platform-wide KPIs (Super Admin only)
 *     tags: [Analytics]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200: { description: Overview metrics }
 *       403: { description: Super Admin access required }
 */
router.get("/analytics/overview", ...superAdminOnly, analyticsController.overview);

/**
 * @swagger
 * /admin/analytics/completions:
 *   get:
 *     summary: Paginated mission-completion records (Super Admin only)
 *     tags: [Analytics]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 100 } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: organizationId, schema: { type: integer } }
 *       - { in: query, name: classId, schema: { type: integer } }
 *       - { in: query, name: taskId, schema: { type: integer } }
 *       - { in: query, name: categoryId, schema: { type: integer } }
 *       - { in: query, name: source, schema: { type: string } }
 *     responses:
 *       200: { description: Completion rows with pagination metadata }
 *       403: { description: Super Admin access required }
 */
router.get("/analytics/completions", ...superAdminOnly, analyticsController.completions);

/**
 * @swagger
 * /admin/analytics/missions:
 *   get:
 *     summary: Mission completion rankings, categories, sources and trend (Super Admin only)
 *     tags: [Analytics]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Mission analytics }
 *       403: { description: Super Admin access required }
 */
router.get("/analytics/missions", ...superAdminOnly, analyticsController.missions);

/**
 * @swagger
 * /admin/analytics/users:
 *   get:
 *     summary: Engagement metrics derived from mission completions (Super Admin only)
 *     tags: [Analytics]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Engagement analytics }
 *       403: { description: Super Admin access required }
 */
router.get("/analytics/users", ...superAdminOnly, analyticsController.users);

/**
 * @swagger
 * /admin/analytics/organizations:
 *   get:
 *     summary: Per-organization rollup (Super Admin only)
 *     tags: [Analytics]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Organization analytics }
 *       403: { description: Super Admin access required }
 */
router.get("/analytics/organizations", ...superAdminOnly, analyticsController.organizations);

/**
 * @swagger
 * /admin/analytics/approvals:
 *   get:
 *     summary: Approval funnel, resolution times and oldest pending (Super Admin only)
 *     tags: [Analytics]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Approval analytics }
 *       403: { description: Super Admin access required }
 */
router.get("/analytics/approvals", ...superAdminOnly, analyticsController.approvals);

/**
 * @swagger
 * /admin/analytics/assignments:
 *   get:
 *     summary: To-Do assignment funnel by source (Super Admin only)
 *     tags: [Analytics]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Assignment analytics }
 *       403: { description: Super Admin access required }
 */
router.get("/analytics/assignments", ...superAdminOnly, analyticsController.assignments);

/**
 * @swagger
 * /admin/me:
 *   get:
 *     summary: Get the logged-in admin's profile
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin profile retrieved successfully
 *       404:
 *         description: Admin not found
 */
router.get("/me", authenticateToken, checkAdmin, adminController.getAdminProfile);

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Dashboard counters (users, students, teachers, parents, organizations, classes) in one call
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Counts keyed by entity name
 */
router.get("/stats", authenticateToken, checkAdmin, adminController.getAdminStats);

/**
 * @swagger
 * /admin/organizations:
 *   get:
 *     summary: List organizations (search/filter/paginate)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   post:
 *     summary: Create a new organization
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/organizations", authenticateToken, checkAdmin, adminController.listOrganizations);
router.post("/organizations", authenticateToken, checkAdmin, adminController.createOrganization);

/**
 * @swagger
 * /admin/organizations/{organizationId}:
 *   get:
 *     summary: Get a single organization (including its classes)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   patch:
 *     summary: Update an organization
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: Delete an organization (blocked if it has dependent students/teachers/classes)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/organizations/:organizationId", authenticateToken, checkAdmin, adminController.getOrganization);
router.patch("/organizations/:organizationId", authenticateToken, checkAdmin, adminController.updateOrganization);
router.delete("/organizations/:organizationId", authenticateToken, checkAdmin, adminController.deleteOrganization);

/**
 * @swagger
 * /admin/students:
 *   get:
 *     summary: List students system-wide (search/filter by organization, class, grade; paginate)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/students", authenticateToken, checkAdmin, adminController.listStudents);

/**
 * @swagger
 * /admin/students/{studentId}:
 *   get:
 *     summary: Get a single student's full detail
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   patch:
 *     summary: Update a student (including reassigning organization/class)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: Delete a student
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/students/:studentId", authenticateToken, checkAdmin, adminController.getStudentDetail);
router.patch("/students/:studentId", authenticateToken, checkAdmin, adminController.updateStudent);
router.delete("/students/:studentId", authenticateToken, checkAdmin, adminController.deleteStudent);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users (flat view), optionally filtered by role (Student/Teacher/Parent/Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/users", authenticateToken, checkAdmin, adminController.listUsers);

/**
 * @swagger
 * /admin/users:
 *   post:
 *     summary: Create a new user account of any role (Student/Teacher/Parent/Admin), bypassing OTP
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post("/users", authenticateToken, checkAdmin, adminController.createUser);

/**
 * @swagger
 * /admin/users/{userId}:
 *   patch:
 *     summary: Update a user's name/email (and role-specific fields for Student/Teacher)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: Delete a user of any role, cascading its role-specific data
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.patch("/users/:userId", authenticateToken, checkAdmin, adminController.updateUser);
router.delete("/users/:userId", authenticateToken, checkAdmin, adminController.deleteUser);

/**
 * @swagger
 * /admin/users/{userId}/reset-password:
 *   patch:
 *     summary: Reset a user's password to the default test password
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.patch("/users/:userId/reset-password", authenticateToken, checkAdmin, adminController.resetUserPassword);

/**
 * @swagger
 * /admin/teachers:
 *   get:
 *     summary: List all teachers system-wide (search/filter by organization; paginate)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/teachers", authenticateToken, checkAdmin, adminController.listTeachers);

/**
 * @swagger
 * /admin/parents:
 *   get:
 *     summary: List all parents system-wide (search; paginate)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/parents", authenticateToken, checkAdmin, adminController.listParents);

/**
 * @swagger
 * /admin/classes:
 *   get:
 *     summary: List classes system-wide (search/filter by organization; paginate)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   post:
 *     summary: Create a new class
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/classes", authenticateToken, checkAdmin, adminController.listClasses);
router.post("/classes", authenticateToken, checkAdmin, adminController.createClass);

/**
 * @swagger
 * /admin/classes/{classId}:
 *   patch:
 *     summary: Update a class
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: Delete a class (blocked if it has students assigned)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.patch("/classes/:classId", authenticateToken, checkAdmin, adminController.updateClass);
router.delete("/classes/:classId", authenticateToken, checkAdmin, adminController.deleteClass);

router.get("/grades", authenticateToken, checkAdmin, adminController.listGrades);
router.post("/grades", authenticateToken, checkAdmin, adminController.createGrade);
router.patch("/grades/:gradeId", authenticateToken, checkAdmin, adminController.updateGrade);
router.delete("/grades/:gradeId", authenticateToken, checkAdmin, adminController.deleteGrade);

/**
 * @swagger
 * /admin/grades/import:
 *   post:
 *     summary: Bulk-import grades from a row-based Excel/CSV file
 *     description: |
 *       One row per grade, column "name" (case-insensitive). Creates the grade
 *       if missing; a no-op (still reported as success) if it already exists.
 *       Used by the admin Import Wizard.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Import summary with successfulEntries/failedEntries
 */
router.post(
  "/grades/import",
  authenticateToken,
  checkAdmin,
  upload.single("file"),
  processStudentMiddleware,
  adminController.importGrades
);

/**
 * @swagger
 * /admin/scores:
 *   get:
 *     summary: Get student scores and gamification progress system-wide
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/scores", authenticateToken, checkAdmin, adminController.listScores);

/**
 * @swagger
 * /admin/history:
 *   get:
 *     summary: Get recent completed tasks history system-wide
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/history", authenticateToken, checkAdmin, adminController.listTaskHistory);

/**
 * @swagger
 * /admin/app-version:
 *   get:
 *     summary: Retrieve platform version release configurations
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *   put:
 *     summary: Update platform version release configurations
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/app-version", authenticateToken, checkAdmin, appConfigController.getAdminAppConfigs);
router.put("/app-version", authenticateToken, checkAdmin, appConfigController.updateAdminAppConfig);

/**
 * @swagger
 * /admin/students/{studentId}/impersonate:
 *   post:
 *     summary: Sign in / generate an impersonation access token as a student (Superadmin / Scoped Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/students/:studentId/impersonate",
  authenticateToken,
  checkAdmin,
  adminController.impersonateStudent,
);
router.post(
  "/impersonate-student/:studentId",
  authenticateToken,
  checkAdmin,
  adminController.impersonateStudent,
);

