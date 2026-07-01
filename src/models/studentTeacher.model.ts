// models/studentTeacher.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";
import Student from "./student.model";
import Teacher from "./teacher.model";
class StudentTeacher extends Model {
  declare studentId: number;
  declare teacherId: number;

  static initModel(sequelize: Sequelize) {
    StudentTeacher.init(
      {
      },
      {
        sequelize,
        modelName: "StudentTeacher",
        timestamps: true,
      }
    );
  }
  static associate(models: any) {
    StudentTeacher.belongsTo(models.Student, {
      foreignKey: { name: "studentId", allowNull: false },
      as: "Student"
    });
    StudentTeacher.belongsTo(models.Teacher, {
      foreignKey: { name: "teacherId", allowNull: false },
      as: "Teacher"
    });
  }
}

export default StudentTeacher;
