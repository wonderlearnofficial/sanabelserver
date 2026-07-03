import { Sequelize, DataTypes, Model, CreationOptional } from "@sequelize/core";

export enum ApprovalStatus {
  Pending = "pending",
  Approved = "approved",
  Denied = "denied",
}

export enum ApproverType {
  Parent = "parent",
  Teacher = "teacher",
}

class MissionApprovalRequest extends Model {
  declare id: CreationOptional<number>;
  declare studentId: number;
  declare missionId: number;
  declare missionDate: string;
  declare status: CreationOptional<string>;
  declare parentIds: CreationOptional<number[]>;
  declare teacherIds: CreationOptional<number[]>;
  declare approvedById: CreationOptional<number | null>;
  declare approvedByType: CreationOptional<string | null>;
  declare approvedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: any) {
    MissionApprovalRequest.belongsTo(models.Student, {
      foreignKey: "studentId",
      as: "Student",
    });
    MissionApprovalRequest.belongsTo(models.Task, {
      foreignKey: "missionId",
      as: "Mission",
    });
  }

  static initModel(sequelize: Sequelize) {
    MissionApprovalRequest.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        studentId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        missionId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        missionDate: {
          // The day the student actually did the mission — never overwritten
          // by the day it happens to get approved.
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: ApprovalStatus.Pending,
        },
        parentIds: {
          // Snapshot of who was eligible to approve at request time, so a
          // parent unlinked afterwards doesn't retroactively invalidate an
          // already-pending request's list of approvers.
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: [],
        },
        teacherIds: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: [],
        },
        approvedById: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        approvedByType: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        approvedAt: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "MissionApprovalRequest",
        timestamps: true,
      }
    );
  }
}

export default MissionApprovalRequest;

