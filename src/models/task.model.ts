// models/task.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import TaskCategory from "./task-category.model"; // ✅ Import the actual model
import Student from "./student.model";
import StudentTask from "./student-task.model";

class Task extends Model {
  declare id: CreationOptional<number>;
  declare title: string;
  declare description: string;
  declare categoryId: number;
  declare taskCategory: TaskCategory;
  declare xp: number;
  declare type: string;
  declare snabelRed: CreationOptional<number>;
  declare snabelBlue: CreationOptional<number>;
  declare snabelYellow: CreationOptional<number>;

  static initModel(sequelize: Sequelize) {
    Task.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        type: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        title: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        description: {
          type: DataTypes.STRING,
          allowNull: true,
        },

        categoryId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: TaskCategory, // Reference to TaskCategory model
            key: "id",
          },
          onDelete: "CASCADE", // ✅ Move onDelete here
          onUpdate: "CASCADE", // ✅ Optional: Ensures updates propagate
        },

        snabelRed: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },
        snabelYellow: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },
        snabelBlue: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },

        xp: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },
        kind: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        timeToDo: {
          type: DataTypes.TIME,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "Task",
        timestamps: false,
      }
    );
  }
  static associate() {
    Task.belongsTo(TaskCategory, {
      foreignKey: "categoryId",
      as: "category",
    });
    Task.belongsToMany(Student, {
      through: StudentTask,
      foreignKey: "taskId",
      as: "Students",
    });  
  }
}

export default Task;
