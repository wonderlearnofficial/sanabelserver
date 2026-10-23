import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { Op } from "sequelize";
import User from "../models/user.model";
import logger from "../config/logger";
import AdminImpersonationHandoff from "../models/admin-impersonation-handoff.model";

import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Representative from "../models/representative.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import Organization from "../models/oraganization.model";
import bcrypt from "bcryptjs";
import generateOTP, {
  isValidOTP,
  OTP_LENGTH,
} from "../helpers/generateOtp";
import { sendEmail } from "../helpers/sendEmail";
import StudentTask from "../models/student-task.model"; // Import the StudentTask model
import Task from "../models/task.model"; // Import the Task model
import Challenge from "../models/challenge.model";
import StudentChallenge from "../models/student-challenge.model";
import { JwtPayload } from "jsonwebtoken";
import generateUniqueConnectCode from "../helpers/generateRandomconnectcode";
import {
  sendPrayerNotification,
  schedulePrayersForUser,
  cancelPrayersForUser,
  isPushReady,
} from "../services/prayerTimeService";
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

// How long a verified reset OTP may be spent on /users/reset-password.
const RESET_WINDOW_MS = 10 * 60 * 1000;

// Shared shape check for the public auth endpoints: a missing/empty field is a
// 400 that names it, never a Sequelize "where: { email: undefined }" 500.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const login = async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};

  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return res.status(400).json({
      status: 400,
      code: "MISSING_CREDENTIALS",
      message: "Email and password are required",
    });
  }

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

    if (!account.isAccess) {
      return res.status(401).json({
        status: 401,
        code: "ACCOUNT_DISABLED",
        message: "Account access has been disabled",
      });
    }

    // Verified email whose signup stopped before the password step: there is
    // nothing to compare against (bcrypt throws on null), so say so plainly.
    if (!account.password) {
      return res.status(409).json({
        status: 409,
        code: "ACCOUNT_SETUP_INCOMPLETE",
        message: "Account setup not completed. Finish signing up before logging in.",
      });
    }

    // Check if password is correct
    // Check if password is correct asynchronously (non-blocking)
    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) {
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
      tokenVersion: account.tokenVersion,
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
    } = req.body ?? {};

    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      return res.status(400).json({ message: "Email and password are required" });
    }

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
    // Public signup may only create the self-service roles. Any other value
    // (notably "Admin") would otherwise be written to Users.role as-is.
    if (!["Student", "Teacher", "Parent"].includes(role)) {
      return res.status(400).json({ message: "role must be one of Student, Teacher, Parent" });
    }
    const hashedPassword = bcrypt.hashSync(password, 10);

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

    // Sign only after the transaction has persisted the requested role. This
    // avoids issuing a token with the temporary OTP User row's default role.
    const tokenUser = {
      id: checkValidation.id,
      email: checkValidation.email,
      role: checkValidation.role,
      tokenVersion: checkValidation.tokenVersion,
    };
    const token = signAccessToken(tokenUser);
    const refreshToken = signRefreshToken(tokenUser);

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
    return res.status(500).json({ message: "Registration failed" });
  }
};

const sendOTP = async (req: Request, res: Response) => {
  const { email } = req.body ?? {};

  if (!isNonEmptyString(email) || !EMAIL_PATTERN.test(email.trim())) {
    return res.status(400).json({ status: 400, message: "A valid email is required" });
  }

  try {
    // Find user by email
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ status: 404, message: "User not found" });
    }

    // Generate OTP and set expiry time (e.g., 5 minutes from now)
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    // Update user with OTP and expiry. A new code revokes any earlier
    // verification, so an old verified flag cannot be used with it.
    await user.update({ resetOTP: otp, otpExpiry, otpVerified: false });

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
    });
  }
};

const verifyOTP = async (req: Request, res: Response) => {
  const email = typeof req.body.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
  const otp = String(req.body.otp || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isValidOTP(otp)) {
    return res.status(400).json({
      status: 400,
      message: `A valid email and ${OTP_LENGTH}-digit OTP are required`,
    });
  }

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

    // OTP is valid, mark the user as verified and clear the failure counter.
    // The code is single use, and the verification itself only stays good
    // for a short reset window (checked by resetPassword via otpExpiry).
    await clearOtpFailures(user);
    await user.update({
      otpVerified: true,
      resetOTP: null,
      otpExpiry: new Date(Date.now() + RESET_WINDOW_MS),
    });

    return res.status(200).json({
      status: 200,
      message: "OTP verified successfully",
    });
  } catch (error) {
    logger.error("Error verifying OTP:", { error, email });
    return res.status(500).json({
      status: 500,
      message: "Error verifying OTP",
    });
  }
};

