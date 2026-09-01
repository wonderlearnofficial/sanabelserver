import { CreationOptional, DataTypes, Model, Sequelize } from "@sequelize/core";

export enum TodoItemStatus {
  Todo = "todo",
  PendingApproval = "pending_approval",
  Completed = "completed",
}

export type CompletionSource =
  | "solo_self"
  | "approval_teacher"
  | "approval_parent"
  | "teacher_direct"
  | "parent_direct";

class StudentTodoItem extends Model {
  declare id: CreationOptional<number>;
  declare studentId: number;
  declare taskId: number;
  declare status: CreationOptional<TodoItemStatus>;
  declare activeKey: CreationOptional<string | null>;
  declare todoDate: string;
  declare completedAt: CreationOptional<Date | null>;
  declare studentTaskId: CreationOptional<number | null>;
  declare completionSource: CreationOptional<CompletionSource | null>;
  declare completedById: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    StudentTodoItem.belongsTo(models.Student, { foreignKey: "studentId", as: "Student" });
    StudentTodoItem.belongsTo(models.Task, { foreignKey: "taskId", as: "Task" });
    StudentTodoItem.belongsTo(models.StudentTask, { foreignKey: "studentTaskId", as: "Completion" });
    StudentTodoItem.hasMany(models.StudentTodoSource, { foreignKey: "todoItemId", as: "Sources" });
    StudentTodoItem.hasMany(models.MissionApprovalRequest, { foreignKey: "todoItemId", as: "ApprovalRequests" });
  }

  static initModel(sequelize: Sequelize) {
    StudentTodoItem.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        studentId: { type: DataTypes.INTEGER, allowNull: false },
        taskId: { type: DataTypes.INTEGER, allowNull: false },
        status: { type: DataTypes.STRING, allowNull: false, defaultValue: TodoItemStatus.Todo },
        // MySQL unique indexes allow multiple NULLs. Active rows use a stable
        // student:task key; completed history rows set it to NULL.
        activeKey: { type: DataTypes.STRING(80), allowNull: true },
        todoDate: { type: DataTypes.DATEONLY, allowNull: false },
        completedAt: { type: DataTypes.DATE, allowNull: true },
        studentTaskId: { type: DataTypes.INTEGER, allowNull: true },
        completionSource: { type: DataTypes.STRING(40), allowNull: true },
        completedById: { type: DataTypes.INTEGER, allowNull: true },
      },
      {
        sequelize,
        modelName: "StudentTodoItem",
        timestamps: true,
        indexes: [
          { unique: true, name: "student_todo_active_key_unique", fields: ["activeKey"] },
          { unique: true, name: "student_todo_completion_unique", fields: ["studentTaskId"] },
          { name: "student_todo_history", fields: ["studentId", "taskId", "todoDate"] },
        ],
      },
    );
  }
}

export default StudentTodoItem;
