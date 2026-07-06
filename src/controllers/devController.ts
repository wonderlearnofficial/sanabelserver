import { Request, Response } from "express";
import User from "../models/user.model";
import logger from "../config/logger";
import { signAccessToken } from "../helpers/tokens";

// Everything in this controller is a local-development convenience only —
// it issues login tokens without a password, so it must never respond
// outside of a non-production environment.
const isDevEnvironment = () => process.env.NODE_ENV !== "production";

const listUsersForDevLogin = async (req: Request, res: Response) => {
  if (!isDevEnvironment()) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const users = await User.findAll({
      where: { isAccess: true },
      attributes: ["id", "firstName", "lastName", "email", "role"],
      order: [["role", "ASC"], ["id", "ASC"]],
    });

    const grouped: Record<string, any[]> = {
      Student: [],
      Teacher: [],
      Parent: [],
      Admin: [],
    };

    users.forEach((user) => {
      const bucket = grouped[user.role];
      if (bucket) {
        bucket.push({
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        });
      }
    });

    return res.status(200).json({ data: grouped });
  } catch (error) {
    logger.error("Error in listUsersForDevLogin:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const loginAsUser = async (req: Request, res: Response) => {
  if (!isDevEnvironment()) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return res.status(200).json({
      data: { token, email: user.email, role: user.role },
    });
  } catch (error) {
    logger.error("Error in loginAsUser:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export { listUsersForDevLogin, loginAsUser };
