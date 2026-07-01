import { Request, Response, NextFunction } from "express";
import User from "../models/user.model";
import logger from "../config/logger";


import nodemailer from "nodemailer";
import generateOTP from "../helpers/generateOtp";

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
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST, // e.g., 'smtp.gmail.com' for Gmail, or your SMTP server
      port: Number(process.env.MAIL_PORT) || 587, // Default to 587 for non-secure, 465 for secure
      secure: false, // `true` for port 465, `false` for other ports
      auth: {
        user: process.env.MAIL_USERNAME, // Email username
        pass: process.env.MAIL_PASSWORD, // Email password
      },
    });

    if (existingUser && !existingUser.isAccess) {
      await existingUser.update({
        resetOTP: otp,
        otpExpiry,
      });

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Your OTP Code for Access you account",
        text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
      };

      await transporter.sendMail(mailOptions);

      return res.status(200).json({
        status: 200,
        message: "OTP sent successfully to your email.",
      });
    }

    const newOtp = await User.create({
      email,
      resetOTP: otp,
      otpExpiry,
    });
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code for Access you account",
      text: `Your OTP code is ${otp}. It is valid for 5 minutes.`,
    };
    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      status: 200,
      message: "OTP sent successfully to your email.",
    });
  } catch (error) {
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
