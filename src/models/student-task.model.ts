import { Sequelize, DataTypes, Model, CreationOptional, ValidationError } from "@sequelize/core";
import Student from "./student.model";
import Task from "./task.model";
import Parent from "./parent.model";
import Teacher from "./teacher.model";
import User from "./user.model";

enum CompletionStatus {
  Completed = "Completed",
  NotCompleted = "NotCompleted",
}

class StudentTask extends Model {
  declare id: number;
  declare studentId: number;
  declare taskId: number;
  declare completionStatus: string;
  declare comment: CreationOptional<string>;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare date: string;
  declare parentId: number | null;
  declare teacherId: number | null;

  static associate(models: any) {
    StudentTask.belongsTo(models.Student, {
      foreignKey: { name: "studentId", allowNull: false },
      as: "Student"
    });
    StudentTask.belongsTo(models.Task, {
      foreignKey: { name: "taskId", allowNull: false },
      as: "Task"
    });
    StudentTask.belongsTo(models.Parent, {
      foreignKey: { name: "parentId", allowNull: true },
      as: "Parent"
    });
    StudentTask.belongsTo(models.Teacher, {
      foreignKey: { name: "teacherId", allowNull: true },
      as: "Teacher"
    });
    
  }

  static initModel(sequelize: Sequelize) {
    StudentTask.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        studentId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: Student, key: "id" },
        },
        taskId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: Task, key: "id" },
        },
        parentId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: Parent, key: "id" },
        },
        teacherId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: Teacher, key: "id" },
        },
        completionStatus: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: CompletionStatus.NotCompleted,
        },
        comment: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_DATE"),
        },
      },
      {
        sequelize,
        modelName: "StudentTask",
        timestamps: true,
        indexes: [
          {
            unique: true,
            name: "stu_task_date_p_t_unique", // Shortened index name
            fields: ["studentId", "taskId", "date", "parentId", "teacherId"],
          },
        ],
        
        hooks: {
          beforeValidate: (task: StudentTask) => {
            if (task.parentId && task.teacherId) {
              throw new ValidationError("Only one of parentId or teacherId should be set.");
            }
          },
        },
      }
    );
  }

  static async canAssignTask(studentId: number, taskId: number, date: string) {
    // Check if the task already exists for the given student and date
    const existingTask = (await StudentTask.findOne({
      where: {
        studentId,
        taskId,
        date,
      },
    })) as StudentTask | null;

    return !existingTask; // True if the task can be assigned, false otherwise
  }
}

export default StudentTask;
