// models/donation.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import Student from "./student.model";
class Donation extends Model {
  declare id: CreationOptional<number>;
  declare amount: number;
  declare studentId: number;
  declare receiptImage: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initModel(sequelize: Sequelize) {
    Donation.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        amount: {
          type: DataTypes.FLOAT,
          allowNull: false,
        },

        receiptImage: {
          type: DataTypes.STRING,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "Donation",
        timestamps: true,
      }
    );
  }
  static associate(models: any) {
    Donation.belongsTo(models.Student, { foreignKey: "studentId", as: "Student" });
  }
}

export default Donation;
