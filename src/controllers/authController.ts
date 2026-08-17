import { Request, Response, NextFunction } from "express";
import User from "../models/user.model";
import logger from "../config/logger";

import generateOTP, {
  isValidOTP,
  OTP_LENGTH,
} from "../helpers/generateOtp";
import { EmailDeliveryError, sendEmail } from "../helpers/sendEmail";
import { buildOtpEmail, getEmailAttachments } from "../helpers/emailTemplates";
import {
  isOtpLocked,
  recordOtpFailure,
  clearOtpFailures,
} from "../helpers/otpGuard";

const sendOtp = async (req: Request, res: Response) => {
  const email = typeof req.body.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
  let otpUser: User | null = null;
  let createdForOtp = false;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      status: 400,
      code: "INVALID_EMAIL",
      message: "A valid email address is required",
    });
  }

  try {
    const existingUser = await User.findOne({ where: { email: email } });
    if (existingUser && existingUser.isAccess) {
      if (existingUser.password == null) {
        return res
          .status(202)
          .json({ status: 202, message: "you already access before" });
      } else {
        return res
          .status(400)
          .json({ status: 400, message: "Email already in use" });
      }
    }
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    if (existingUser && !existingUser.isAccess) {
      otpUser = existingUser;
      await existingUser.update({
        resetOTP: otp,
        otpExpiry,
      });

      await sendEmail({
        to: email,
        subject: "Your OTP Code – Sanabel Al-Ihsan",
        text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
        html: buildOtpEmail(otp),
        attachments: getEmailAttachments(),
      });

      return res.status(200).json({
        status: 200,
        message: "OTP sent successfully to your email.",
      });
    }

    otpUser = await User.create({
      email,
      resetOTP: otp,
      otpExpiry,
    });
    createdForOtp = true;

    await sendEmail({
      to: email,
      subject: "Your OTP Code – Sanabel Al-Ihsan",
      text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
      html: buildOtpEmail(otp),
      attachments: getEmailAttachments(),
    });

    return res.status(200).json({
      status: 200,
      message: "OTP sent successfully to your email.",
    });
  } catch (error) {
    logger.error("Error sending OTP:", { error, email });
    if (otpUser) {
      try {
        if (createdForOtp) {
          await otpUser.destroy();
        } else {
          await otpUser.update({ resetOTP: null, otpExpiry: null });
        }
      } catch (cleanupError) {
        logger.error("Failed to clean up OTP state after delivery error", {
          error: cleanupError,
          userId: otpUser.id,
        });
      }
    }

    const status = error instanceof EmailDeliveryError ? error.statusCode : 500;
    return res.status(status).json({
      status,
      code: error instanceof EmailDeliveryError
        ? "EMAIL_DELIVERY_FAILED"
        : "OTP_REQUEST_FAILED",
      message: error instanceof EmailDeliveryError
        ? "Email service is temporarily unavailable. Please try again."
        : "Unable to send OTP",
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
    await user.update({ isAccess: true, resetOTP: null, otpExpiry: null });

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
export { sendOtp, verifyOTP };
