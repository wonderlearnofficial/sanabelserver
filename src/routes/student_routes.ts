import { Response, Request } from "express";
import {
  studentData,
  updateData,
  deleteData,
  appearTaskes,
  appearTrophySecondaireCompleted,
  appearTrophySecondaireNotCompleted,
  appearTrophyPrimaireCompleted,
  appearTrophyPrimaireNotCompleted,
  addStudent,
  appearTaskCompletedcountToday,
  calculateCompletedTasksByCategory,
  appearTaskesCategory,
  appearChallangesSecondaire,
  appearChallangesPrimaire,
  appearTaskCompleted,
  appearLeaderboard,
  appearTaskesType,
  appearTaskesTypeandCategory,
  buyWaterSeeder,
  growTheTree,
  updateProfileImage,
  addPros,
} from "../controllers/studentController";

import { authenticateToken } from "../middleware/auth";
import { checkstudent } from "../middleware/checkrole";
import multer from "multer";
import { processStudentMiddleware } from "../middleware/processExcelfile";
import { appearClassGrade, getClassesByGrade } from "../controllers/teacherController";
const upload = multer({ dest: "uploads/" });

export const router = require("express").Router();

/**
 * @swagger
 * tags:
 *   name: Students
 *   description: API endpoints for managing student data, tasks, challenges, and leaderboard
 */

/**
 * @swagger
 * /students/data:
 *   get:
 *     summary: Fetch student data
 *     description: Retrieve student data including user details and tree progress.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Student data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     student:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         firstName:
 *                           type: string
 *                         lastName:
 *                           type: string
 *                         email:
 *                           type: string
 *                         grade:
 *                           type: string
 *                         snabelRed:
 *                           type: number
 *                         snabelBlue:
 *                           type: number
 *                         snabelYellow:
 *                           type: number
 *                         water:
 *                           type: number
 *                         seeders:
 *                           type: number
 *                         seederInTree:
 *                           type: number
 *                         waterInTree:
 *                           type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - User or Student not found
 *       500:
 *         description: Internal Server Error
 */
router.get("/data", authenticateToken, checkstudent, studentData);

/**
 * @swagger
 * /students/student-task:
 *   get:
 *     summary: Fetch tasks assigned to the student
 *     description: Retrieve all tasks assigned to the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tasks retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       snabelRed:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *                       xp:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No tasks found
 *       500:
 *         description: Internal Server Error
 */
router.get("/student-task", authenticateToken, checkstudent, appearTaskes);

