import multer from "multer";
import { schoolAndClassProcessMiddleware } from "../middleware/processExcelfile";
import { createOrganizationByExcel } from "../controllers/organiztionController";

export const router = require("express").Router();
const upload = multer({ dest: "uploads/" });
/**
 * @swagger
 * /organization/create:
 *   post:
 *     summary: Create organizations from an uploaded Excel file
 *     description: |
 *       Upload an Excel file containing a sheet for each organization (school).
 *       The sheet names represent different organizations, and each sheet should correspond to a school.
 *       This endpoint will:
 *       - Create an organization if it doesn't already exist.
 *       - Skip the creation if the organization already exists in the database.
 *     tags: [Organization]
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
 *                 description: Excel (.xlsx) file containing organization (school) names.
 *     responses:
 *       200:
 *         description: Organizations added successfully or skipped if already exist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: string
 *                   example: "The data added successfully"
 *       400:
 *         description: No file uploaded or invalid file format
 *       401:
 *         description: School names not found in the uploaded file
 *       500:
 *         description: Internal server error during data processing
 */

router.post(
  "/create",
  upload.single("file"),
  schoolAndClassProcessMiddleware,
  createOrganizationByExcel
);
