import { CreationOptional, DataTypes, Model, Sequelize } from "@sequelize/core";

/**
 * Tracks short-lived, single-use impersonation handoff codes.
 *
 * Security properties:
 * - Code is stored only as a SHA-256 hash. The raw code is held in memory
 *   only during creation and is never persisted.
 * - Expires within a short TTL (90s).
 * - Single-use: once consumed, usedAt is set atomically; duplicate or
 *   concurrent exchanges are rejected.
 * - Records actorAdminUserId and targetStudentId for durable audit.
 */
class AdminImpersonationHandoff extends Model {
  declare id: CreationOptional<number>;
  declare codeHash: string;
  declare actorAdminUserId: number;
  declare targetUserId: number;
  declare targetStudentId: number;
  declare organizationId: CreationOptional<number | null>;
  declare expiresAt: Date;
  declare usedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    AdminImpersonationHandoff.belongsTo(models.User, {
      foreignKey: "actorAdminUserId",
      as: "actorAdminUser",
    });
    AdminImpersonationHandoff.belongsTo(models.User, {
      foreignKey: "targetUserId",
      as: "targetUser",
    });
    AdminImpersonationHandoff.belongsTo(models.Student, {
      foreignKey: "targetStudentId",
      as: "targetStudent",
    });
    AdminImpersonationHandoff.belongsTo(models.Organization, {
      foreignKey: "organizationId",
      as: "organization",
    });
  }

  static initModel(sequelize: Sequelize) {
    AdminImpersonationHandoff.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        codeHash: { type: DataTypes.STRING(64), allowNull: false },
        actorAdminUserId: { type: DataTypes.INTEGER, allowNull: false },
        targetUserId: { type: DataTypes.INTEGER, allowNull: false },
        targetStudentId: { type: DataTypes.INTEGER, allowNull: false },
        organizationId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
        },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        usedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
      },
      {
        sequelize,
        modelName: "AdminImpersonationHandoff",
        tableName: "AdminImpersonationHandoffs",
        timestamps: true,
        indexes: [
          {
            name: "admin_impersonation_code_hash_unique",
            fields: ["codeHash"],
            unique: true,
          },
          { name: "admin_impersonation_expires_at", fields: ["expiresAt"] },
          {
            name: "admin_impersonation_actor_admin_user_id",
            fields: ["actorAdminUserId"],
          },
          {
            name: "admin_impersonation_target_student_id",
            fields: ["targetStudentId"],
          },
        ],
      },
    );
  }
}

export default AdminImpersonationHandoff;
