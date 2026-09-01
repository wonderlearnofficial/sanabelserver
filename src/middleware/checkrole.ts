import { JwtPayload } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import Student from "../models/student.model";
import User from "../models/user.model";
import Admin from "../models/admin.model";
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

  // Resolve the acting admin's organization scope for this request.
  // null organizationId = super admin (sees everything); a value locks every
  // /admin endpoint to that school. Looked up per request (not stored in the
  // JWT) so scope changes take effect without re-login.
  //
  // Admins is authoritative (database V2). Users.organizationId remains only
  // as a transitional fallback for an admin whose Admins row does not exist
  // yet — e.g. an account created between the backfill and a later deploy.
  // Scope is never taken from the request body, query or client storage.
  if (user.role === "Admin") {
    const [adminProfile, userRecord] = await Promise.all([
      Admin.findOne({ where: { userId: user.id }, attributes: ["id", "organizationId"] }),
      User.findByPk(user.id, { attributes: ["id", "organizationId"] }),
    ]);
    if (!userRecord) {
      logger.warn("Admin token for a user that no longer exists", { userId: user.id });
      return res.status(401).json({ message: "User data not found in request" });
    }
    if (!adminProfile) {
      logger.warn("Admin has no Admins profile row; falling back to legacy user scope", {
        userId: user.id,
      });
    }
    const request = req as Request & {
      adminOrganizationId?: number | null;
      admin?: Admin | null;
    };
    request.admin = adminProfile;
    request.adminOrganizationId = adminProfile
      ? adminProfile.organizationId ?? null
      : userRecord.organizationId ?? null;
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

// Super-admin-only gate. Must run AFTER authenticateToken and checkAdmin, which
// resolve scope from the Admins table. A school admin, teacher, parent or
// student receives 403 here regardless of what URL they know or what the client
// chooses to render — the frontend hiding navigation is not the control.
const requireSuperAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = (req as Request & { user?: JwtPayload }).user;
  if (!user) {
    return res.status(401).json({ status: 401, message: "User data not found in request" });
  }
  if (user.role !== "Admin") {
    logger.warn("Super-admin route refused: not an Admin", {
      userId: user.id,
      actualRole: user.role,
    });
    return res.status(403).json({ status: 403, message: "Super Admin access required" });
  }

  const request = req as Request & {
    adminOrganizationId?: number | null;
    admin?: Admin | null;
  };

  // Re-resolve rather than trusting a possibly-unset request field, so this
  // middleware is safe even if mounted without checkAdmin ahead of it.
  let scope = request.adminOrganizationId;
  if (scope === undefined) {
    const adminProfile = await Admin.findOne({
      where: { userId: user.id },
      attributes: ["id", "organizationId"],
    });
    if (adminProfile) {
      scope = adminProfile.organizationId ?? null;
      request.admin = adminProfile;
    } else {
      const userRecord = await User.findByPk(user.id, { attributes: ["id", "organizationId"] });
      scope = userRecord?.organizationId ?? null;
    }
    request.adminOrganizationId = scope;
  }

  if (scope !== null) {
    logger.warn("Super-admin route refused: school-scoped admin", {
      userId: user.id,
      organizationId: scope,
    });
    return res.status(403).json({ status: 403, message: "Super Admin access required" });
  }

  return next();
};

export { checkstudent, checkTeacher, checkparent, checkAdmin, requireSuperAdmin };
