import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

/**
 * One administrative action: who did what, to whom, in which school, when.
 *
 * Actor and target are plain ids plus a label captured when the action
 * happened, with no foreign keys: the log has to outlive the accounts and
 * schools it describes, since deleting one is itself an entry.
 */
class AdminAuditLog extends Model {
  declare id: CreationOptional<number>;
  declare actorUserId: CreationOptional<number | null>;
  declare actorEmail: CreationOptional<string | null>;
  /** The actor's own scope at the time: null for a Super Admin. */
  declare actorOrganizationId: CreationOptional<number | null>;
  declare action: string;
  declare targetType: CreationOptional<string | null>;
  declare targetId: CreationOptional<number | null>;
  declare targetLabel: CreationOptional<string | null>;
  /** The school the action affected, when there is one. */
  declare organizationId: CreationOptional<number | null>;
  declare details: CreationOptional<Record<string, unknown> | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // No associations: actor and target are deliberately not foreign keys.
  static associate(_models: any) {}

  static initModel(sequelize: Sequelize) {
    AdminAuditLog.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        actorUserId: { type: DataTypes.INTEGER, allowNull: true },
        actorEmail: { type: DataTypes.STRING(255), allowNull: true },
        actorOrganizationId: { type: DataTypes.INTEGER, allowNull: true },
        action: { type: DataTypes.STRING(64), allowNull: false },
        targetType: { type: DataTypes.STRING(32), allowNull: true },
        targetId: { type: DataTypes.INTEGER, allowNull: true },
        targetLabel: { type: DataTypes.STRING(255), allowNull: true },
        organizationId: { type: DataTypes.INTEGER, allowNull: true },
        details: { type: DataTypes.JSON, allowNull: true },
      },
      {
        sequelize,
        modelName: "AdminAuditLog",
        tableName: "AdminAuditLogs",
        timestamps: true,
        indexes: [
          { name: "admin_audit_logs_created_at", fields: ["createdAt"] },
          { name: "admin_audit_logs_actor", fields: ["actorUserId"] },
          { name: "admin_audit_logs_organization", fields: ["organizationId"] },
          { name: "admin_audit_logs_action", fields: ["action"] },
        ],
      },
    );
  }
}

export default AdminAuditLog;
