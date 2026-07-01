import { Sequelize, DataTypes, CreationOptional, Model } from "@sequelize/core";
import User from "./user.model";
import Organization from "./oraganization.model";
class Teacher extends Model {
  declare id: CreationOptional<number>;
  declare subject: CreationOptional<string>;
  declare organizationId: CreationOptional<number>;
  declare teacherId: CreationOptional<number>; // Explicit teacherId field as a foreign key
  declare user: User | null;
  static associate(models: any) {
    Teacher.belongsTo(models.User, { foreignKey: "userId", as: "User" });
    Teacher.belongsTo(models.Organization, { foreignKey: "organizationId", as: "Organization" });
  
    Teacher.hasMany(models.Class, { foreignKey: "teacherId", as: "Classes" });
  
 
  }
  
  static initModel(sequelize: Sequelize) {
    Teacher.init(
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true,
        },
      },
      {
        sequelize,
        modelName: "Teacher",
        timestamps: true,
      }
    );
  }
}

export default Teacher;
