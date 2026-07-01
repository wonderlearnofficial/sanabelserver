import { Request, Response, NextFunction } from "express";
import User from "../models/user.model";
import logger from "../config/logger";

import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Representative from "../models/representative.model";
import Class from "../models/class.model";
import Organization from "../models/oraganization.model";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import generateOTP from "../helpers/generateOtp";
import StudentTask from "../models/student-task.model"; // Import the StudentTask model
import Task from "../models/task.model"; // Import the Task model
import Challenge from "../models/challenge.model";
import StudentChallenge from "../models/student-challenge.model";
import { JwtPayload } from "jsonwebtoken";
import generateUniqueConnectCode from "../helpers/generateRandomconnectcode";
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
    // Removed sensitive logging of JWT_SECRET
    // Generate token with a secret and a defined expiration (24 hours)

    const token = jwt.sign(
      {
        id: account.id,
        email: account.email,
        role: account.role,
      },
      process.env.JWT_SECRET
    );

    // Prepare base response data
    const responseData = {
      user: {
        id: account.id,
        email: account.email,
        role: account.role,
        token: token,
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
            (sc) => sc.challengeId
          );
          const missingChallenges = allChallenges.filter(
            (challenge) => !existingChallengeIds.includes(challenge.id)
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
    // Removed sensitive logging of JWT_SECRET
    const hashedPassword = bcrypt.hashSync(password, 10);

    const token = jwt.sign(
      {
        id: checkValidation.id,
        email: checkValidation.email,
        role: checkValidation.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const validatedProfileImg =
      profileImg && typeof profileImg === "object" ? profileImg : null;

    // Handle Image Upload (get URL from Cloudinary)
    await checkValidation.update({
      firstName,
      lastName,
      role,
      gender,
      dateOfBirth,
      password: hashedPassword,
      profileImg: validatedProfileImg,
    });

    switch (checkValidation.role) {
      case "Student":
        const connectCode = await generateUniqueConnectCode();
        // Create student first
        const newStudent = await Student.create({
          grade,
          userId: checkValidation.id,
          profileImg,
          treeProgress: 1,
          connectCode,
        });

        // Then create all challenges for the student
        const allChallenges = await Challenge.findAll();
        const studentChallenges = allChallenges.map((challenge) => ({
          studentId: newStudent.id, // Use the new student's ID
          challengeId: challenge.id,
          completionStatus: "NotCompleted",
          pointOfStudent: 0,
        }));
        await StudentChallenge.bulkCreate(studentChallenges);
        break;
      case "Teacher":
        await Teacher.create({ userId: checkValidation.id });
        break;
      case "Parent":
        await Parent.create({ userId: checkValidation.id });
        break;
      default:
        break;
    }

    return res.status(201).json({
      message: "Registration successful",
      data: {
        token,
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
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST, // e.g., 'smtp.gmail.com' for Gmail, or your SMTP server
      port: Number(process.env.MAIL_PORT) || 587, // Default to 587 for non-secure, 465 for secure
      secure: false, // `true` for port 465, `false` for other ports
      auth: {
        user: process.env.MAIL_USERNAME, // Email username
        pass: process.env.MAIL_PASSWORD, // Email password
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code for Password Reset",
      text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
    };

    await transporter.sendMail(mailOptions);

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

    // Verify OTP and check expiry
    const isOtpValid =
      user.resetOTP === otp && user.otpExpiry && user.otpExpiry > new Date();
    if (!isOtpValid) {
      return res.status(400).json({
        status: 400,
        message: "Invalid or expired OTP",
      });
    }

    // OTP is valid, mark the user as verified
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
export {
  login,
  registration,
  sendOTP,
  verifyOTP,
  resetPassword,
  updatePassword,
};
