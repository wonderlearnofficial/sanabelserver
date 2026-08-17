import { Router } from "express";
import * as appConfigController from "../controllers/appConfigController";

export const router = Router();

/**
 * @swagger
 * /app/version:
 *   get:
 *     summary: Retrieve current application version requirements and maintenance state
 *     tags: [App]
 *     parameters:
 *       - in: query
 *         name: platform
 *         schema:
 *           type: string
 *           enum: [android, ios, web]
 *         description: Operating platform of the client
 *     responses:
 *       200:
 *         description: App version configuration
 */
router.get("/version", appConfigController.getAppVersion);
