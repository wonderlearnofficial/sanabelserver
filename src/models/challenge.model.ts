import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import Task from "./task.model"; // Import Task model
import StudentChallenge from "./student-challenge.model";
export enum TaskCategory {
  snabelBlue = "snabelBlue",
  snabelRed = "snabelRed",
  snabelYellow = "snabelYellow",
  snabelMixed =  "snabelMixed",
  water = "water",
  seeder = "seeder",
  xp = "xp",
  task = "task",
  alltask="alltask",
  treelevel = "treelevel",
  treestage = "treestage",
  tasktype = "tasktype",
  
}
class Challenge extends Model {
  declare id: CreationOptional<number>;
  declare title: string;
  declare description: string;
  declare xp: number;
  declare snabelBlue: number;
  declare snabelYellow: number;
  declare snabelRed: number;
  declare level: CreationOptional<number>;
  declare taskCategory: CreationOptional<String> | null; // Foreign key to Task (optional)
  declare category: TaskCategory;
  declare water: number;
  declare seeder: number;
  declare point: number ;
  declare tasktype: string | null;
  static initModel(sequelize: Sequelize) {
    Challenge.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        title: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        description: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        level: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
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
        water: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },
        seeder: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },
        point: {
          type: DataTypes.INTEGER,
          allowNull: true,
          validate: {
            min: 0,
          },
        },
        category: {
          type: DataTypes.ENUM(...Object.values(TaskCategory)), 
          allowNull: false,
        },
        taskCategory: {
          type: DataTypes.STRING,
          allowNull: true, 
        },
        tasktype: {
          type: DataTypes.STRING,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "Challenge",
        timestamps: true,
      }
    );
  }

  // Define associations
  static associate() {
    Challenge.belongsTo(Task, {
      foreignKey: "taskId",
      as: "task",
    });
    Challenge.hasMany(StudentChallenge, {
      foreignKey: "challengeId",
      as: "ChallengeStudents",
    });
  }
}

export default Challenge;
