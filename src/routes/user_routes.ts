import { updatePassword } from "../controllers/userController";
import { authenticateToken } from "../middleware/auth";
// import upload from "../config/cloudaryconfig"; // Import multer config

import express from "express";
import * as userController from "../controllers/userController";
import * as authController from "../controllers/authController";
export const router = express.Router();

/**
 * @swagger
 * /users/login:
 *   get:
 *     summary: Login a user
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *               password:
 *                 type: string
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 1
 *                         email:
 *                           type: string
 *                           example: "user@example.com"
 *                         role:
 *                           type: string
 *                           example: "Student"
 *                         token:
 *                           type: string
 *                           example: "some-jwt-token"
 *       401:
 *         description: Incorrect email or password
 *       500:
 *         description: Internal server error
 */
router.patch("/login", userController.login);
/**
 * @swagger
 * /users/registration:
 *   patch:
 *     summary: Register a new user
 *     description: "⚠️ User must verify OTP before registration. Use `/users/send-auth` then put your email and otp `/users/verfication-auth`  and complete OTP verification first."
 *     tags: [User]
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
 *                 example: "user@example.com"
 *               password:
 *                 type: string
 *                 example: "password123"
 *               role:
 *                 type: string
 *                 example: "Student"
 *               gender:
 *                 type: string
 *                 example: "Male or Female"
 *               profileImg:
 *                 type: string
 *                 example: "image_url"
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Registration successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJtb3N0YWZhdGFtNzlAZ21haWwuY29tIiwicm9sZSI6bnVsbCwiaWF0IjoxNzM3MjQ2OTk0LCJleHAiOjE3MzcyNTA1OTR9.8ndOpujIZdHETyY4F9YnwHtaUo4Hkw9O9rQMvxGPTmE"
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 1
 *                         email:
 *                           type: string
 *                           example: "mostafatam79@gmail.com"
 *                         role:
 *                           type: string
 *                           example: "Student"
 *       403:
 *         description: OTP not verified
 *       500:
 *         description: Internal server error
 */

router.patch(
  "/registration",
  // upload.single("profileImg"),
  userController.registration
);

/**
 * @swagger
 * /users/send-otp:
 *   patch:
 *     summary: Send OTP to user's email
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.patch("/send-otp", userController.sendOTP);

/**
 * @swagger
 * /users/verify-otp:
 *   patch:
 *     summary: Verify OTP for the user
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *               otp:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid or expired OTP
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.patch("/verify-otp", userController.verifyOTP);

/**
 * @swagger
 * /users/reset-password:
 *   patch:
 *     summary: Reset the user's password
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *               newPassword:
 *                 type: string
 *                 example: "newpassword123"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       403:
 *         description: OTP not verified
 *       500:
 *         description: Internal server error
 */
router.patch("/reset-password", userController.resetPassword);

/**
 * @swagger
 * /users/send-auth:
 *   post:
 *     summary: Send OTP for authentication
 *     description: "⚠️ User must verify OTP before registration. Use `/users/send-otp` then put your email and otp `/users//verify-otp`  and complete OTP verification first."
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.post("/send-auth", authController.sendOtp);

/**
 * @swagger
 * /users/verfication-auth:
 *   patch:
 *     summary: Verify OTP for authentication
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *               otp:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid or expired OTP
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.patch("/verfication-auth", authController.verifyOTP);
/**
 * @swagger
 * /users/update-passowrd:
 *   patch:
 *     summary: Update the user's password
 *     tags: [User]
 *     security:
 *       - bearerAuth: []  # Requires authentication token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - old_password
 *               - new_password
 *             properties:
 *               old_password:
 *                 type: string
 *                 example: "OldPassword123!"
 *               new_password:
 *                 type: string
 *                 example: "NewSecurePassword456!"
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Bad request (e.g. missing fields)
 *       404:
 *         description: User not found
 *       500:
 *         description: Incorrect current password or internal server error
 */
router.patch("/update-passowrd", authenticateToken, updatePassword);

