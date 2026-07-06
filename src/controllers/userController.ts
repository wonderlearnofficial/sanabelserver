import { Request, Response, NextFunction } from "express";
import User from "../models/user.model";
import logger from "../config/logger";

import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Representative from "../models/representative.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import Organization from "../models/oraganization.model";
import bcrypt from "bcryptjs";
import generateOTP from "../helpers/generateOtp";
import { sendEmail } from "../helpers/sendEmail";
import StudentTask from "../models/student-task.model"; // Import the StudentTask model
import Task from "../models/task.model"; // Import the Task model
import Challenge from "../models/challenge.model";
import StudentChallenge from "../models/student-challenge.model";
import { JwtPayload } from "jsonwebtoken";
import generateUniqueConnectCode from "../helpers/generateRandomconnectcode";
import { sendPrayerNotification } from "../services/prayerTimeService";
import {
  isOtpLocked,
  recordOtpFailure,
  clearOtpFailures,
} from "../helpers/otpGuard";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../helpers/tokens";
// import upload from "../config/cloudaryconfig"; // Import multer config

const jwt = require("jsonwebtoken");

const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    // Find the user by email
    const account = await User.findOne({ where: { email } });

    // Check if account exists
    if (!account) {
      return res.status(401).json({
        status: 401,
        message: "Incorrect email or password",
      });
    }

    // Check if password is correct
    if (!bcrypt.compareSync(password, account.password)) {
      return res.status(401).json({
        status: 401,
        message: "Incorrect email or password",
      });
    }
    // Short-lived access token plus a refresh token for silent renewal.
    const token = signAccessToken({
      id: account.id,
      email: account.email,
      role: account.role,
    });
    const refreshToken = signRefreshToken({
      id: account.id,
      email: account.email,
      role: account.role,
      tokenVersion: account.tokenVersion,
    });

    // Prepare base response data
    const responseData = {
      user: {
        id: account.id,
        email: account.email,
        role: account.role,
        token: token,
        refreshToken: refreshToken,
      },
    };

    // Handle role-specific logic
    if (account.role === "Student") {
      // Find the student record
      const student = await Student.findOne({ where: { userId: account.id } });

      if (student) {
        // Get all available challenges
        const allChallenges = await Challenge.findAll();

        // Get student's existing challenges
        const studentChallenges = await StudentChallenge.findAll({
          where: { studentId: student.id },
        });

        // Check if student has all challenges
        if (studentChallenges.length !== allChallenges.length) {
          // Find missing challenges
          const existingChallengeIds = studentChallenges.map(
            (sc) => sc.challengeId,
          );
          const missingChallenges = allChallenges.filter(
            (challenge) => !existingChallengeIds.includes(challenge.id),
          );

          // Add missing challenges
          if (missingChallenges.length > 0) {
            const newStudentChallenges = missingChallenges.map((challenge) => ({
              studentId: student.id,
              challengeId: challenge.id,
              completionStatus: "NotCompleted",
              pointOfStudent: 0,
            }));

            await StudentChallenge.bulkCreate(newStudentChallenges);
          }
        }
      }
    }

    // Return success response
    return res.status(200).json({
      status: 200,
      message: "Login successful",
      data: responseData,
    });
  } catch (error: any) {
    logger.error("Login error:", { error: error.message || error });
    return res.status(500).json({
      status: 500,
      message: "An error occurred during login",
      error: error.message,
    });
  }
};

// Registration function with role-based user creation

