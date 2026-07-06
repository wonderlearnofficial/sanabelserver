// CommonJS config consumed by sequelize-cli (see ../.sequelizerc). All values
// come from the environment; nothing sensitive is hardcoded.
require("dotenv").config();

const common = {
  username: process.env.MYSQL_DB_USER,
  password: process.env.MYSQL_DB_PASS,
  host: process.env.MYSQL_DB_HOST || "localhost",
  port: Number(process.env.MYSQL_DB_PORT) || 3306,
  dialect: "mysql",
};

module.exports = {
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
