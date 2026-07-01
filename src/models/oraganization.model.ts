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

class Organization extends Model {
  declare id: CreationOptional<number>;
  declare name: string;
  declare address: string;
  declare type: OrganizationType;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare user: User | null;
  static associate(models: any) {
    Organization.hasMany(Student, { foreignKey: "organizationId", as: "Students" });
    Organization.hasMany(Teacher, { foreignKey: "organizationId", as: "Teachers" });
    Organization.hasMany(Class, { foreignKey: "organizationId", as: "Classes" });
    Organization.hasMany(Representative, { foreignKey: "organizationId", as: "Representatives" });
    Organization.hasMany(Groupe, { foreignKey: "organizationId", as: "Groupes" });
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
      },
      {
        sequelize,
        modelName: "Organization",
        timestamps: true,
      }
    );
  }
}

export default Organization;
