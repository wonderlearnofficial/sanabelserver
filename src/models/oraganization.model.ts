// models/organization.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import User from "./user.model";
import Student from "./student.model";
import Teacher from "./teacher.model";
import Class from "./class.model";
import Representative from "./representative.model";
import Groupe from "./groupe.model";

export enum OrganizationType {
  School = "School",
  Company = "Company",
  Charity = "Charity",
}

export type LeaderboardScope = "all_school" | "same_grade" | "same_class";

class Organization extends Model {
  declare id: CreationOptional<number>;
  declare name: string;
  declare address: string;
  declare type: OrganizationType;
  declare leaderboardScope: LeaderboardScope;
  declare leaderboardLimit: number;
  declare hideZeroXpStudents: boolean;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare user: User | null;
  static associate(models: any) {
    Organization.hasMany(Student, {
      foreignKey: "organizationId",
      as: "Students",
    });
    Organization.hasMany(Teacher, {
      foreignKey: "organizationId",
      as: "Teachers",
    });
    Organization.hasMany(Class, {
      foreignKey: "organizationId",
      as: "Classes",
    });
    Organization.hasMany(models.Grade, {
      foreignKey: "organizationId",
      as: "Grades",
    });
  }

  static initModel(sequelize: Sequelize) {
    Organization.init(
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true,
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
        },
        type: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "School",
        },
        img: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        leaderboardScope: {
          type: DataTypes.ENUM("all_school", "same_grade", "same_class"),
          allowNull: false,
          defaultValue: "all_school",
        },
        leaderboardLimit: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 50,
        },
        hideZeroXpStudents: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: "Organization",
        timestamps: true,
      },
    );
  }
}

export default Organization;
