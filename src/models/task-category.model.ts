import { Sequelize, DataTypes, Model } from "@sequelize/core";
import Task from "./task.model";

class TaskCategory extends Model {
  declare id: number;
  declare title: string;
  declare description: string;
  declare xp: number;
  declare snabelRed: number;
  declare snabelYellow: number;
  declare snabelBlue: number;

  static initModel(sequelize: Sequelize) {
    TaskCategory.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        title: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        description: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        xp: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        snabelRed: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        snabelYellow: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        snabelBlue: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },

        
      },
      {
        sequelize,
        modelName: "TaskCategory",
        timestamps: true,
      }
    );
  }

  static associate() {
    TaskCategory.hasMany(Task, {
      foreignKey: "categoryId",
      as: "tasks",
    });
  }
}

export default TaskCategory;
