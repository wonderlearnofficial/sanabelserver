import { Response, Request,NextFunction } from "express";
import { authenticateToken } from "../middleware/auth";
import multer from "multer";

import { checkTeacher } from "../middleware/checkrole";
import {
  appearclass,
  appearStudent,
  appearStudentByclass,
  appearStudentWithoutClassOrganizationName,
  createClass,
  appearTaskesTypeandCategories,
  addPros,
  appearStudentInDetails,
  teacherData,
  updateDataTeacher,
  deleteData,
  addStudentToClass,
  addTeacher,
  appearClassCategory,
  getClassesByCategory
} from "../controllers/teacherController";
import {
  appearLeaderboard,
  appearTaskesCategory,
  appearTaskesType,
} from "../controllers/studentController";
import {  processTeacherMiddleware } from "../middleware/processExcelfile";
const upload = multer({ dest: "uploads/" });

export const router = require("express").Router();
/**
 * @swagger
 * /teachers/appear-student:
 *   get:
 *     summary: Get a list of all students (visible to authenticated teachers)
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved student list
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
 *                         example: 1
 *                       firstName:
 *                         type: string
 *                         example: "John"
 *                       lastName:
 *                         type: string
 *                         example: "Doe"
 *                       email:
 *                         type: string
 *                         example: "john.doe@example.com"
 *       404:
 *         description: User or Teacher not found
 *       500:
 *         description: Internal server error
 */

router.get("/appear-student", authenticateToken, checkTeacher, appearStudent);
/**
 * @swagger
 * /teachers/appear-class:
 *   get:
 *     summary: Get list of classes and organizations with student count
 *     description: Returns the number of students grouped by their class and organization for an authenticated teacher.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved grouped class and organization data
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
 *                       studentCount:
 *                         type: integer
 *                         example: 25
 *                       classId:
 *                         type: integer
 *                         example: 1
 *                       className:
 *                         type: string
 *                         example: "Grade 5 - A"
 *                       organizationId:
 *                         type: integer
 *                         example: 101
 *                       organizationName:
 *                         type: string
 *                         example: "Greenwood High School"
 *       404:
 *         description: User or Teacher not found
 *       500:
 *         description: Internal server error
 */
router.get("/appear-class", authenticateToken, checkTeacher, appearclass);
/**
 * @swagger
 * /teachers/appear-student-class/{classId}:
 *   get:
 *     summary: Get students of a specific class
 *     description: Returns a list of students belonging to a specific class, including their class and user details, for an authenticated teacher.
 *     tags: [Teachers]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         description: The ID of the class for which the students should be fetched
 *         schema:
 *           type: integer
 *           example: 1
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved students of the class
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
 *                         example: 1
 *                       grade:
 *                         type: string
 *                         example: "A"
 *                       class:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             example: 1
 *                           classname:
 *                             type: string
 *                             example: "Grade 5 - A"
 *                       user:
 *                         type: object
 *                         properties:
 *                           firstName:
 *                             type: string
 *                             example: "John"
 *                           lastName:
 *                             type: string
 *                             example: "Doe"
 *                           email:
 *                             type: string
 *                             example: "john.doe@example.com"
 *       400:
 *         description: Missing classId in the request
 *       404:
 *         description: User, Teacher, or Class not found
 *       500:
 *         description: Internal server error
 */
router.get(
  "/appear-student-class/:classId",
  authenticateToken,
  checkTeacher,
  appearStudentByclass
);
/**
 * @swagger
 * /teachers/appear-student-without-class-organization-name:
 *   get:
 *     summary: Get students without a class and organization name
 *     description: Returns a list of students who are not assigned to any class, along with their user details, and a list of organizations.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved students and organizations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 students:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       grade:
 *                         type: string
 *                         example: "A"
 *                       user:
 *                         type: object
 *                         properties:
 *                           firstName:
 *                             type: string
 *                             example: "John"
 *                           lastName:
 *                             type: string
 *                             example: "Doe"
 *                           email:
 *                             type: string
 *                             example: "john.doe@example.com"
 *                 organization:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       name:
 *                         type: string
 *                         example: "Green School"
 *       404:
 *         description: User or Teacher not found
 *       500:
 *         description: Internal server error
 */
