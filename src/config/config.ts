if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// NOTE: All credentials come from environment variables. Never hardcode
// passwords here or log credential values — this file is read by both the
// app and sequelize-cli, and any literal would end up in source control.
const common = {
  username: process.env.MYSQL_DB_USER,
  password: process.env.MYSQL_DB_PASS,
  host: process.env.MYSQL_DB_HOST || "localhost",
  port: Number(process.env.MYSQL_DB_PORT) || 3306,
  dialect: "mysql",
};

export default {
  development: {
    ...common,
    database: process.env.MYSQL_DB_NAME || "snablelahssan",
  },
  test: {
    ...common,
    database: `${process.env.MYSQL_DB_NAME}_test`,
  },
  production: {
    ...common,
    database: `${process.env.MYSQL_DB_NAME}_prod`,
  },
};