/**
 * @swagger
 * /students/student-trophy-secondaire:
 *   get:
 *     summary: Fetch active challenges for the student
 *     description: Retrieve all active challenges assigned to the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Challenges retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       point:
 *                         type: number
 *                       level:
 *                         type: string
 *                       xp:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelRed:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No challenges found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/student-trophy-secondaire",
  authenticateToken,
  checkstudent,
  appearChallangesSecondaire,

);

/**
 * @swagger
 * /students/student-trophy-secondaire-completed:
 *   get:
 *     summary: Fetch active challenges for the student
 *     description: Retrieve all active challenges assigned to the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Challenges retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       point:
 *                         type: number
 *                       level:
 *                         type: string
 *                       xp:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelRed:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No challenges found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/student-trophy-secondaire-completed",
  authenticateToken,
  checkstudent,
  appearTrophySecondaireCompleted,

);


/**
 * @swagger
 * /students/student-trophy-secondaire-not-completed:
 *   get:
 *     summary: Fetch active challenges for the student
 *     description: Retrieve all active challenges assigned to the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Challenges retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       point:
 *                         type: number
 *                       level:
 *                         type: string
 *                       xp:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelRed:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No challenges found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/student-trophy-secondaire-not-completed",
  authenticateToken,
  checkstudent,
  appearTrophySecondaireNotCompleted,

);

/**
 * @swagger
 * /students/student-trophy-primaire:
 *   get:
 *     summary: Fetch completed challenges for the student
 *     description: Retrieve all completed challenges for the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Completed challenges retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       point:
 *                         type: number
 *                       level:
 *                         type: string
 *                       xp:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelRed:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No completed challenges found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/student-trophy-primaire",
  authenticateToken,
  checkstudent,
  appearChallangesPrimaire
);

/**
 * @swagger
 * /students/student-trophy-primaire-not-completed:
 *   get:
 *     summary: Fetch completed challenges for the student
 *     description: Retrieve all completed challenges for the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Completed challenges retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       point:
 *                         type: number
 *                       level:
 *                         type: string
 *                       xp:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelRed:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No completed challenges found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/student-trophy-primaire-not-completed",
  authenticateToken,
  checkstudent,
  appearTrophyPrimaireNotCompleted
);

/**
 * @swagger
 * /students/student-trophy-primaire-completed:
 *   get:
 *     summary: Fetch completed challenges for the student
 *     description: Retrieve all completed challenges for the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Completed challenges retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       point:
 *                         type: number
 *                       level:
 *                         type: string
 *                       xp:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelRed:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No completed challenges found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/student-trophy-primaire-completed",
  authenticateToken,
  checkstudent,
  appearTrophyPrimaireCompleted
);

/**
 * @swagger
 * /students/student-task-completed:
 *   get:
 *     summary: Fetch completed tasks for the student
 *     description: Retrieve all completed tasks for the student.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Completed tasks retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       snabelRed:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *                       xp:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No completed tasks found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/student-task-completed",
  authenticateToken,
  checkstudent,
  appearTaskCompleted
);

/**
 * @swagger
 * /students/task-count-sucess:
 *   get:
 *     summary: Count tasks completed today
 *     description: Retrieve the count of tasks completed by the student today.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Task count retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 completedTasksCount:
 *                   type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No tasks completed today
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/task-count-sucess",
  authenticateToken,
  checkstudent,
  appearTaskCompletedcountToday
);

/**
 * @swagger
 * /students/calculate-completed-tasks-by-category:
 *   get:
 *     summary: Calculate completed tasks by category
 *     description: Retrieve the count of completed tasks grouped by category.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Task counts by category retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No completed tasks found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/calculate-completed-tasks-by-category",
  authenticateToken,
  checkstudent,
  calculateCompletedTasksByCategory
);

/**
 * @swagger
 * /students/tasks-category:
 *   get:
 *     summary: Fetch task categories
 *     description: Retrieve all task categories.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Task categories retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No task categories found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/tasks-category",
  authenticateToken,
  checkstudent,
  appearTaskesCategory
);
/**
 * @swagger
 * /students/appear-Taskes-Type-Category/{category}/{type}:
 *   get:
 *     summary: Fetch tasks by type and category
 *     description: Retrieve tasks filtered by type and category.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: category
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The category of tasks to retrieve (e.g., "el3laka m3 allah", "el3laka m3 elnfs", "el3laka m3 el2osara").
 *       - name: type
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The type of tasks to retrieve (e.g., "snbla elslah", "snbla elsom").
 *     responses:
 *       200:
 *         description: Tasks retrieved successfully
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
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       snabelRed:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *                       xp:
 *                         type: number
 *                       kind:
 *                         type: string
 *                         example: "dohr 3asr m8rb"
 *                       timeToDo:
 *                         type: string
 *                       type:
 *                         type: string
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No tasks found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/appear-Taskes-Type-Category/:categoryId/:type",
  authenticateToken,
  checkstudent,
  appearTaskesTypeandCategory
);

/**
 * @swagger
 * /students/appear-Leaderboard:
 *   get:
 *     summary: Fetch leaderboard
 *     description: Retrieve the leaderboard sorted by level and XP.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Leaderboard retrieved successfully
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
 *                       firstName:
 *                         type: string
 *                       lastName:
 *                         type: string
 *                       email:
 *                         type: string
 *                       grade:
 *                         type: string
 *                       snabelRed:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *                       water:
 *                         type: number
 *                       seeders:
 *                         type: number
 *       401:
 *         description: Unauthorized - User data not found in request
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/appear-Leaderboard",
  authenticateToken,
  checkstudent,
  appearLeaderboard
);

/**
 * @swagger
 * /students/appear-Taskes-Type/{categoryId}:
 *   get:
 *     summary: Fetch tasks by category
 *     description: Retrieve tasks filtered by category ID.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: categoryId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the task category.
 *     responses:
 *       200:
 *         description: Tasks retrieved successfully
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
 *                       description:
 *                         type: string
 *                       categoryId:
 *                         type: integer
 *                       snabelRed:
 *                         type: number
 *                       snabelBlue:
 *                         type: number
 *                       snabelYellow:
 *                         type: number
 *                       xp:
 *                         type: number
 *                       kind:
 *                         type: string
 *                       timeToDo:
 *                         type: string
 *                       type:
 *                         type: string
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - No tasks found for the specified category ID
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/appear-Taskes-Type/:categoryId",
  authenticateToken,
  checkstudent,
  appearTaskesType
);
/**
 * @swagger
 * /students/buy-water-seeder:
 *   patch:
 *     summary: Buy water and seeders
 *     description: Allow students to buy water and seeders using Snabel points.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               water:
 *                 type: number
 *                 example: 5
 *               seeders:
 *                 type: number
 *                 example: 3
 *     responses:
 *       200:
 *         description: Water and seeders purchased successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 student:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     grade:
 *                       type: string
 *                     snabelRed:
 *                       type: number
 *                     snabelBlue:
 *                       type: number
 *                     snabelYellow:
 *                       type: number
 *                     water:
 *                       type: number
 *                     seeders:
 *                       type: number
 *       400:
 *         description: Bad Request - Insufficient Snabel balance or invalid input
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Internal Server Error
 */
