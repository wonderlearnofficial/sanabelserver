import { Sequelize, DataTypes, CreationOptional, Model } from "@sequelize/core";
import User from "./user.model";

class Parent extends Model {
  declare id: CreationOptional<number>;
  declare contactInfo: CreationOptional<string>;
  declare parentId: CreationOptional<number>; // Explicit parentId field as a foreign key
  declare userId: CreationOptional<number>; // Add userId field
  /**
   * School the parent was imported into (bulk import by a School Admin, or a
   * Super Admin naming a school). Lets that school's admin see a parent who
   * has no linked child yet. Null for self-registered parents.
   */
  declare organizationId: CreationOptional<number | null>;
  declare user: User | null;
  static associate(models: any) {
    Parent.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    Parent.hasMany(models.Student, { foreignKey: "ParentId", as: "Students" });
  }
  
  static initModel(sequelize: Sequelize) {
    Parent.init(
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true,
        },
        userId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        organizationId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
        },
      },
      {
        sequelize,
        modelName: "Parent",
        timestamps: true,
      }
    );
  }
}

export default Parent;
