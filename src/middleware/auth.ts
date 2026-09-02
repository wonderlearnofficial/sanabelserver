import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import logger from "../config/logger";
import User from "../models/user.model";

const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ status: 401, message: "Token required" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error("JWT_SECRET is not set in environment variables.");
    return res

      .status(500)
      .json({ status: 500, message: "Server configuration error" });
  }

  try {
    const user = jwt.verify(token, secret) as JwtPayload;

    if (!user?.id) {
      return res.status(403).json({
        status: 403,
        code: "TOKEN_INVALID",
        message: "Token is invalid",
      });
    }

    // A correctly signed token is not enough: the account may have been
    // deleted by an administrator while the user still has the app open.
    const account = await User.findByPk(user.id, {
      attributes: ["id", "email", "role", "tokenVersion", "isAccess"],
    });
    if (!account) {
      return res.status(401).json({
        status: 401,
        code: "ACCOUNT_DELETED",
        message: "Account no longer exists",
      });
    }

    if (!account.isAccess) {
      return res.status(401).json({
        status: 401,
        code: "ACCOUNT_DISABLED",
        message: "Account access has been disabled",
      });
    }

    // Never authorize from stale JWT identity data. Role changes must revoke
    // the old privileges immediately, and email is part of the signed identity.
    if (account.role !== user.role || account.email !== user.email) {
      return res.status(401).json({
        status: 401,
        code: "ACCOUNT_CHANGED",
        message: "Account security details changed. Sign in again.",
      });
    }

    // tokenVersion is intentionally required on access tokens. Tokens issued
    // before this security contract was introduced are logged out once rather
    // than being allowed to bypass password-reset revocation until expiry.
    if (
      !Number.isInteger(user.tokenVersion) ||
      Number(user.tokenVersion) !== Number(account.tokenVersion || 0)
    ) {
      return res.status(401).json({
        status: 401,
        code: "SESSION_REVOKED",
        message: "Session has been revoked. Sign in again.",
      });
    }

    (req as Request & { user?: JwtPayload }).user = {
      ...user,
      email: account.email,
      role: account.role,
      tokenVersion: account.tokenVersion || 0,
    };
    next();
  } catch (error) {
    if (error instanceof Error) {
      // Signal expiry distinctly so the client can silently refresh; any other
      // verification failure is a genuinely invalid token.
      if (error.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ status: 401, code: "TOKEN_EXPIRED", message: "Token expired" });
      }

      if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
        return res.status(403).json({
          status: 403,
          code: "TOKEN_INVALID",
          message: "Token is invalid",
        });
      }
    }

    logger.error("Token authentication failed:", { error });
    return res
      .status(500)
      .json({ status: 500, message: "Unable to authenticate session" });
  }
};

export { authenticateToken };