router.patch(
  "/buy-water-seeder",
  authenticateToken,
  checkstudent,
  buyWaterSeeder
);
/**
 * @swagger
 * /students/grow-tree:
 *   patch:
 *     summary: Grow the student's tree
 *     description: Allows a student to grow their tree if they have enough seeders and water.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tree successfully grown
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 student:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     userId:
 *                       type: integer
 *                     seeders:
 *                       type: integer
 *                     water:
 *                       type: integer
 *                     treeProgress:
 *                       type: integer
 *       400:
 *         description: Not enough seeders or water to grow the tree
 *       401:
 *         description: Unauthorized - User authentication failed
 *       404:
 *         description: Not Found - User, student, or tree data not found
 *       500:
 *         description: Internal Server Error
 */
router.patch("/grow-tree", authenticateToken, checkstudent, growTheTree);

/**
 * @swagger
 * /students/add-student:
 *   post:
 *     summary: Add multiple students from an Excel file
 *     description: Add multiple students to the system by uploading an Excel file.
 *     tags: [Students]
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
 *         description: Students added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 successCount:
 *                   type: number
 *                 failureCount:
 *                   type: number
 *                 successfulEntries:
 *                   type: array
 *                   items:
 *                     type: object
 *                 failedEntries:
 *                   type: array
 *                   items:
 *                     type: object
 *                 files:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Bad Request - Invalid file format or missing data
 *       500:
 *         description: Internal Server Error
 */

router.post(
  "/add-student",
  upload.single("file"),
  processStudentMiddleware,
  addStudent
);

/**
 * @swagger
 * /students/update:
 *   put:
 *     summary: Update student profile
 *     description: Update the student's profile information (first name, last name, and grade).
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               grade:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - User or Student not found
 *       500:
 *         description: Internal Server Error
 */
router.patch("/update", authenticateToken, checkstudent, updateData);



/**
 * @swagger
 * /students/delete:
 *   delete:
 *     summary: Delete student data
 *     description: Delete the student and associated user records.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Student data deleted successfully
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - User or Student not found
 *       500:
 *         description: Internal Server Error
 */
router.delete("/delete", authenticateToken, checkstudent, deleteData);

/**
 * @swagger
 * /students/update-profile-image:
 *   patch:
 *     summary: Update student profile image
 *     description: Update the student's profile image.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profileImg:
 *                 type: object
 *     responses:
 *       200:
 *         description: Profile image updated successfully
 *       401:
 *         description: Unauthorized - User data not found in request
 *       404:
 *         description: Not Found - User or Student not found
 *       500:
 *         description: Internal Server Error
 */
router.patch("/update-profile-image", authenticateToken, checkstudent, updateProfileImage);
/**
 * @swagger
 * /students/class-grades:
 *   get:
 *     summary: Retrieve unique class grades for the authenticated teacher's organization
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: List of class grades
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 grades:
 *                   type: array
 *                   items:
 *                     type: string
 *                     example: "primary"
 *       404:
 *         description: User or Teacher not found
 *       500:
 *         description: Internal server error
 */
router.get("/class-grades",  authenticateToken, checkstudent,appearClassGrade);

/**
 * @swagger
 * /students/classes-by-grade:
 *   get:
 *     summary: Get classes under a specific grade for the authenticated teacher's organization
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     parameters:
 *       - in: body
 *         name: grade
 *         schema:
 *           type: string
 *         required: true
 *         description: The class grade to filter by
 *     responses:
 *       200:
 *         description: List of classes in the specified grade
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 classes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 5
 *                       name:
 *                         type: string
 *                         example: "Physics 101"
 *       400:
 *         description: Missing or invalid grade query parameter
 *       404:
 *         description: User or Teacher not found
 *       500:
 *         description: Internal server error
 */

router.get("/classes-by-grade" ,authenticateToken, checkstudent, getClassesByGrade);

/**
 * @swagger
 * /students/add-pros:
 *   post:
 *     summary: Record task progress for the student
 *     description: Allows a student to record their own task completion and earn rewards.
 *     tags: [Students]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskId:
 *                 type: integer
 *                 example: 1
 *               time:
 *                 type: string
 *                 example: "14:30"
 *     responses:
 *       201:
 *         description: Task recorded successfully
 *       400:
 *         description: Invalid input or task already completed today
 *       404:
 *         description: Task or Student not found
 *       500:
 *         description: Internal Server Error
 */
router.post("/add-pros", authenticateToken, checkstudent, addPros);

