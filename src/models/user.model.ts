// models/user.model.ts
import {
  Sequelize,
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "@sequelize/core";
import Student from "./student.model";
import Teacher from "./teacher.model";
import Parent from "./parent.model";
import Representative from "./representative.model";

export enum UserRole {
  Parent = "Parent",
  Teacher = "Teacher",
  Student = "Student",
  Admin = "Admin",
}

export enum UserGenre {
  Male = "Male",
  Female = "Female",
}

class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare firstName: CreationOptional<string>;
  declare lastName: CreationOptional<string>;
  declare email: CreationOptional<string>;
  declare password: CreationOptional<string>;
  declare role: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare resetOTP: CreationOptional<string> | null;
  declare otpExpiry: CreationOptional<Date> | null;
  declare otpVerified: CreationOptional<boolean>;
  declare otpAttempts: CreationOptional<number>;
  declare otpLockedUntil: CreationOptional<Date> | null;
  declare tokenVersion: CreationOptional<number>;
  declare gender: CreationOptional<String>;
  declare dateOfBirth: CreationOptional<Date>;
  declare profileImg: CreationOptional<Record<string, any> | null>;
  declare isAccess: CreationOptional<Boolean>;
  declare seenGuides: CreationOptional<string[]>;
  declare pushSubscription: CreationOptional<Record<string, any> | null>;
  declare location: CreationOptional<Record<string, any> | null>;
  static associate(models: any) {
    User.hasMany(Student, { foreignKey: "userId", as: "Students" });
    User.hasMany(Teacher, { foreignKey: "userId", as: "Teachers" });
    User.hasMany(Parent, { foreignKey: "userId", as: "Parents" });
    User.hasMany(Representative, { foreignKey: "userId", as: "Representatives" });
  }
  
  static initModel(sequelize: Sequelize) {
    User.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        firstName: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        lastName: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        email: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
          validate: {
            isEmail: true,
          },
        },
        password: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        role: {
          type: DataTypes.ENUM(...Object.values(UserRole)),
          allowNull: true,
          defaultValue: "Student",
        },

        resetOTP: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        otpExpiry: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        otpVerified: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: false,
        },
        otpAttempts: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        otpLockedUntil: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        // Bumped on logout to invalidate every outstanding refresh token.
        tokenVersion: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        gender: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        dateOfBirth: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        isAccess: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        profileImg: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        seenGuides: {
          type: DataTypes.JSON,
          allowNull: true,
          defaultValue: [],
        },
        pushSubscription: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        location: {
          type: DataTypes.JSON,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "User",
        timestamps: true,
      }
    );
  }
}

export default User;
