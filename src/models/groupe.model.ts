// models/class.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import User from "./user.model";
import Organization from "./oraganization.model";

class Groupe extends Model {
  declare id: CreationOptional<number>;
  declare groupename: string; // Name of the class
  declare groupedescrption: number; // Reference to the Organization

  static initModel(sequelize: Sequelize) {
    Groupe.init(
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true,
        },
        groupename: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        groupedescrption: {
          type: DataTypes.STRING,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "Groupe",
        timestamps: true,
      }
    );
  }
  static associate(models: any) {
    Groupe.belongsTo(models.Organization, { foreignKey: "organizationId", as: "Organization" });
  }
}

export default Groupe;
