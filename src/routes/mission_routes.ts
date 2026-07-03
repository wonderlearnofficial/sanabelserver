import { authenticateToken } from "../middleware/auth";
import { checkstudent } from "../middleware/checkrole";
import {
  requestApproval,
  getMyRequestStatus,
  getMyApprovers,
} from "../controllers/missionController";

export const router = require("express").Router();

/**
 * @swagger
 * /mission/requestApproval:
 *   post:
 *     summary: A school-affiliated student requests parent/teacher approval for a mission
 *     description: |
 *       Personal (non-school) students never call this — they keep completing
 *       missions instantly via /students/add-pros. Creates one pending
 *       MissionApprovalRequest, snapshotting the student's currently linked
 *       parent and assigned teachers as the eligible approvers.
 *     tags: [Mission]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskId:
 *                 type: integer
 *               missionDate:
 *                 type: string
 *                 description: yyyy-mm-dd, the day the mission was actually done. Defaults to today.
 *     responses:
 *       201:
 *         description: Request created
 *       400:
 *         description: No approver available, or a request already exists
 *       404:
 *         description: Student or task not found
 */
router.post("/requestApproval", authenticateToken, checkstudent, requestApproval);

/**
 * @swagger
 * /mission/myRequestStatus:
 *   get:
 *     summary: A student checks the status of their own request for a given mission/date
 *     tags: [Mission]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: taskId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: missionDate
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Latest request for this mission/date, or null
 */
router.get("/myRequestStatus", authenticateToken, checkstudent, getMyRequestStatus);

/**
 * @swagger
 * /mission/myApprovers:
 *   get:
 *     summary: A student checks whether they currently have any parent/teacher who could approve a mission
 *     description: |
 *       Used by the client to show a "Link Parent" prompt upfront instead of
 *       only discovering the lack of an approver after tapping Request Approval.
 *     tags: [Mission]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ hasParent: boolean, hasTeacher: boolean, approvers: { type: 'parent'|'teacher', name: string }[] }"
 */
router.get("/myApprovers", authenticateToken, checkstudent, getMyApprovers);
