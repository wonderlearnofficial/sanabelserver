import Student from "../models/student.model";
import Task from "../models/task.model";
import { completeMissionForStudent, MissionCompletionSource } from "../helpers/completeMission";
import { utcGameplayDate } from "./studentTodoService";

export async function processDirectCompletionBatch({
  taskId, studentIds, actorId, actorType, source, comment = "", authorize,
}: {
  taskId: number;
  studentIds: number[];
  actorId: number;
  actorType: "teacher" | "parent";
  source: MissionCompletionSource;
  comment?: string;
  authorize: (student: Student) => Promise<boolean>;
}) {
  if (!(await Task.findOne({ where: { id: taskId } }))) return { httpStatus: 404, body: { message: "Task not found" } };
  const missionDate = utcGameplayDate();
  const results: any[] = [];
  for (const studentId of [...new Set(studentIds)]) {
    try {
      const student = await Student.findOne({ where: { id: studentId } });
      if (!student) { results.push({ studentId, status: "not_found", rewardsGranted: false }); continue; }
      if (!(await authorize(student))) { results.push({ studentId, status: "unauthorized", rewardsGranted: false }); continue; }
      const completion = await Student.sequelize.transaction((transaction: any) => completeMissionForStudent({
        studentId, taskId, missionDate, source, approverId: actorId, approverType: actorType,
        comment, transaction,
      }));
      results.push({ studentId, status: completion.alreadyCompleted ? "already_completed" : "completed",
        rewardsGranted: completion.rewardsGranted, todoState: "completed" });
    } catch (error: any) {
      results.push({ studentId, status: "failed", rewardsGranted: false, error: error?.message || "Completion failed" });
    }
  }
  const summary = results.reduce((value, result) => {
    value[result.status] = (value[result.status] || 0) + 1;
    return value;
  }, {} as Record<string, number>);
  return { httpStatus: 200, body: { message: "Mission completion processed", summary, results } };
}
