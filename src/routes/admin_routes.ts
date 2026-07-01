import { authenticateToken } from "../middleware/auth";
import { checkAdmin } from "../middleware/checkrole";
import * as adminController from "../controllers/adminController";

export const router = require("express").Router();

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
