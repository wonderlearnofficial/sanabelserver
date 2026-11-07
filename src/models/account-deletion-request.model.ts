import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

export type DeletionRequestStatus = "pending" | "done" | "rejected";

/**
 * A person's request to have their account deleted (public page or in-app).
 * An administrator reviews it and deletes the account with the admin tool.
 * userId is a plain id, not a foreign key: the row outlives the account.
 */
class AccountDeletionRequest extends Model {
  declare id: CreationOptional<number>;
  declare fullName: string;
  declare contactEmail: string;
  declare accountIdentifier: string;
  declare accountType: CreationOptional<string | null>;
  declare schoolName: CreationOptional<string | null>;
  declare details: CreationOptional<string | null>;
  declare source: CreationOptional<"web" | "app">;
  declare userId: CreationOptional<number | null>;
  declare status: CreationOptional<DeletionRequestStatus>;
  declare handledByUserId: CreationOptional<number | null>;
  declare handledAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(_models: any) {}

  static initModel(sequelize: Sequelize) {
    AccountDeletionRequest.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        fullName: { type: DataTypes.STRING(120), allowNull: false },
        contactEmail: { type: DataTypes.STRING(255), allowNull: false },
        accountIdentifier: { type: DataTypes.STRING(255), allowNull: false },
        accountType: { type: DataTypes.STRING(16), allowNull: true },
        schoolName: { type: DataTypes.STRING(160), allowNull: true },
        details: { type: DataTypes.STRING(1000), allowNull: true },
        source: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "web" },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
        handledByUserId: { type: DataTypes.INTEGER, allowNull: true },
        handledAt: { type: DataTypes.DATE, allowNull: true },
      },
      {
        sequelize,
        modelName: "AccountDeletionRequest",
        tableName: "AccountDeletionRequests",
        timestamps: true,
      },
    );
  }
}

export default AccountDeletionRequest;
