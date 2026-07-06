import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import Student from "../models/student.model";
import User from "../models/user.model";
import Task from "../models/task.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Class from "../models/class.model";
import MissionApprovalRequest, {
  ApprovalStatus,
  ApproverType,
} from "../models/mission-approval-request.model";
import { completeMissionForStudent } from "../helpers/completeMission";
import logger from "../config/logger";

// Who is currently eligible to approve this student's missions — shared by
// requestApproval (to snapshot onto the request) and myApprovers (read-only
// check the client uses to decide whether to show "Link Parent" upfront).
const getEligibleApprovers = async (student: Student) => {
  const parentIds = student.ParentId ? [student.ParentId] : [];
  let teacherIds: number[] = [];

  if (student.classId) {
    const studentClass = await Class.findByPk(student.classId);
    if (studentClass && (studentClass as any).teacherId) {
      teacherIds = [(studentClass as any).teacherId];
    }
  }

  return { parentIds, teacherIds };
};

// ── Student: request approval ───────────────────────────────────────────────
const requestApproval = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });

    const { taskId, missionDate, approverId, approverType } = req.body;
    if (typeof taskId !== "number") {
      return res.status(400).json({ message: "Invalid taskId parameter" });
    }
    const date =
      typeof missionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(missionDate)
        ? missionDate
        : new Date().toISOString().split("T")[0];

    // Only school-affiliated students go through the approval workflow —
    // personal students keep completing missions instantly via add-pros.
    if (!student.classId) {
      return res.status(400).json({
        message: "This account does not require mission approval",
      });
    }

    const task = await Task.findByPk(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    let parentIds: number[] = [];
    let teacherIds: number[] = [];

    if (approverId && approverType) {
      if (approverType === "parent") {
        parentIds = [Number(approverId)];
      } else if (approverType === "teacher") {
        teacherIds = [Number(approverId)];
      }
    } else {
      // Fallback/Legacy: snapshot both
      const eligible = await getEligibleApprovers(student);
      parentIds = eligible.parentIds;
      teacherIds = eligible.teacherIds;
    }

    if (parentIds.length === 0 && teacherIds.length === 0) {
      return res.status(400).json({
        message:
          "No parent or teacher is available to approve your mission. Link a parent from Profile → Parent Accounts or contact your school.",
      });
    }

    const existing = await MissionApprovalRequest.findAll({
      where: { studentId: student.id, missionId: taskId, missionDate: date },
    });
    if (existing.some((r) => r.status === ApprovalStatus.Pending)) {
      return res.status(400).json({ message: "Approval request already sent." });
    }
    if (existing.some((r) => r.status === ApprovalStatus.Approved)) {
      return res.status(400).json({ message: "Mission already approved for this date" });
    }

    const request = await MissionApprovalRequest.create({
      studentId: student.id,
      missionId: taskId,
      missionDate: date,
      status: ApprovalStatus.Pending,
      parentIds,
      teacherIds,
    });

    return res.status(201).json({ data: request });
  } catch (error) {
    logger.error("Error in requestApproval:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ── Shared resolve logic (approve/deny) used by both parent & teacher ──────
interface ResolveParams {
  requestId: number;
  approverId: number;
  approverType: "parent" | "teacher";
  decision: "approved" | "denied";
}

const resolveApprovalRequest = async ({
  requestId,
  approverId,
  approverType,
  decision,
}: ResolveParams): Promise<{ status: number; body: any }> => {
  return MissionApprovalRequest.sequelize.transaction(async (t: any) => {
    const request = await MissionApprovalRequest.findByPk(requestId, {
      transaction: t,
    });
    if (!request) return { status: 404, body: { message: "Request not found" } };

    const eligibleIds: number[] =
      approverType === ApproverType.Parent ? request.parentIds : request.teacherIds;
    if (!(eligibleIds || []).includes(approverId)) {
      return {
        status: 403,
        body: { message: "Not authorized to act on this request" },
      };
    }

    // Atomic conditional update: only a request still "pending" gets
    // flipped. MySQL/InnoDB evaluates this WHERE against the latest
    // committed row for UPDATE statements, so if two approvers race, the
    // loser's UPDATE matches zero rows instead of double-applying rewards —
    // "first approval wins" without needing explicit row locking.
    const [affectedCount] = await MissionApprovalRequest.update(
      {
        status: decision,
        approvedById: approverId,
        approvedByType: approverType,
        approvedAt: new Date(),
      },
      { where: { id: requestId, status: ApprovalStatus.Pending }, transaction: t }
    );

    if (affectedCount === 0) {
      return {
        status: 409,
        body: { message: "This request has already been resolved" },
      };
    }

    if (decision === ApprovalStatus.Approved) {
      await completeMissionForStudent({
        studentId: request.studentId,
        taskId: request.missionId,
        missionDate: request.missionDate,
        approverId,
        approverType,
        transaction: t,
      });

      // Delete other pending requests for the same student and mission to prevent duplicates
      await MissionApprovalRequest.destroy({
        where: {
          studentId: request.studentId,
          missionId: request.missionId,
          status: ApprovalStatus.Pending,
        },
        transaction: t,
      });
      logger.info(`Cleaned up duplicate pending requests for student ${request.studentId} and mission ${request.missionId}`);
    }

    const updated = await MissionApprovalRequest.findByPk(requestId, {
      transaction: t,
    });
    return { status: 200, body: { data: updated } };
  });
};

// ── Parent endpoints ─────────────────────────────────────────────────────────
const listPendingRequestsForParent = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const parent = await Parent.findOne({ where: { userId: user.id } });
    if (!parent) return res.status(404).json({ message: "Parent not found" });

    const pending = await MissionApprovalRequest.findAll({
      where: { status: ApprovalStatus.Pending },
      include: [
        {
          model: Student,
          as: "Student",
          include: [
            { model: User, as: "User", attributes: ["firstName", "lastName", "profileImg"] },
            { model: Class, as: "Class", attributes: ["id", "classname", "grade"], required: false },
          ],
        },
        { model: Task, as: "Mission" },
      ],
      order: [["createdAt", "ASC"]],
    });

    const mine = pending.filter((r) => (r.parentIds || []).includes(parent.id));
    return res.status(200).json({ data: mine });
  } catch (error) {
    logger.error("Error in listPendingRequestsForParent:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const approveRequestAsParent = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const parent = await Parent.findOne({ where: { userId: user.id } });
    if (!parent) return res.status(404).json({ message: "Parent not found" });

    const { requestId } = req.body;
    if (typeof requestId !== "number") {
      return res.status(400).json({ message: "Invalid requestId parameter" });
    }

    const result = await resolveApprovalRequest({
      requestId,
      approverId: parent.id,
      approverType: ApproverType.Parent,
      decision: ApprovalStatus.Approved,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error in approveRequestAsParent:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const denyRequestAsParent = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const parent = await Parent.findOne({ where: { userId: user.id } });
    if (!parent) return res.status(404).json({ message: "Parent not found" });

    const { requestId } = req.body;
    if (typeof requestId !== "number") {
      return res.status(400).json({ message: "Invalid requestId parameter" });
    }

    const result = await resolveApprovalRequest({
      requestId,
      approverId: parent.id,
      approverType: ApproverType.Parent,
      decision: ApprovalStatus.Denied,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error in denyRequestAsParent:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ── Teacher endpoints ────────────────────────────────────────────────────────
const listPendingRequestsForTeacher = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    const pending = await MissionApprovalRequest.findAll({
      where: { status: ApprovalStatus.Pending },
      include: [
        {
          model: Student,
          as: "Student",
          include: [
            { model: User, as: "User", attributes: ["firstName", "lastName", "profileImg"] },
            { model: Class, as: "Class", attributes: ["id", "classname", "grade"], required: false },
          ],
        },
        { model: Task, as: "Mission" },
      ],
      order: [["createdAt", "ASC"]],
    });

    const mine = pending.filter((r) => (r.teacherIds || []).includes(teacher.id));
    return res.status(200).json({ data: mine });
  } catch (error) {
    logger.error("Error in listPendingRequestsForTeacher:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const approveRequestAsTeacher = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    const { requestId } = req.body;
    if (typeof requestId !== "number") {
      return res.status(400).json({ message: "Invalid requestId parameter" });
    }

    const result = await resolveApprovalRequest({
      requestId,
      approverId: teacher.id,
      approverType: ApproverType.Teacher,
      decision: ApprovalStatus.Approved,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error in approveRequestAsTeacher:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const denyRequestAsTeacher = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const teacher = await Teacher.findOne({ where: { userId: user.id } });
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    const { requestId } = req.body;
    if (typeof requestId !== "number") {
      return res.status(400).json({ message: "Invalid requestId parameter" });
    }

    const result = await resolveApprovalRequest({
      requestId,
      approverId: teacher.id,
      approverType: ApproverType.Teacher,
      decision: ApprovalStatus.Denied,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error in denyRequestAsTeacher:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ── Student: am I even able to request approval right now? ─────────────────
// A student-level check (independent of any specific mission) so the client
// can show "Link Parent" upfront instead of only discovering the lack of an
// approver after tapping Request Approval. Names are included so the
// confirmation dialog can tell the student who they're actually sending the
// request to, instead of a generic "your parent or teacher".
const getMyApprovers = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });

    const { parentIds, teacherIds } = await getEligibleApprovers(student);

    const [parents, teachers] = await Promise.all([
      parentIds.length > 0
        ? Parent.findAll({
            where: { id: parentIds },
            include: [{ model: User, as: "User", attributes: ["firstName", "lastName"] }],
          })
        : [],
      teacherIds.length > 0
        ? Teacher.findAll({
            where: { id: teacherIds },
            include: [{ model: User, as: "User", attributes: ["firstName", "lastName"] }],
          })
        : [],
    ]);

    const approvers = [
      ...parents.map((p: any) => ({
        id: p.id,
        type: "parent",
        name: `${p.User?.firstName || ""} ${p.User?.lastName || ""}`.trim(),
      })),
      ...teachers.map((t: any) => ({
        id: t.id,
        type: "teacher",
        name: `${t.User?.firstName || ""} ${t.User?.lastName || ""}`.trim(),
      })),
    ];

    return res.status(200).json({
      data: {
        hasParent: parentIds.length > 0,
        hasTeacher: teacherIds.length > 0,
        approvers,
      },
    });
  } catch (error) {
    logger.error("Error in getMyApprovers:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ── Student: check my own pending/approved/denied status for a mission ─────
const getMyRequestStatus = async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user?: JwtPayload }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });

    const { taskId, missionDate } = req.query;
    const date =
      typeof missionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(missionDate)
        ? missionDate
        : new Date().toISOString().split("T")[0];

    const requests = await MissionApprovalRequest.findAll({
      where: { studentId: student.id, missionId: Number(taskId), missionDate: date },
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({ data: requests[0] || null });
  } catch (error) {
    logger.error("Error in getMyRequestStatus:", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export {
  requestApproval,
  listPendingRequestsForParent,
  approveRequestAsParent,
  denyRequestAsParent,
  listPendingRequestsForTeacher,
  approveRequestAsTeacher,
  denyRequestAsTeacher,
  getMyApprovers,
  getMyRequestStatus,
};
