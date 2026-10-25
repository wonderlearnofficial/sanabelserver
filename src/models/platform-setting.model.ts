import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

/**
 * One platform-wide setting a Super Admin controls, stored as JSON under a
 * key. "session" holds the token lifetimes (helpers/sessionPolicy.ts).
 */
class PlatformSetting extends Model {
  declare key: string;
  declare value: Record<string, unknown>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(_models: any) {}

  static initModel(sequelize: Sequelize) {
    PlatformSetting.init(
      {
        key: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
        value: { type: DataTypes.JSON, allowNull: false },
      },
      {
        sequelize,
        modelName: "PlatformSetting",
        tableName: "PlatformSettings",
        timestamps: true,
      },
    );
  }
}

export default PlatformSetting;