const registration = async (req: Request, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      dateOfBirth,
      gender,
      gradeId,
      grade,
      profileImg,
    } = req.body;

    const checkValidation = await User.findOne({ where: { email } });

    if (!checkValidation) {
      return res.status(403).json({
        message: "OTP record not found. Verify OTP before registering.",
      });
    }

    if (!checkValidation.isAccess) {
      return res.status(403).json({
        message: "OTP not verified. Verify OTP before resetting password.",
      });
    }

    if (checkValidation.password) {
      return res.status(403).json({
        message: "Email is already registered. Login or use another email.",
      });
    }
    const hashedPassword = bcrypt.hashSync(password, 10);

    const token = signAccessToken({
      id: checkValidation.id,
      email: checkValidation.email,
      role: checkValidation.role,
    });
    const refreshToken = signRefreshToken({
      id: checkValidation.id,
      email: checkValidation.email,
      role: checkValidation.role,
      tokenVersion: checkValidation.tokenVersion,
    });
    const validatedProfileImg =
      profileImg && typeof profileImg === "object" ? profileImg : null;

    if (!User.sequelize) {
      throw new Error("Database connection not established on User model");
    }

    await User.sequelize.transaction(async (t) => {
      // Handle Image Upload (get URL from Cloudinary)
      await checkValidation.update(
        {
          firstName,
          lastName,
          role,
          gender,
          dateOfBirth,
          password: hashedPassword,
          profileImg: validatedProfileImg,
        },
        { transaction: t },
      );

      switch (checkValidation.role) {
        case "Student":
          const connectCode = await generateUniqueConnectCode();
          let resolvedGradeId: number | undefined;
          let resolvedGradeName: string | undefined = grade;

          if (gradeId !== undefined && gradeId !== "" && gradeId !== null) {
            const gradeRecord = await Grade.findByPk(Number(gradeId), {
              transaction: t,
            });
            if (gradeRecord) {
              resolvedGradeId = gradeRecord.id;
              resolvedGradeName = gradeRecord.name;
            }
          }

          // Create student first
          const newStudent = await Student.create(
            {
              gradeId: resolvedGradeId,
              grade: resolvedGradeName || "",
              userId: checkValidation.id,
              profileImg,
              treeProgress: 1,
              connectCode,
            },
            { transaction: t },
          );

          // Then create all challenges for the student
          const allChallenges = await Challenge.findAll({ transaction: t });
          const studentChallenges = allChallenges.map((challenge) => ({
            studentId: newStudent.id, // Use the new student's ID
            challengeId: challenge.id,
            completionStatus: "NotCompleted",
            pointOfStudent: 0,
          }));
          await StudentChallenge.bulkCreate(studentChallenges, {
            transaction: t,
          });
          break;
        case "Teacher":
          await Teacher.create(
            { userId: checkValidation.id },
            { transaction: t },
          );
          break;
        case "Parent":
          await Parent.create(
            { userId: checkValidation.id },
            { transaction: t },
          );
          break;
        default:
          break;
      }
    });

    return res.status(201).json({
      message: "Registration successful",
      data: {
        token,
        refreshToken,
        user: {
          id: checkValidation.id,
          email: checkValidation.email,
          role,
          profileImg: validatedProfileImg,
        },
      },
    });
  } catch (error) {
    logger.error("Registration error:", { error });
    return res.status(500).json({ message: "Registration failed", error });
  }
};

const sendOTP = async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ status: 404, message: "User not found" });
    }

    // Generate OTP and set expiry time (e.g., 5 minutes from now)
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    // Update user with OTP and expiry
    await user.update({ resetOTP: otp, otpExpiry });

    // Send OTP to user via email
    await sendEmail({
      to: email,
      subject: "Your OTP Code for Password Reset",
      text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
    });

    return res.status(200).json({
      status: 200,
      message: "OTP sent successfully to your email.",
    });
  } catch (error) {
    logger.error("Error sending OTP:", { error, email });
    return res.status(500).json({
      status: 500,
      message: "Error sending OTP",
      error,
    });
  }
};

const verifyOTP = async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ status: 404, message: "User not found" });
    }

    // Reject while the account is temporarily locked from repeated wrong codes
    if (isOtpLocked(user)) {
      return res.status(429).json({
        status: 429,
        message: "Too many incorrect attempts. Please try again later.",
      });
    }

    // Verify OTP and check expiry
    const isOtpValid =
      user.resetOTP === otp && user.otpExpiry && user.otpExpiry > new Date();
    if (!isOtpValid) {
      await recordOtpFailure(user);
      return res.status(400).json({
        status: 400,
        message: "Invalid or expired OTP",
      });
    }

    // OTP is valid, mark the user as verified and clear the failure counter
    await clearOtpFailures(user);
    await user.update({ otpVerified: true });

    return res.status(200).json({
      status: 200,
      message: "OTP verified successfully",
    });
  } catch (error) {
    logger.error("Error verifying OTP:", { error, email });
    return res.status(500).json({
      status: 500,
      message: "Error verifying OTP",
      error,
    });
  }
};

