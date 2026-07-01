import {
  parentData,
  updateDataTeacherParent,
  deleteData,
  searchStuentByCode,
  connectStudentToParent,
  appearStudentbyparent,
  addPros,
  parentLeaderboard,
  appearStudentInDetails,
} from "../controllers/parentController";
import { authenticateToken } from "../middleware/auth";
import { checkparent } from "../middleware/checkrole";
import {
  appearTaskesCategory,
  appearTaskesType,
} from "../controllers/studentController";
import { appearTaskesTypeandCategories } from "../controllers/teacherController";

export const router = require("express").Router();

/**
 * @swagger
 * /parents/parent-data:
 *   get:
 *     summary: Get parent data
 *     description: This endpoint allows a parent to fetch their data.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully fetched parent data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   description: Parent data object
 *       404:
 *         description: Parent or User data not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User or Student not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Error fetching teacher data"
 */
router.get("/parent-data", authenticateToken, checkparent, parentData);
/**
 * @swagger
 * /parents/appear-Taskes-Type-Category/{categoryId}/{type}:
 *   get:
 *     summary: Get tasks by category and type
 *     description: Retrieves tasks for the given category ID and task type.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the task category
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *         description: Type of task (e.g., "daily", "weekly")
 *     responses:
 *       200:
 *         description: Successfully fetched tasks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer }
 *                       title: { type: string }
 *                       description: { type: string }
 *                       categoryId: { type: integer }
 *                       snabelRed: { type: number }
 *                       snabelBlue: { type: number }
 *                       snabelYellow: { type: number }
 *                       xp: { type: number }
 *                       kind: { type: string }
 *                       timeToDo: { type: string }
 *                       type: { type: string }
 *       400:
 *         description: Invalid category or type parameter
 *       404:
 *         description: No tasks found for the given category and type
 *       500:
 *         description: Internal server error
 */

router.get(
  "/appear-Taskes-Type-Category/:categoryId/:type",
  authenticateToken,
  checkparent,
  appearTaskesTypeandCategories
);
/**
 * @swagger
 * /parents/tasks-category:
 *   get:
 *     summary: Get all task categories
 *     description: Retrieves a list of all available task categories for student, parent, or teacher.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully fetched task categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       title:
 *                         type: string
 *       404:
 *         description: Category data not found
 *       500:
 *         description: Internal server error
 */

router.get(
  "/tasks-category",
  authenticateToken,
  checkparent,
  appearTaskesCategory
);
/**
 * @swagger
 * /parents/appear-Taskes-Type/{categoryId}:
 *   get:
 *     summary: Get tasks by category ID
 *     description: Retrieves all tasks associated with a given task category ID.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the task category to filter tasks by
 *     responses:
 *       200:
 *         description: Successfully retrieved tasks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Task'
 *       400:
 *         description: Invalid category parameter
 *       404:
 *         description: No tasks found for this category
 *       500:
 *         description: Internal server error
 */

router.get(
  "/appear-Taskes-Type/:categoryId",
  authenticateToken,
  checkparent,
  appearTaskesType
);
/**
 * @swagger
 * /appear-student-by-parent:
 *   get:
 *     summary: Get student info linked to the logged-in parent
 *     description: Fetches student information associated with the authenticated parent's account.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved student data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     classId: { type: integer }
 *                     user:
 *                       type: object
 *                       properties:
 *                         firstName: { type: string }
 *                         lastName: { type: string }
 *       404:
 *         description: Student or parent not found
 *       500:
 *         description: Error fetching student data
 */

router.get(
  "/appear-student-by-parent",
  authenticateToken,
  checkparent,
  appearStudentbyparent
);
/**
 * @swagger
 * /parents/search-student-by-code/{code}:
 *   get:
 *     summary: Search for a student using their connect code
 *     description: Allows a parent to find a student using the unique connect code.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: The student's connect code
 *     responses:
 *       200:
 *         description: Successfully found student
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     classId: { type: integer }
 *                     connectCode: { type: string }
 *                     user:
 *                       type: object
 *                       properties:
 *                         firstName: { type: string }
 *                         lastName: { type: string }
 *       404:
 *         description: Parent or student not found
 *       500:
 *         description: Server error
 */

router.get(
  "/search-student-by-code/:code",
  authenticateToken,
  checkparent,
  searchStuentByCode
);
/**
 * @swagger
 * /parents/connect-student-to-parent:
 *   patch:
 *     summary: Connect a student to the logged-in parent
 *     description: Binds a student to a parent's account using the student's connect code.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *                 description: The connect code of the student
 *     responses:
 *       200:
 *         description: Student connected to parent successfully
 *       404:
 *         description: Parent or student not found
 *       500:
 *         description: Server error
 */

router.patch(
  "/connect-student-to-parent",
  authenticateToken,
  checkparent,
  connectStudentToParent
);
/**
 * @swagger
 * /parents/update-data:
 *   patch:
 *     summary: Update parent data
 *     description: This endpoint allows a parent to update their first name, last name, and email.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 example: "Doe"
 *               email:
 *                 type: string
 *                 example: "johndoe@example.com"
 *     responses:
 *       200:
 *         description: Successfully updated parent data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User and Student data updated successfully"
 *       404:
 *         description: User or Student data not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User or Student not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Error fetching teacher data"
 */

router.patch(
  "/update-data",
  authenticateToken,
  checkparent,
  updateDataTeacherParent
);
/**
 * @swagger
 * /parents/delete-parent:
 *   delete:
 *     summary: Delete parent and associated user
 *     description: Allows a parent to delete their own user and parent record from the system.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Parent and user deleted successfully
 *       404:
 *         description: Parent or user not found
 *       500:
 *         description: Server error
 */
router.delete("/delete-parent", authenticateToken, checkparent, deleteData);
/**
 * @swagger
 * /parents/add-pros:
 *   post:
 *     summary: Add student progress for a task
 *     description: Allows a parent to assign a task to one or more of their children and track their progress. Also updates XP, rewards, and relevant challenge progress.
 *     tags: [Parents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - taskId
 *               - studentIds
 *               - time
 *             properties:
 *               taskId:
 *                 type: number
 *               studentIds:
 *                 type: array
 *                 items:
 *                   type: number
 *               comment:
 *                 type: string
 *               time:
 *                 type: string
 *                 example: "14:30"
 *                 description: Time in HH:mm format
 *     responses:
 *       201:
 *         description: Student tasks recorded successfully
 *       400:
 *         description: Invalid input or task already completed today
 *       403:
 *         description: Some students do not belong to the parent
 *       404:
 *         description: Task or students not found
 *       500:
 *         description: Server error
 */

router.post("/add-pros", authenticateToken, checkparent, addPros);
router.get("/appear-leaderboard", authenticateToken, checkparent, parentLeaderboard);
router.get("/appear-student-deatiled/:studentId", authenticateToken, checkparent, appearStudentInDetails);
