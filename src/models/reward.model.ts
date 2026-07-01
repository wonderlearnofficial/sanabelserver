// models/reward.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import Student from "./student.model";

export enum RewardType {
  Virtual = "Virtual",
  Physical = "Physical",
}

class Reward extends Model {
  declare id: CreationOptional<number>;
  declare type: RewardType;
  declare pointsRequired: number;
  declare description: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  static associate(models: any) {
    Reward.belongsTo(Student, {
      foreignKey: "studentId",
      as: "Student",
    });
  }
  
  static initModel(sequelize: Sequelize) {
    Reward.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        type: {
          type: DataTypes.ENUM(...Object.values(RewardType)),
          allowNull: false,
        },
        pointsRequired: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        description: {
          type: DataTypes.STRING,
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: "Reward",
        timestamps: true,
      }
    );
  }
}

export default Reward;
