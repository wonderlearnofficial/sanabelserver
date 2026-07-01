import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import Student from "./student.model";
import Task from "./task.model";
import Challenge from "./challenge.model";

export enum CompletionStatus {
  Completed = "Completed",
  NotCompleted = "NotCompleted",
}

class StudentChallenge extends Model {
  declare studentId: number;
  declare student: Student;
  
  declare challengeId: number;
  declare completionStatus: CompletionStatus; // ✅ Use enum properly
  declare comment: CreationOptional<string>;
  declare date: CreationOptional<Date>;
  declare pointOfStudent: number;
  declare challenge: Challenge; // Optional association with Task model
  static associate(models: any) {
    StudentChallenge.belongsTo(Student, {
      foreignKey: "studentId",
      as: "Student",
    });
  
    StudentChallenge.belongsTo(Challenge, {
      foreignKey: "challengeId",
      as: "challenge",
    });
  }
  static initModel(sequelize: Sequelize) {
    StudentChallenge.init(
      {
        studentId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          references: {
            model: Student,
            key: "id",
          },
        },
        challengeId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          references: {
            model: Challenge,
            key: "id",
          },
        },
        completionStatus: {
          type: DataTypes.ENUM(...Object.values(CompletionStatus)),
          allowNull: false,
          defaultValue: CompletionStatus.NotCompleted,
        },
        comment: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        date: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        pointOfStudent: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },
      },
      {
        sequelize,
        modelName: "StudentChallenge",
        timestamps: true,
        // ❌ REMOVE noPrimaryKey: true
      }
    );
  }
  }

export default StudentChallenge;
