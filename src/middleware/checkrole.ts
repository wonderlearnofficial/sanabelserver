import { JwtPayload } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import Student from "../models/student.model";
import User from "../models/user.model";
import logger from "../config/logger";


const checkstudent = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(401).json({ message: "User data not found in request" });
  }

  if (user.role == "Student") {
    (req as Request & { user?: JwtPayload }).user = user as JwtPayload;
    next();
  } else {
    logger.warn("Unauthorized access attempt: Not a Student", { userEmail: user.email, actualRole: user.role });
    return res
      .status(403)
      .json({ status: 403, message: "the User Unauthrised" });
  }
};

const checkTeacher = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(401).json({ message: "User data not found in request" });
  }

  if (user.role == "Teacher") {
    (req as Request & { user?: JwtPayload }).user = user as JwtPayload;
    next();
  } else {
    logger.warn("Unauthorized access attempt: Not a Teacher", { userEmail: user.email, actualRole: user.role });
    return res
      .status(403)
      .json({ status: 403, message: "the User Unauthrised" });
  }
};

const checkparent = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(401).json({ message: "User data not found in request" });
  }

  if (user.role == "Parent") {
    (req as Request & { user?: JwtPayload }).user = user as JwtPayload;
    next();
  } else {
    logger.warn("Unauthorized access attempt: Not a Parent", { userEmail: user.email, actualRole: user.role });
    return res
      .status(403)
      .json({ status: 403, message: "the User Unauthrised" });
  }
};

const checkAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = (req as Request & { user: JwtPayload | undefined }).user;

  if (!user) {
    return res.status(401).json({ message: "User data not found in request" });
  }

  if (user.role == "Admin") {
    (req as Request & { user?: JwtPayload }).user = user as JwtPayload;
    next();
  } else {
    logger.warn("Unauthorized access attempt: Not an Admin", { userEmail: user.email, actualRole: user.role });
    return res
      .status(403)
      .json({ status: 403, message: "the User Unauthrised" });
  }
};

export { checkstudent, checkTeacher, checkparent, checkAdmin };
