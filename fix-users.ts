import * as dotenv from "dotenv";
dotenv.config();
import { sequelize, rundb } from "./src/config/db_connection";
import User from "./src/models/user.model";

(async () => {
  await sequelize.authenticate();
  User.initModel(sequelize);
  await User.update({ isAccess: true, otpVerified: true }, { where: {} });
  console.log("Fixed users");
  process.exit(0);
})();
