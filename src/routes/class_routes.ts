import multer from "multer";
import { schoolAndClassProcessMiddleware } from "../middleware/processExcelfile";
import { createClassByExcel } from "../controllers/classController";

export const router = require("express").Router();
const upload = multer({ dest: "uploads/" });
/**
 * @swagger
 * /class/create:
 *   post:
 *     summary: Create classes and organizations from an uploaded Excel file
 *     description: |
 *       Upload an Excel file where each sheet represents a school, the second row is treated as headers.
 *       "Category" and "Names of classes" columns are required.
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
  upload.single("file"),
  schoolAndClassProcessMiddleware,
  createClassByExcel
);
