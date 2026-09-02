import { CreationOptional, DataTypes, Model, Sequelize } from "@sequelize/core";

export enum ApprovalEventType {
  Requested = "REQUESTED",
  Retargeted = "RETARGETED",
}

// Immutable audit trail for mission approval requests. The request row's
// parentIds/teacherIds arrays are overwritten when a student retargets a
// pending request; these rows preserve who each version of the request was
// aimed at. Rows are only ever inserted.
//
//   targetApproverIds : { parentIds: number[], teacherIds: number[] } — the
//                       full target set after this event.
//   targetApproverType: set only when the event narrowed the request to one
//                       named person ("parent" | "teacher"), null otherwise.
class MissionApprovalRequestEvent extends Model {
  declare id: CreationOptional<number>;
  declare requestId: number;
  declare eventType: ApprovalEventType;
  declare actorUserId: CreationOptional<number | null>;
  declare targetApproverType: CreationOptional<string | null>;
  declare targetApproverIds: CreationOptional<{ parentIds: number[]; teacherIds: number[] } | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    MissionApprovalRequestEvent.belongsTo(models.MissionApprovalRequest, {
      foreignKey: "requestId",
      as: "Request",
    });
  }

  static initModel(sequelize: Sequelize) {
    MissionApprovalRequestEvent.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        requestId: { type: DataTypes.INTEGER, allowNull: false },
        eventType: { type: DataTypes.STRING(20), allowNull: false },
        actorUserId: { type: DataTypes.INTEGER, allowNull: true },
        targetApproverType: { type: DataTypes.STRING(10), allowNull: true },
        targetApproverIds: { type: DataTypes.JSON, allowNull: true },
      },
      {
        sequelize,
        modelName: "MissionApprovalRequestEvent",
        timestamps: true,
        indexes: [{ name: "approval_events_request", fields: ["requestId"] }],
      },
    );
  }
}

export default MissionApprovalRequestEvent;
