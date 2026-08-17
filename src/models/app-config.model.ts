// models/app-config.model.ts
import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

export interface AppConfigAttributes {
  id: CreationOptional<number>;
  platform: string; // 'android' | 'ios' | 'web'
  latestVersion: string;
  minRequiredVersion: string;
  forceUpdate: boolean;
  storeUrl: string;
  releaseNotesAr: string;
  releaseNotesEn: string;
  maintenanceMode: boolean;
  createdAt?: CreationOptional<Date>;
  updatedAt?: CreationOptional<Date>;
}

class AppConfig extends Model {
  declare id: CreationOptional<number>;
  declare platform: string;
  declare latestVersion: string;
  declare minRequiredVersion: string;
  declare forceUpdate: boolean;
  declare storeUrl: string;
  declare releaseNotesAr: string;
  declare releaseNotesEn: string;
  declare maintenanceMode: boolean;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(_models: any) {
    // No direct foreign relations required
  }

  static initModel(sequelize: Sequelize) {
    AppConfig.init(
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true,
        },
        platform: {
          type: DataTypes.STRING(30),
          allowNull: false,
          unique: true,
        },
        latestVersion: {
          type: DataTypes.STRING(30),
          allowNull: false,
          defaultValue: "1.0.0",
        },
        minRequiredVersion: {
          type: DataTypes.STRING(30),
          allowNull: false,
          defaultValue: "1.0.0",
        },
        forceUpdate: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        storeUrl: {
          type: DataTypes.STRING(1000),
          allowNull: false,
          defaultValue: "",
        },
        releaseNotesAr: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: "تحديث جديد يتضمن تحسينات ومزايا جديدة.",
        },
        releaseNotesEn: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: "New update with improvements and new features.",
        },
        maintenanceMode: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
      },
      {
        sequelize,
        modelName: "AppConfig",
        tableName: "AppConfigs",
        timestamps: true,
      }
    );
  }
}

export default AppConfig;
