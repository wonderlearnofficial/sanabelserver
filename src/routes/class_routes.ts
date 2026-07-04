import multer from "multer";
import { schoolAndClassProcessMiddleware, processStudentMiddleware } from "../middleware/processExcelfile";
import { createClassByExcel, importClasses } from "../controllers/classController";
import { authenticateToken } from "../middleware/auth";
import { checkAdmin } from "../middleware/checkrole";

export const router = require("express").Router();
const upload = multer({ dest: "uploads/" });
/**
 * @swagger
 * /class/create:
 *   post:
 *     summary: Create classes and organizations from an uploaded Excel file
 *     description: |
 *       Upload an Excel file where each sheet represents a school, the second row is treated as headers.
 *       "Grade" and "Names of classes" columns are required.
 *       The "Names of classes" can contain multiple class names separated by `/` or `&`.
 *       This endpoint will:
 *       - Create an organization (school) if it doesn't exist.
 *       - Create classes under that organization based on the provided data.
 *     tags: [Class]
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
 *                 description: Excel (.xlsx) file containing school and class data.
 *     responses:
 *       200:
 *         description: Classes created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Classes created successfully!
 *       400:
 *         description: No file uploaded or file format invalid
 *       500:
 *         description: Error processing file or creating data
 */

router.post(
  "/create",
  authenticateToken,
  checkAdmin,
  upload.single("file"),
  schoolAndClassProcessMiddleware,
  createClassByExcel
);

/**
 * @swagger
 * /class/import:
 *   post:
 *     summary: Bulk-import classes from a row-based Excel/CSV file (admin only)
 *     description: |
 *       One row per class, columns "classname", "school" (organization name), "grade"
 *       (case-insensitive aliases accepted). Auto-creates the organization/grade/class
 *       if missing, same behavior as the student importer. Used by the admin Import Wizard.
 *     tags: [Class]
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
  "/import",
  authenticateToken,
  checkAdmin,
  upload.single("file"),
  processStudentMiddleware,
  importClasses
);