const resetPassword = async (req: Request, res: Response) => {
  const { email, newPassword } = req.body ?? {};

  if (!isNonEmptyString(email) || !isNonEmptyString(newPassword)) {
    return res.status(400).json({
      status: 400,
      message: "Email and newPassword are required",
    });
  }

  try {
    // Find user by email
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ status: 404, message: "User not found" });
    }

    // Check if OTP was verified recently: the flag only counts inside the
    // reset window verifyOTP opened, so a stale verification cannot be used.
    if (!user.otpVerified || !user.otpExpiry || user.otpExpiry <= new Date()) {
      return res.status(403).json({
        status: 403,
        message:
          "OTP not verified. Please verify OTP before resetting password.",
      });
    }

    // Hash the new password and update user record. Conditional on the
    // flag still being set, so check-and-clear is one atomic statement and a
    // verification can be spent exactly once even by concurrent requests.
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const updateResult: any = await User.update(
      {
        password: hashedPassword,
        resetOTP: null,
        otpExpiry: null,
        otpVerified: false, // Clear the OTP verification flag
        tokenVersion: (user.tokenVersion || 0) + 1,
      },
      { where: { id: user.id, otpVerified: true } },
    );
    const affected = Array.isArray(updateResult) ? updateResult[0] : updateResult;
    if (!affected) {
      return res.status(403).json({
        status: 403,
        message:
          "OTP not verified. Please verify OTP before resetting password.",
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Password reset successfully",
    });
  } catch (error) {
    logger.error("Error resetting password:", { error, email });
    return res.status(500).json({
      status: 500,
      message: "Error resetting password",
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

  const isMatch = await bcrypt.compare(old_password, userRecord.password);
  if (!isMatch) {
    return res.status(500).json({ message: "Incorrect current password" });
  }

  const hashedPassword = await bcrypt.hash(new_password, 10);
  await userRecord.update({
    password: hashedPassword,
    tokenVersion: (userRecord.tokenVersion || 0) + 1,
  });

  return res.status(200).json({
    message: "Password updated successfully",
    reauthenticationRequired: true,
  });
};

const markGuideSeen = async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;
  const { guideId } = req.body;

  if (!user) {
    return res.status(404).json({ message: "User data not found in request" });
  }

  // An impersonated session belongs to an admin looking at the account, not to
  // its owner. Marking a guide seen here would silently destroy onboarding the
  // real user never received, so the write is refused rather than scoped.
  if (user.imp === true) {
    return res.status(403).json({
      status: 403,
      code: "IMPERSONATED_SESSION",
      message: "An impersonated session cannot change this user's guide state",
    });
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
      return res.status(401).json({
        status: 401,
        code: "ACCOUNT_DELETED",
        message: "Account no longer exists",
      });
    }

    if (!user.isAccess) {
      return res.status(401).json({
        status: 401,
        code: "ACCOUNT_DISABLED",
        message: "Account access has been disabled",
      });
    }

    // A logout (tokenVersion bump) invalidates every previously issued refresh token.
    if ((user.tokenVersion || 0) !== (payload.tokenVersion || 0)) {
      return res
        .status(401)
        .json({
          status: 401,
          code: "SESSION_REVOKED",
          message: "Refresh token revoked",
        });
    }

    if (user.role !== payload.role || user.email !== payload.email) {
      return res.status(401).json({
        status: 401,
        code: "ACCOUNT_CHANGED",
        message: "Account security details changed. Sign in again.",
      });
    }

    const tokenUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      // Preserved across renewal: refreshing an impersonated session must not
      // hand back an ordinary token with the impersonation marker dropped.
      imp: payload.imp === true,
    };
    const token = signAccessToken(tokenUser);
    // Rotate the refresh token on every renewal. This gives active sessions a
    // sliding lifetime while logout can still revoke the entire token family
    // through tokenVersion.
    const nextRefreshToken = signRefreshToken(tokenUser);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      status: 200,
      data: { token, refreshToken: nextRefreshToken },
    });
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

  if (!subscription || typeof subscription !== "object" || !subscription.endpoint) {
    return res
      .status(400)
      .json({ status: 400, message: "A valid push subscription is required" });
  }
  if (
    !location ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number"
  ) {
    return res.status(400).json({
      status: 400,
      message: "A location with numeric latitude and longitude is required",
    });
  }

  try {
    const user = await User.findByPk(authUser.id);
    if (user) {
      await user.update({
        pushSubscription: subscription,
        location: location,
      });

      // Start notifying today — not only after the next midnight run.
      schedulePrayersForUser(user, new Date());

      return res.status(200).json({
        status: 200,
        message: "Subscribed to push notifications successfully",
        pushEnabled: isPushReady(),
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

const unsubscribePushNotification = async (req: Request, res: Response) => {
  const authUser = (req as Request & { user?: JwtPayload }).user;
  if (!authUser) {
    return res.status(401).json({ status: 401, message: "Unauthorized" });
  }

  try {
    const user = await User.findByPk(authUser.id);
    if (!user) {
      return res.status(404).json({ status: 404, message: "User not found" });
    }

    cancelPrayersForUser(user.id);
    await user.update({ pushSubscription: null, location: null });

    return res.status(200).json({
      status: 200,
      message: "Unsubscribed from push notifications successfully",
    });
  } catch (error) {
    logger.error("Unsubscribe push error:", { error });
    return res
      .status(500)
      .json({ status: 500, message: "Failed to unsubscribe" });
  }
};

const exchangeImpersonationHandoff = async (req: Request, res: Response) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== "string") {
      return res
        .status(400)
        .json({ status: 400, message: "Handoff code is required" });
    }

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const now = new Date();

    // Atomically attempt to claim the code
    const [updatedCount] = await AdminImpersonationHandoff.update(
      { usedAt: now },
      {
        where: {
          codeHash,
          usedAt: null,
          expiresAt: { [Op.gt]: now },
        },
      }
    );

    if (updatedCount === 0) {
      // Find out why it failed to update
      const handoff = await AdminImpersonationHandoff.findOne({
        where: { codeHash },
      });

      if (!handoff) {
        return res.status(401).json({
          status: 401,
          code: "INVALID_CODE",
          message: "Invalid or nonexistent impersonation handoff code",
        });
      }

      if (handoff.usedAt) {
        return res.status(409).json({
          status: 409,
          code: "CODE_ALREADY_USED",
          message: "This impersonation handoff code has already been redeemed",
        });
      }

      if (handoff.expiresAt && handoff.expiresAt <= now) {
        return res.status(401).json({
          status: 401,
          code: "CODE_EXPIRED",
          message: "This impersonation handoff code has expired",
        });
      }

      return res.status(401).json({
        status: 401,
        code: "INVALID_CODE",
        message: "Unable to redeem impersonation handoff code",
      });
    }

    // Successfully claimed! Fetch the record
    const handoff = await AdminImpersonationHandoff.findOne({
      where: { codeHash },
    });

    if (!handoff) {
      return res.status(404).json({
        status: 404,
        message: "Handoff record not found after update",
      });
    }

    const user = await User.findByPk(handoff.targetUserId);
    if (!user) {
      return res.status(404).json({
        status: 404,
        message: "Target user not found",
      });
    }

    const student = await Student.findByPk(handoff.targetStudentId);

    // Sync challenges if student
    if (student) {
      const allChallenges = await Challenge.findAll();
      const studentChallenges = await StudentChallenge.findAll({
        where: { studentId: student.id },
      });

      if (studentChallenges.length !== allChallenges.length) {
        const existingChallengeIds = studentChallenges.map(
          (sc: any) => sc.challengeId,
        );
        const missingChallenges = allChallenges.filter(
          (challenge: any) => !existingChallengeIds.includes(challenge.id),
        );

        if (missingChallenges.length > 0) {
          const newStudentChallenges = missingChallenges.map((challenge: any) => ({
            studentId: student.id,
            challengeId: challenge.id,
            completionStatus: "NotCompleted",
            pointOfStudent: 0,
          }));

          await StudentChallenge.bulkCreate(newStudentChallenges);
        }
      }
    }

    const tokenUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      // Marks every token minted through impersonation. Endpoints that write
      // the target account's own onboarding state refuse a marked session, so
      // an admin looking at a Student can never consume that Student's guides.
      imp: true,
    };
    const token = signAccessToken(tokenUser);
    const refreshToken = signRefreshToken(tokenUser);

    if (typeof res.setHeader === "function") {
      res.setHeader("Cache-Control", "no-store");
    }
    return res.status(200).json({
      status: 200,
      message: "Impersonation session established successfully",
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
          studentId: student ? student.id : null,
          token,
          refreshToken,
          isImpersonated: true,
          impersonatedByAdminId: handoff.actorAdminUserId,
        },
      },
    });
  } catch (error) {
    logger.error("Error exchanging impersonation handoff:", { error });
    return res
      .status(500)
      .json({ status: 500, message: "Internal Server Error" });
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
  unsubscribePushNotification,
  exchangeImpersonationHandoff,
};

