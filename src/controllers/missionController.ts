import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import Student from "../models/student.model";
import User from "../models/user.model";
import Task from "../models/task.model";
import Teacher from "../models/teacher.model";
import Parent from "../models/parent.model";
import Class from "../models/class.model";
import MissionApprovalRequest, { ApprovalStatus, ApproverType } from "../models/mission-approval-request.model";
import StudentTodoItem, { TodoItemStatus } from "../models/student-todo-item.model";
import StudentTodoDay from "../models/student-todo-day.model";
import MissionApprovalRequestEvent, { ApprovalEventType } from "../models/mission-approval-request-event.model";
import { completeMissionForStudent } from "../helpers/completeMission";
import { activeTodoKey, ensureTodoDay, findCompletion, isCanonicalDate, utcGameplayDate, withDeadlockRetry } from "../services/studentTodoService";
import logger from "../config/logger";

const currentUser = (req: Request) => (req as Request & { user?: JwtPayload }).user;

const getEligibleApprovers = async (student: Student) => {
  const parentIds = student.ParentId ? [student.ParentId] : [];
  let teacherIds: number[] = [];
  if (student.classId) {
    const studentClass = await Class.findByPk(student.classId);
    if (studentClass && (studentClass as any).teacherId) teacherIds = [(studentClass as any).teacherId];
  }
  return { parentIds, teacherIds };
};

