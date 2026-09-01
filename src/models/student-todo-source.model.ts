import { CreationOptional, DataTypes, Model, Sequelize } from "@sequelize/core";

export type TodoSourceType = "student" | "teacher" | "parent";

class StudentTodoSource extends Model {
  declare id: CreationOptional<number>;
  declare todoItemId: number;
  declare sourceType: TodoSourceType;
  declare sourceId: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    StudentTodoSource.belongsTo(models.StudentTodoItem, { foreignKey: "todoItemId", as: "TodoItem" });
  }

  static initModel(sequelize: Sequelize) {
    StudentTodoSource.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        todoItemId: { type: DataTypes.INTEGER, allowNull: false },
        sourceType: { type: DataTypes.STRING(20), allowNull: false },
        sourceId: { type: DataTypes.INTEGER, allowNull: false },
      },
      {
        sequelize,
        modelName: "StudentTodoSource",
        timestamps: true,
        indexes: [
          {
            unique: true,
            name: "student_todo_source_unique",
            fields: ["todoItemId", "sourceType", "sourceId"],
          },
        ],
      },
    );
  }
}

export default StudentTodoSource;
