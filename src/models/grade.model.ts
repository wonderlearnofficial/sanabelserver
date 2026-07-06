// models/grade.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

class Grade extends Model {
  declare id: CreationOptional<number>;
  declare name: string;
  declare organizationId: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    Grade.hasMany(models.Student, { foreignKey: "gradeId", as: "Students", inverse: { as: "GradeEntity" } });
    Grade.hasMany(models.Class, { foreignKey: "gradeId", as: "Classes", inverse: { as: "GradeEntity" } });
    Grade.belongsTo(models.Organization, { foreignKey: "organizationId", as: "Organization" });
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
        },
        organizationId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "Grade",
        timestamps: true,
        indexes: [
          {
            unique: true,
            fields: ["name", "organizationId"],
          },
        ],
      }
    );
  }
}

export default Grade;