const requestApproval = async (req: Request, res: Response) => {
  try {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });
    if (!student.classId) return res.status(400).json({ message: "This account does not require mission approval" });
    const taskId = Number(req.body.taskId);
    const todoItemId = req.body.todoItemId == null ? null : Number(req.body.todoItemId);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return res.status(400).json({ message: "Invalid taskId parameter" });
    if (!(await Task.findByPk(taskId))) return res.status(404).json({ message: "Task not found" });

    const eligible = await getEligibleApprovers(student);
    let parentIds = eligible.parentIds;
    let teacherIds = eligible.teacherIds;
    if (req.body.approverId && req.body.approverType) {
      const id = Number(req.body.approverId);
      const type = req.body.approverType;
      const allowed = type === ApproverType.Parent ? parentIds.includes(id) : type === ApproverType.Teacher ? teacherIds.includes(id) : false;
      if (!allowed) return res.status(403).json({ message: "Selected approver is not eligible for this Student" });
      parentIds = type === ApproverType.Parent ? [id] : [];
      teacherIds = type === ApproverType.Teacher ? [id] : [];
    }
    if (parentIds.length === 0 && teacherIds.length === 0) {
      return res.status(400).json({ message: "No parent or teacher is available to approve your mission." });
    }
    const missionDate = utcGameplayDate();
    const result = await withDeadlockRetry(() => Student.sequelize.transaction(async (transaction: any) => {
      const todo = await StudentTodoItem.findOne({
        where: todoItemId
          ? { id: todoItemId, studentId: student.id, taskId, isActive: true }
          : { activeKey: activeTodoKey(student.id, taskId), studentId: student.id, taskId, isActive: true },
        transaction, lock: transaction?.LOCK?.UPDATE,
      });
      if (!todo) return { status: 404, body: { message: "Add this mission to your To-Do before requesting approval" } };
      const day = await ensureTodoDay(todo, missionDate, transaction);
      if (day.status === TodoItemStatus.Completed || await findCompletion(student.id, taskId, missionDate, transaction)) {
        return { status: 200, body: { message: "Mission already completed today", alreadyCompleted: true } };
      }
      const pending = await MissionApprovalRequest.findOne({
        where: { studentId: student.id, missionId: taskId, missionDate, status: ApprovalStatus.Pending }, transaction, lock: transaction?.LOCK?.UPDATE,
      });
      if (pending) return { status: 200, body: { data: pending, alreadyPending: true } };
      const approval = await MissionApprovalRequest.create({ studentId: student.id, missionId: taskId,
        missionDate, todoItemId: todo.id, todoDayId: day.id, status: ApprovalStatus.Pending, parentIds, teacherIds }, { transaction });
      await MissionApprovalRequestEvent.create({
        requestId: approval.id,
        eventType: ApprovalEventType.Requested,
        actorUserId: user.id,
        targetApproverType: parentIds.length + teacherIds.length === 1
          ? (parentIds.length === 1 ? "parent" : "teacher")
          : null,
        targetApproverIds: { parentIds, teacherIds },
      }, { transaction });
      await day.update({ status: TodoItemStatus.PendingApproval }, { transaction });
      return { status: 201, body: { data: approval } };
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error in requestApproval", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

interface ResolveParams { requestId: number; approverId: number; approverType: "parent" | "teacher"; decision: "approved" | "denied"; }

const resolveApprovalRequest = async ({ requestId, approverId, approverType, decision }: ResolveParams) =>
  MissionApprovalRequest.sequelize.transaction(async (transaction: any) => {
    const snapshot = await MissionApprovalRequest.findByPk(requestId, { transaction });
    if (!snapshot) return { status: 404, body: { message: "Request not found" } };
    const eligibleIds = approverType === ApproverType.Parent ? snapshot.parentIds : snapshot.teacherIds;
    if (!(eligibleIds || []).includes(approverId)) return { status: 403, body: { message: "Not authorized to act on this request" } };
    // All completion paths lock Student before request/To-Do state. Keeping a
    // single lock order avoids approval-vs-direct-completion deadlocks.
    await Student.findOne({ where: { id: snapshot.studentId }, transaction, lock: transaction?.LOCK?.UPDATE });
    const request = await MissionApprovalRequest.findByPk(requestId, { transaction, lock: transaction?.LOCK?.UPDATE });
    if (!request) return { status: 404, body: { message: "Request not found" } };
    if (request.status !== ApprovalStatus.Pending) {
      return { status: 200, body: { message: "This request has already been resolved", data: request, alreadyResolved: true } };
    }
    if (decision === ApprovalStatus.Approved) {
      const completion = await completeMissionForStudent({ studentId: request.studentId, taskId: request.missionId,
        missionDate: request.missionDate, approverId, approverType,
        source: approverType === ApproverType.Teacher ? "approval_teacher" : "approval_parent",
        approvalRequestId: request.id, transaction });
      const updated = await MissionApprovalRequest.findByPk(requestId, { transaction });
      return { status: 200, body: { data: updated, alreadyCompleted: completion.alreadyCompleted, rewardsGranted: completion.rewardsGranted } };
    }
    await request.update({ status: ApprovalStatus.Denied, approvedById: approverId,
      approvedByType: approverType, approvedAt: new Date() }, { transaction });
    if (request.todoDayId) {
      await StudentTodoDay.update({ status: TodoItemStatus.Todo }, {
        where: { id: request.todoDayId, status: TodoItemStatus.PendingApproval }, transaction,
      });
    }
    return { status: 200, body: { data: request } };
  });

const listPending = async (req: Request, res: Response, type: "parent" | "teacher") => {
  try {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const actor = type === "parent" ? await Parent.findOne({ where: { userId: user.id } }) : await Teacher.findOne({ where: { userId: user.id } });
    if (!actor) return res.status(404).json({ message: `${type} not found` });
    const pending = await MissionApprovalRequest.findAll({
      where: { status: ApprovalStatus.Pending },
      include: [{ model: Student, as: "Student", include: [
        { model: User, as: "user", attributes: ["firstName", "lastName", "profileImg"] },
        { model: Class, as: "Class", attributes: ["id", "classname", "grade"], required: false },
      ] }, { model: Task, as: "Mission" }], order: [["createdAt", "ASC"]],
    });
    const mine = pending.filter((row) => ((type === "parent" ? row.parentIds : row.teacherIds) || []).includes(actor.id));
    return res.status(200).json({ data: mine });
  } catch (error) {
    logger.error("Error listing pending mission requests", { error, type });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const resolveFromRequest = async (req: Request, res: Response, type: "parent" | "teacher", decision: "approved" | "denied") => {
  try {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const actor = type === "parent" ? await Parent.findOne({ where: { userId: user.id } }) : await Teacher.findOne({ where: { userId: user.id } });
    if (!actor) return res.status(404).json({ message: `${type} not found` });
    const requestId = Number(req.body.requestId);
    if (!Number.isSafeInteger(requestId)) return res.status(400).json({ message: "Invalid requestId parameter" });
    const result = await resolveApprovalRequest({ requestId, approverId: actor.id, approverType: type, decision });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error resolving mission request", { error, type, decision });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const listPendingRequestsForParent = (req: Request, res: Response) => listPending(req, res, "parent");
const listPendingRequestsForTeacher = (req: Request, res: Response) => listPending(req, res, "teacher");
const approveRequestAsParent = (req: Request, res: Response) => resolveFromRequest(req, res, "parent", "approved");
const denyRequestAsParent = (req: Request, res: Response) => resolveFromRequest(req, res, "parent", "denied");
const approveRequestAsTeacher = (req: Request, res: Response) => resolveFromRequest(req, res, "teacher", "approved");
const denyRequestAsTeacher = (req: Request, res: Response) => resolveFromRequest(req, res, "teacher", "denied");

// POST /mission/approval/:requestId/retarget — point a still-pending request
// at a different currently-eligible approver. Never a completion: no reward,
// no StudentTask, no To-Do status change. The previous target survives in
// MissionApprovalRequestEvents.
const retargetApproval = async (req: Request, res: Response) => {
  try {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });

    const requestId = Number(req.params.requestId);
    const approverId = Number(req.body.approverId);
    const approverType = req.body.approverType;
    if (!Number.isSafeInteger(requestId) || requestId <= 0) return res.status(400).json({ message: "Invalid requestId parameter" });
    if (!Number.isSafeInteger(approverId) || approverId <= 0 || (approverType !== ApproverType.Parent && approverType !== ApproverType.Teacher)) {
      return res.status(400).json({ message: "Invalid approverId or approverType parameter" });
    }

    // Eligibility is evaluated NOW, not from the request's snapshot: the
    // student may only redirect to someone currently linked/authorized.
    const eligible = await getEligibleApprovers(student);
    const allowed = approverType === ApproverType.Parent
      ? eligible.parentIds.includes(approverId)
      : eligible.teacherIds.includes(approverId);
    if (!allowed) return res.status(403).json({ message: "Selected approver is not eligible for this Student" });

    const result = await Student.sequelize.transaction(async (transaction: any) => {
      const request = await MissionApprovalRequest.findOne({
        where: { id: requestId, studentId: student.id },
        transaction, lock: transaction?.LOCK?.UPDATE,
      });
      if (!request) return { status: 404, body: { message: "Approval request not found" } };
      if (request.status !== ApprovalStatus.Pending) {
        return { status: 409, body: { message: "Only a pending request can be redirected" } };
      }
      const parentIds = approverType === ApproverType.Parent ? [approverId] : [];
      const teacherIds = approverType === ApproverType.Teacher ? [approverId] : [];
      await request.update({ parentIds, teacherIds }, { transaction });
      await MissionApprovalRequestEvent.create({
        requestId: request.id,
        eventType: ApprovalEventType.Retargeted,
        actorUserId: user.id,
        targetApproverType: approverType,
        targetApproverIds: { parentIds, teacherIds },
      }, { transaction });
      return { status: 200, body: { data: request } };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("Error retargeting approval request", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const getMyApprovers = async (req: Request, res: Response) => {
  try {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });
    const { parentIds, teacherIds } = await getEligibleApprovers(student);
    // The class is the student's own: teachers become eligible through it, so
    // its name and grade are what identify a teacher to the student.
    const studentClass = student.classId ? await Class.findByPk(student.classId) : null;
    const userAttributes = ["firstName", "lastName", "profileImg"];
    const [parents, teachers] = await Promise.all([
      parentIds.length ? Parent.findAll({ where: { id: parentIds }, include: [{ model: User, as: "user", attributes: userAttributes }] }) : [],
      teacherIds.length ? Teacher.findAll({ where: { id: teacherIds }, include: [{ model: User, as: "user", attributes: userAttributes }] }) : [],
    ]);
    const fullName = (row: any) => `${row.user?.firstName || ""} ${row.user?.lastName || ""}`.trim();
    const approvers = [
      ...parents.map((p: any) => ({
        id: p.id, type: "parent", name: fullName(p),
        profileImg: p.user?.profileImg ?? null,
        subject: null, className: null, grade: null,
      })),
      ...teachers.map((t: any) => ({
        id: t.id, type: "teacher", name: fullName(t),
        profileImg: t.user?.profileImg ?? null,
        subject: t.subject || null,
        className: (studentClass as any)?.classname ?? null,
        grade: (studentClass as any)?.grade ?? null,
      })),
    ];
    return res.status(200).json({ data: { hasParent: parentIds.length > 0, hasTeacher: teacherIds.length > 0, approvers } });
  } catch (error) {
    logger.error("Error in getMyApprovers", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// GET /mission/myRequestStatus?taskId=&missionDate=
// A read-only status lookup, always scoped to the caller's own Student row.
// `missionDate` selects one historical day; omitting it means the server's
// canonical today. The client may not select a future day, and the value is
// never used to authorize or date a reward — completion dates come from the
// stored request, never from a query string.
const getMyRequestStatus = async (req: Request, res: Response) => {
  try {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const student = await Student.findOne({ where: { userId: user.id } });
    if (!student) return res.status(404).json({ message: "Student not found" });
    const taskId = Number(req.query.taskId);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return res.status(400).json({ message: "Invalid taskId parameter" });
    const serverToday = utcGameplayDate();
    const missionDate = req.query.missionDate === undefined ? serverToday : req.query.missionDate;
    if (!isCanonicalDate(missionDate)) return res.status(400).json({ message: "Invalid date; use YYYY-MM-DD" });
    if (missionDate > serverToday) return res.status(400).json({ message: "Future mission dates are not available" });
    const requests = await MissionApprovalRequest.findAll({ where: { studentId: student.id,
      missionId: taskId, missionDate }, order: [["createdAt", "DESC"]] });
    return res.status(200).json({ data: requests[0] || null, missionDate, serverToday });
  } catch (error) {
    logger.error("Error in getMyRequestStatus", { error });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export { requestApproval, listPendingRequestsForParent, approveRequestAsParent, denyRequestAsParent,
  listPendingRequestsForTeacher, approveRequestAsTeacher, denyRequestAsTeacher, getMyApprovers, getMyRequestStatus, retargetApproval };
