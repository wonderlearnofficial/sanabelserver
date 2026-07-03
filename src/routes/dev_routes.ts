import { listUsersForDevLogin, loginAsUser } from "../controllers/devController";

export const router = require("express").Router();

/**
 * @swagger
 * /dev/users:
 *   get:
 *     summary: List all users grouped by role (development only, 404s in production)
 *     tags: [Dev]
 *     responses:
 *       200:
 *         description: Users grouped by role
 *       404:
 *         description: Not available outside development
 */
router.get("/users", listUsersForDevLogin);

/**
 * @swagger
 * /dev/login-as/{userId}:
 *   post:
 *     summary: Issue a login token for any user without a password (development only, 404s in production)
 *     tags: [Dev]
 *     responses:
 *       200:
 *         description: Token issued
 *       404:
 *         description: Not available outside development, or user not found
 */
router.post("/login-as/:userId", loginAsUser);