router.get(
  "/appear-student-without-class-organization-name",
  authenticateToken,
  checkTeacher,
  appearStudentWithoutClassOrganizationName
);
/**
 * @swagger
 * /teachers/appear-Taskes-Type-Category/{categoryId}/{type}:
 *   get:
 *     summary: Get tasks by category and type for a teacher or parent
 *     description: Fetch tasks based on category and type, which can be accessed by both teachers and parents.
 *     tags: [Teachers]
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         description: ID of the task category
 *         schema:
 *           type: integer
 *           example: 1
 *       - in: path
 *         name: type
 *         required: true
 *         description: Type of the task (e.g., "homework", "assignment")
 *         schema:
 *           type: string
 *           example: "homework"
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved tasks matching the category and type
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
 *                         example: 1
 *                       title:
 *                         type: string
 *                         example: "Math Homework"
 *                       description:
 *                         type: string
 *                         example: "Complete the assigned exercises"
 *                       categoryId:
 *                         type: integer
 *                         example: 1
 *                       snabelRed:
 *                         type: integer
 *                         example: 5
 *                       snabelBlue:
 *                         type: integer
 *                         example: 3
 *                       snabelYellow:
 *                         type: integer
 *                         example: 2
 *                       xp:
 *                         type: integer
 *                         example: 50
 *                       kind:
 *                         type: string
 *                         example: "Task"
 *                       timeToDo:
 *                         type: string
 *                         example: "2 hours"
 *                       type:
 *                         type: string
 *                         example: "homework"
 *       400:
 *         description: Invalid categoryId or type parameter
 *       404:
 *         description: No tasks found for the given categoryId and type, or teacher/parent not found
 *       500:
 *         description: Internal server error
 */

router.get(
  "/appear-Taskes-Type-Category/:categoryId/:type",
  authenticateToken,
  checkTeacher,
  appearTaskesTypeandCategories
);
/**
 * @swagger
 * /teachers/tasks-category:
 *   get:
 *     summary: Get all task categories
 *     description: This endpoint retrieves all task categories that are available in the system. Accessible by students, teachers, and parents.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved all task categories
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
 *                         example: 1
 *                       name:
 *                         type: string
 *                         example: "Mathematics"
 *                       description:
 *                         type: string
 *                         example: "Mathematical tasks related to algebra and geometry."
 *       404:
 *         description: No task categories found in the system
 *       500:
 *         description: Internal server error
 */
router.get(
  "/tasks-category",
  authenticateToken,
  checkTeacher,
  appearTaskesCategory
);
/**
 * @swagger
 * /teachers/appear-Taskes-Type/{categoryId}:
 *   get:
 *     summary: Get tasks by category
 *     description: This endpoint retrieves all tasks that belong to a specified category. Accessible by students, teachers, and parents.
 *     tags: [Teachers]
 *     parameters:
 *       - name: categoryId
 *         in: path
 *         description: The ID of the task category
 *         required: true
 *         schema:
 *           type: integer
 *           example: 1
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved tasks for the specified category
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
 *                         example: 1
 *                       title:
 *                         type: string
 *                         example: "Algebra Task"
 *                       description:
 *                         type: string
 *                         example: "Solve the algebraic expressions."
 *                       categoryId:
 *                         type: integer
 *                         example: 1
 *                       xp:
 *                         type: integer
 *                         example: 10
 *                       type:
 *                         type: string
 *                         example: "Math"
 *       400:
 *         description: Invalid category ID parameter
 *       404:
 *         description: No tasks found for the specified category
 *       500:
 *         description: Internal server error
 */
router.get(
  "/appear-Taskes-Type/:categoryId",
  authenticateToken,
  checkTeacher,
  appearTaskesType
);
/**
 * @swagger
 * /teachers/create-class:
 *   post:
 *     summary: Create a new class
 *     description: This endpoint allows a teacher to create a new class with necessary details like class name, description, category, and associated organization.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               classname:
 *                 type: string
 *                 description: The name of the class
 *                 example: "Math 101"
 *               classDescription:
 *                 type: string
 *                 description: A brief description of the class
 *                 example: "Introduction to basic algebra"
 *               category:
 *                 type: string
 *                 description: The category or subject of the class
 *                 example: "Mathematics"
 *               organizationId:
 *                 type: integer
 *                 description: The ID of the associated organization
 *                 example: 1
 *     responses:
 *       201:
 *         description: Class created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "Class created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     classname:
 *                       type: string
 *                       example: "Math 101"
 *                     classDescription:
 *                       type: string
 *                       example: "Introduction to basic algebra"
 *                     category:
 *                       type: string
 *                       example: "Mathematics"
 *                     organizationId:
 *                       type: integer
 *                       example: 1
 *       400:
 *         description: Missing required fields (classname, category, or organizationId)
 *       401:
 *         description: "Unauthorized: User data not found in request"
 *       404:
 *         description: Teacher not found for this user
 *       500:
 *         description: Internal server error
 */
