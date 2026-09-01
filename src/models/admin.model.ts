import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

// Admin-specific profile and scope. One row per admin User.
//
//   organizationId IS NULL      -> SUPER ADMIN  (global visibility)
//   organizationId IS NOT NULL  -> SCHOOL ADMIN (locked to that organization)
//
// Deliberately no isSuperAdmin field — it is derivable from organizationId,
// and a second stored copy could disagree with the first.
class Admin extends Model {
  declare id: CreationOptional<number>;
  declare userId: number;
  declare organizationId: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  /** True when this admin has global (super) scope. */
  get isSuperAdmin(): boolean {
    return this.organizationId == null;
  }

  static associate(models: any) {
    Admin.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    Admin.belongsTo(models.Organization, { foreignKey: "organizationId", as: "organization" });
  }

  static initModel(sequelize: Sequelize) {
    Admin.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        // Uniqueness is declared once, in the named index below. Setting
        // `unique: true` here as well makes Sequelize register two indexes on
        // the same column and collide on the name.
        userId: { type: DataTypes.INTEGER, allowNull: false },
        organizationId: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
      },
      {
        sequelize,
        modelName: "Admin",
        timestamps: true,
        indexes: [
          { unique: true, name: "admins_user_id_unique", fields: ["userId"] },
          { name: "admins_organization_id", fields: ["organizationId"] },
        ],
      },
    );
  }
}

export default Admin;