const resetPassword = async (req: Request, res: Response) => {
  const { email, newPassword } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ status: 404, message: "User not found" });
    }

    // Check if OTP was verified recently
    if (!user.otpVerified) {
      return res.status(403).json({
        status: 403,
        message:
          "OTP not verified. Please verify OTP before resetting password.",
      });
    }

    // Hash the new password and update user record
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await user.update({
      password: hashedPassword,
      resetOTP: null,
      otpExpiry: null,
      otpVerified: false, // Clear the OTP verification flag
    });

    return res.status(200).json({
      status: 200,
      message: "Password reset successfully",
    });
  } catch (error) {
    logger.error("Error resetting password:", { error, email });
    return res.status(500).json({
      status: 500,
      message: "Error resetting password",
      error,
    });
  }
};

const updatePassword = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  const userRecord = await User.findOne({ where: { id: user.id } });
  if (!userRecord) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  const { old_password, new_password } = req.body;

  if (!bcrypt.compareSync(old_password, userRecord.password)) {
    return res.status(500).json({ message: "Incorrect current password" });
  }

  const hashedPassword = bcrypt.hashSync(new_password, 10);
  await userRecord.update({ password: hashedPassword });

  return res.status(200).json({ message: "Password updated successfully" });
};

const markGuideSeen = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;
  const { guideId } = req.body;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  if (!guideId || typeof guideId !== "string") {
    return res.status(400).json({ message: "Invalid guideId parameter" });
  }

  try {
    const userRecord = await User.findOne({ where: { id: user.id } });
    if (!userRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    const seenGuides: string[] = Array.isArray(userRecord.seenGuides)
      ? userRecord.seenGuides
      : [];

    if (!seenGuides.includes(guideId)) {
      seenGuides.push(guideId);
      await userRecord.update({ seenGuides });
    }

    return res
      .status(200)
      .json({ message: "Guide marked as seen", seenGuides });
  } catch (error) {
    logger.error("Error updating seen guides:", { error });
    return res
      .status(500)
      .json({ message: "Failed to update seen guides", error });
  }
};

// Exchange a valid, non-revoked refresh token for a fresh access token.
const refreshAccessToken = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res
      .status(401)
      .json({ status: 401, message: "Refresh token required" });
  }

  try {
    const payload: any = verifyRefreshToken(refreshToken);
    if (!payload || payload.type !== "refresh") {
      return res
        .status(403)
        .json({ status: 403, message: "Invalid refresh token" });
    }

    const user = await User.findByPk(payload.id);
    if (!user) {
      return res
        .status(403)
        .json({ status: 403, message: "Invalid refresh token" });
    }

    // A logout (tokenVersion bump) invalidates every previously issued refresh token.
    if ((user.tokenVersion || 0) !== (payload.tokenVersion || 0)) {
      return res
        .status(403)
        .json({ status: 403, message: "Refresh token revoked" });
    }

    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return res.status(200).json({ status: 200, data: { token } });
  } catch (error) {
    logger.error("Refresh token error:", { error });
    return res
      .status(403)
      .json({ status: 403, message: "Invalid or expired refresh token" });
  }
};

// Invalidate the current session's refresh tokens by rotating tokenVersion.
const logout = async (req: Request, res: Response) => {
  const authUser = (req as Request & { user?: JwtPayload }).user;
  if (!authUser) {
    return res.status(401).json({ status: 401, message: "Unauthorized" });
  }

  try {
    const user = await User.findByPk(authUser.id);
    if (user) {
      await user.update({ tokenVersion: (user.tokenVersion || 0) + 1 });
    }
    return res.status(200).json({ status: 200, message: "Logged out" });
  } catch (error) {
    logger.error("Logout error:", { error });
    return res.status(500).json({ status: 500, message: "Logout failed" });
  }
};

const subscribePushNotification = async (req: Request, res: Response) => {
  const authUser = (req as Request & { user?: JwtPayload }).user;
  if (!authUser) {
    return res.status(401).json({ status: 401, message: "Unauthorized" });
  }

  const { subscription, location } = req.body;

  try {
    const user = await User.findByPk(authUser.id);
    if (user) {
      await user.update({
        pushSubscription: subscription,
        location: location,
      });

      return res
        .status(200)
        .json({
          status: 200,
          message: "Subscribed to push notifications successfully",
        });
    } else {
      return res.status(404).json({ status: 404, message: "User not found" });
    }
  } catch (error) {
    logger.error("Subscribe push error:", { error });
    return res
      .status(500)
      .json({ status: 500, message: "Failed to subscribe" });
  }
};

export {
  login,
  registration,
  sendOTP,
  verifyOTP,
  resetPassword,
  updatePassword,
  markGuideSeen,
  refreshAccessToken,
  logout,
  subscribePushNotification,
};