router.post("/create-class", authenticateToken, checkTeacher, createClass);
/**
 * @swagger
 * /teachers/add-pros:
 *   post:
 *     summary: Assign tasks to students and update their rewards
 *     description: This endpoint allows a teacher to assign tasks to a list of students, update the completion status of tasks, and track students' progress in various challenges associated with the task.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskId:
 *                 type: integer
 *                 description: The ID of the task to be assigned to students
 *                 example: 101
 *               studentIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: List of student IDs who will be assigned the task
 *                 example: [1, 2, 3]
 *               comment:
 *                 type: string
 *                 description: An optional comment to be added to the task assignment
 *                 example: "Great job!"
 *               time:
 *                 type: string
 *                 description: Time at which the task is assigned, in the format HH:mm
 *                 example: "14:30"
 *     responses:
 *       201:
 *         description: Task assigned to students successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Student tasks recorded successfully"
 *       400:
 *         description: Invalid parameters or missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Invalid taskId parameter"
 *       404:
 *         description: Teacher or student data not found or task not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Teacher data not found in request"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal Server Error"
 */
router.post("/add-pros", authenticateToken, checkTeacher, addPros);
/**
 * @swagger
 * /teachers/appear-student-deatiled/{studentId}:
 *   get:
 *     summary: Fetch detailed information about a specific student
 *     description: This endpoint retrieves detailed information about a student, including their profile, assigned class, organization, and completed tasks categorized by task category.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     parameters:
 *       - name: studentId
 *         in: path
 *         required: true
 *         description: The ID of the student whose details are being retrieved
 *         schema:
 *           type: integer
 *           example: 123
 *     responses:
 *       200:
 *         description: Successfully fetched student details, including class, organization, and task completion data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 student:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 123
 *                     user:
 *                       type: object
 *                       properties:
 *                         firstName:
 *                           type: string
 *                           example: "John"
 *                         lastName:
 *                           type: string
 *                           example: "Doe"
 *                         email:
 *                           type: string
 *                           example: "john.doe@example.com"
 *                     class:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 1
 *                         classname:
 *                           type: string
 *                           example: "Math 101"
 *                         category:
 *                           type: string
 *                           example: "Mathematics"
 *                     organization:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 5
 *                         name:
 *                           type: string
 *                           example: "Global Education"
 *                 totalCompletedTasks:
 *                   type: integer
 *                   example: 15
 *                 categoryCounts:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                   example:
 *                     Mathematics: 8
 *                     Science: 7
 *       400:
 *         description: Invalid student ID provided
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Student ID is required"
 *       404:
 *         description: Student or teacher not found, or invalid student ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Student not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Internal server error"
 */

router.get(
  "/appear-student-deatiled/:studentId",
  authenticateToken,
  checkTeacher,
  appearStudentInDetails
);
/**
 * @swagger
 * /teachers/leader-board:
 *   get:
 *     summary: Fetch the leaderboard of students
 *     description: This endpoint retrieves the leaderboard of students, sorted by their level and experience points (XP) in descending order.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved the leaderboard of students
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     example: 123
 *                   userId:
 *                     type: integer
 *                     example: 456
 *                   level:
 *                     type: integer
 *                     example: 5
 *                   xp:
 *                     type: integer
 *                     example: 1500
 *                   snabelRed:
 *                     type: integer
 *                     example: 300
 *                   snabelBlue:
 *                     type: integer
 *                     example: 200
 *                   snabelYellow:
 *                     type: integer
 *                     example: 100
 *                   organizationId:
 *                     type: integer
 *                     example: 2
 *                   classId:
 *                     type: integer
 *                     example: 1
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                     example: "2025-04-08T00:00:00Z"
 *       404:
 *         description: No student, teacher, or parent data found in the request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Student data not found in request"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Internal Server Error"
 */

