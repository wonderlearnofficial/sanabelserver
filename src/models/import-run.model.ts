import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

/**
 * Tracks metadata about each import batch run.
 *
 * We record only the run summary (counts, entity type, admin, org) — not the
 * original Excel file — to allow "imports today / this month / recent runs"
 * without storing user-uploaded PII files indefinitely.
 *
 * organizationId mirrors the acting admin's scope at the time of import:
 *   null  → Super Admin ran a global import
 *   value → School Admin ran an org-scoped import (or Super Admin targeted an org)
 */
export type ImportEntityType =
  | "students"
  | "teachers"
  | "parents"
  | "classes"
  | "grades"
  | "organizations";

class ImportRun extends Model {
  declare id: CreationOptional<number>;
  /** User.id of the admin who performed the import. */
  declare adminUserId: number;
  /** Mirrors req.adminOrganizationId at the time of import. */
  declare organizationId: CreationOptional<number | null>;
  declare entityType: ImportEntityType;
  declare totalRows: number;
  declare succeeded: number;
  declare failed: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    ImportRun.belongsTo(models.User, { foreignKey: "adminUserId", as: "adminUser" });
    ImportRun.belongsTo(models.Organization, {
      foreignKey: "organizationId",
      as: "organization",
    });
  }

  static initModel(sequelize: Sequelize) {
    ImportRun.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        adminUserId: { type: DataTypes.INTEGER, allowNull: false },
        organizationId: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
        entityType: {
          type: DataTypes.ENUM(
            "students",
            "teachers",
            "parents",
            "classes",
            "grades",
            "organizations",
          ),
          allowNull: false,
        },
        totalRows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        succeeded: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        failed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      },
      {
        sequelize,
        modelName: "ImportRun",
        tableName: "ImportRuns",
        timestamps: true,
        indexes: [
          { name: "import_runs_admin_user_id", fields: ["adminUserId"] },
          { name: "import_runs_organization_id", fields: ["organizationId"] },
          { name: "import_runs_created_at", fields: ["createdAt"] },
          { name: "import_runs_entity_type", fields: ["entityType"] },
        ],
      },
    );
  }
}

export default ImportRun;
