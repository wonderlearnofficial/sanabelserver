// models/grade.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

class Grade extends Model {
  declare id: CreationOptional<number>;
  declare name: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    Grade.hasMany(models.Student, { foreignKey: "gradeId", as: "Students", inverse: { as: "GradeEntity" } });
    Grade.hasMany(models.Class, { foreignKey: "gradeId", as: "Classes", inverse: { as: "GradeEntity" } });
  }

  static initModel(sequelize: Sequelize) {
    Grade.init(
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
      },
      {
        sequelize,
        modelName: "Grade",
        timestamps: true,
      }
    );
  }
}

export default Grade;