router.get("/leader-board", authenticateToken, checkTeacher, appearLeaderboard);
/**
 * @swagger
 * /teachers/teacher-data:
 *   get:
 *     summary: Fetch teacher data
 *     description: This endpoint retrieves the teacher's data, including user details.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully retrieved teacher data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 123
 *                     userId:
 *                       type: integer
 *                       example: 456
 *                     firstName:
 *                       type: string
 *                       example: "John"
 *                     lastName:
 *                       type: string
 *                       example: "Doe"
 *                     email:
 *                       type: string
 *                       example: "john.doe@example.com"
 *       404:
 *         description: Teacher or user data not found
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
router.get("/teacher-data", authenticateToken, checkTeacher, teacherData);
/**
 * @swagger
 * /teachers/update-data:
 *   patch:
 *     summary: Update teacher data
 *     description: This endpoint allows teachers to update their personal details like first name, last name, and email.
 *     tags: [Teachers]
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
 *                 example: "Jane"
 *               lastName:
 *                 type: string
 *                 example: "Doe"
 *               email:
 *                 type: string
 *                 example: "jane.doe@example.com"
 *     responses:
 *       200:
 *         description: Successfully updated teacher data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User and Student data updated successfully"
 *       404:
 *         description: Teacher or user data not found
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
 *                   example: "Internal server error"
 */
router.patch(
  "/update-data",
  authenticateToken,
  checkTeacher,
  updateDataTeacher
);
/**
 * @swagger
 * /teachers/update-student-class:
 *   patch:
 *     summary: Add student to a class
 *     description: This endpoint allows a teacher to add a student to a class using the student's connectCode and the classId.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               connectCode:
 *                 type: string
 *                 example: "ABCD1234"
 *               classId:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       200:
 *         description: Student added successfully to the class
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Student updated successfully"
 *       400:
 *         description: Missing required fields or invalid data in the request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Missing required fields: connectCode, classId"
 *       401:
 *         description: Unauthorized access (Missing user data)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Unauthorized: Missing user data"
 *       404:
 *         description: Student or class not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Student not found with the provided connectCode"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Internal server error"
 */
router.patch(
  "/update-student-class",
  authenticateToken,
  checkTeacher,
  addStudentToClass
);
/**
 * @swagger
 * /teachers/delete-teacher:
 *   delete:
 *     summary: Delete teacher data
 *     description: This endpoint allows a teacher to delete their data, including user and associated records.
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: Successfully deleted teacher data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User and Student data deleted successfully"
 *       404:
 *         description: Teacher or user data not found
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
 *                   example: "Internal server error"
 */

router.delete("/delete-teacher", authenticateToken, checkTeacher, deleteData);
/**
 * @swagger
 * /teachers/add-teacher:
 *   post:
 *     summary: Bulk import teachers from an uploaded Excel file
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
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
 *         description: Teachers imported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Teacher import completed
 *                 successCount:
 *                   type: integer
 *                   example: 10
 *                 failureCount:
 *                   type: integer
 *                   example: 2
 *                 successfulEntries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     example: { row: {}, message: "Teacher added successfully" }
 *                 failedEntries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     example: { row: {}, error: "Email is already in use" }
 *                 files:
 *                   type: array
 *                   items:
 *                     type: string
 *                     example: "/output_teacher/MySchool_Teachers.xlsx"
 *       400:
 *         description: No processed data available or invalid file
 *       500:
 *         description: Internal server error during teacher creation
 */
router.post(
  "/add-teacher",
  upload.single("file"),
 
  processTeacherMiddleware,
  addTeacher
);
/**
 * @swagger
 * /teachers/class-categories:
 *   get:
 *     summary: Retrieve unique class categories for the authenticated teacher's organization
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     responses:
 *       200:
 *         description: List of class categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 categories:
 *                   type: array
 *                   items:
 *                     type: string
 *                     example: "Science"
 *       404:
 *         description: User or Teacher not found
 *       500:
 *         description: Internal server error
 */

router.get("/class-categories",  authenticateToken, checkTeacher,appearClassCategory);
/**
 * @swagger
 * /teachers/classes-by-category:
 *   get:
 *     summary: Get classes under a specific category for the authenticated teacher's organization
 *     tags: [Teachers]
 *     security:
 *       - bearerAuth: []  # Requires JWT token
 *     parameters:
 *       - in: body
 *         name: category
 *         schema:
 *           type: string
 *         required: true
 *         description: The class category to filter by
 *     responses:
 *       200:
 *         description: List of classes in the specified category
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
 *         description: Missing or invalid category query parameter
 *       404:
 *         description: User or Teacher not found
 *       500:
 *         description: Internal server error
 */

router.get("/classes-by-category" ,authenticateToken, checkTeacher, getClassesByCategory);
