import { authenticateToken } from "../middleware/auth";
import { checkstudent } from "../middleware/checkrole";
import {
  requestApproval,
  getMyRequestStatus,
  getMyApprovers,
  retargetApproval,
} from "../controllers/missionController";
import { addMyTodo, listMyTodo, removeMyTodo, reorderMyTodo } from "../controllers/todoController";

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
 *               todoItemId:
 *                 type: integer
 *                 description: Persistent To-Do membership. The server always creates the request for its current UTC day.
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
 *           format: date
 *         description: >
 *           Canonical UTC day (YYYY-MM-DD) to read. Omit for the server's
 *           today. A future date is rejected; the value never dates a reward.
 *     responses:
 *       200:
 *         description: Latest request for this mission/date, or null
 *       400:
 *         description: Invalid taskId, malformed date, or future date
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

/**
 * @swagger
 * /mission/todo:
 *   get:
 *     summary: Return a School Student's mission occurrences for one UTC date
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: YYYY-MM-DD; defaults to server today. Invalid and future dates are rejected.
 */
router.get("/todo", authenticateToken, checkstudent, listMyTodo);
router.post("/todo", authenticateToken, checkstudent, addMyTodo);
router.delete("/todo/:id", authenticateToken, checkstudent, removeMyTodo);

/**
 * @swagger
 * /mission/todo/reorder:
 *   patch:
 *     summary: Persist the student's manual To-Do order
 *     description: Body { items [{ id, position }] }. Every id must be one of the authenticated student's own actionable items. No rewards or status changes.
 */
router.patch("/todo/reorder", authenticateToken, checkstudent, reorderMyTodo);

/**
 * @swagger
 * /mission/approval/{requestId}/retarget:
 *   post:
 *     summary: Redirect a pending approval request to another eligible approver
 *     description: Body { approverType, approverId }. Pending requests only; the previous target is preserved in MissionApprovalRequestEvents. Never grants rewards.
 */
router.post("/approval/:requestId/retarget", authenticateToken, checkstudent, retargetApproval);
