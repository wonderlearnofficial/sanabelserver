import { CreationOptional, DataTypes, Model, Sequelize } from "@sequelize/core";
import { CompletionSource, TodoItemStatus } from "./student-todo-item.model";

class StudentTodoDay extends Model {
  declare id: CreationOptional<number>;
  declare studentTodoItemId: number;
  declare studentId: number;
  declare taskId: number;
  declare missionDate: string;
  declare status: CreationOptional<TodoItemStatus>;
  declare completedAt: CreationOptional<Date | null>;
  declare studentTaskId: CreationOptional<number | null>;
  declare completionSource: CreationOptional<CompletionSource | null>;
  declare completedById: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    StudentTodoDay.belongsTo(models.StudentTodoItem, { foreignKey: "studentTodoItemId", as: "TodoItem" });
    StudentTodoDay.belongsTo(models.Student, { foreignKey: "studentId", as: "Student" });
    StudentTodoDay.belongsTo(models.Task, { foreignKey: "taskId", as: "Task" });
    StudentTodoDay.belongsTo(models.StudentTask, { foreignKey: "studentTaskId", as: "Completion" });
    StudentTodoDay.hasMany(models.MissionApprovalRequest, { foreignKey: "todoDayId", as: "ApprovalRequests" });
  }

  static initModel(sequelize: Sequelize) {
    StudentTodoDay.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      studentTodoItemId: { type: DataTypes.INTEGER, allowNull: false },
      studentId: { type: DataTypes.INTEGER, allowNull: false },
      taskId: { type: DataTypes.INTEGER, allowNull: false },
      missionDate: { type: DataTypes.DATEONLY, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: TodoItemStatus.Todo },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      studentTaskId: { type: DataTypes.INTEGER, allowNull: true },
      completionSource: { type: DataTypes.STRING(40), allowNull: true },
      completedById: { type: DataTypes.INTEGER, allowNull: true },
    }, {
      sequelize,
      modelName: "StudentTodoDay",
      timestamps: true,
      indexes: [
        { unique: true, name: "student_todo_day_item_date_unique", fields: ["studentTodoItemId", "missionDate"] },
        { unique: true, name: "student_todo_day_task_date_unique", fields: ["studentId", "taskId", "missionDate"] },
        { unique: true, name: "student_todo_day_completion_unique", fields: ["studentTaskId"] },
        { name: "student_todo_day_history", fields: ["studentId", "missionDate", "status"] },
      ],
    });
  }
}

export default StudentTodoDay;
