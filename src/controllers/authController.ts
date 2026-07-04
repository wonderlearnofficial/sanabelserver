import { Request, Response, NextFunction } from "express";
import User from "../models/user.model";
import logger from "../config/logger";

import generateOTP from "../helpers/generateOtp";
import { sendEmail } from "../helpers/sendEmail";
import { buildOtpEmail, LOGO_ATTACHMENTS } from "../helpers/emailTemplates";

const sendOtp = async (req: Request, res: Response) => {
  const { email } = req.body;
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
      await existingUser.update({
        resetOTP: otp,
        otpExpiry,
      });

      await sendEmail({
        to: email,
        subject: "Your OTP Code – Sanabel Al-Ihsan",
        text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
        html: buildOtpEmail(otp),
        attachments: LOGO_ATTACHMENTS,
      });

      return res.status(200).json({
        status: 200,
        message: "OTP sent successfully to your email.",
      });
    }

    await User.create({
      email,
      resetOTP: otp,
      otpExpiry,
    });

    await sendEmail({
      to: email,
      subject: "Your OTP Code – Sanabel Al-Ihsan",
      text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
      html: buildOtpEmail(otp),
      attachments: LOGO_ATTACHMENTS,
    });

    return res.status(200).json({
      status: 200,
      message: "OTP sent successfully to your email.",
    });
  } catch (error) {
    logger.error("Error sending OTP:", { error, email });
    return res.status(500).json({
      status: 500,
      error: error,
    });
  }
};

const verifyOTP = async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  try {
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
      error,
    });
  }
};
export { sendOtp, verifyOTP };
