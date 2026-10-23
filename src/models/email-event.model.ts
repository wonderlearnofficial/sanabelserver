import { CreationOptional, DataTypes, Model, Sequelize } from "@sequelize/core";

export type EmailPurpose =
  | "OTP"
  | "PASSWORD_RESET"
  | "ADMIN_INVITE"
  | "ACCOUNT_NOTIFICATION";

export type EmailEventStatus =
  | "send_attempted"
  | "send_accepted"
  | "send_failed"
  | "delivered"
  | "bounced";

// Forward-looking transactional-email telemetry. It deliberately stores no
// subject, body, OTP, password, or raw recipient address.
class EmailEvent extends Model {
  declare id: CreationOptional<number>;
  declare userId: CreationOptional<number | null>;
  declare recipientHash: string;
  declare purpose: EmailPurpose;
  declare provider: string;
  declare providerMessageId: CreationOptional<string | null>;
  declare status: EmailEventStatus;
  declare failureCode: CreationOptional<string | null>;
  declare failureCategory: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    EmailEvent.belongsTo(models.User, { foreignKey: "userId", as: "user" });
  }

  static initModel(sequelize: Sequelize) {
    EmailEvent.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        recipientHash: { type: DataTypes.STRING(64), allowNull: false },
        purpose: { type: DataTypes.STRING(40), allowNull: false },
        provider: { type: DataTypes.STRING(24), allowNull: false },
        providerMessageId: { type: DataTypes.STRING(191), allowNull: true },
        status: { type: DataTypes.STRING(24), allowNull: false },
        failureCode: { type: DataTypes.STRING(80), allowNull: true },
        failureCategory: { type: DataTypes.STRING(40), allowNull: true },
      },
      {
        sequelize,
        modelName: "EmailEvent",
        timestamps: true,
        indexes: [
          { name: "email_events_created_status", fields: ["createdAt", "status"] },
          { name: "email_events_purpose_created", fields: ["purpose", "createdAt"] },
        ],
      },
    );
  }
}

export default EmailEvent;
