if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

console.log(
  JSON.stringify(
    {
      databaseVariables: {
        username: process.env.MYSQL_DB_USER,
        password: process.env.MYSQL_DB_PASS,
        database: `${process.env.MYSQL_DB_NAME}_prod`,
        host: process.env.MYSQL_DB_HOST,
        dialect: "mysql", // Change this to 'mysql2'
      },
    },
    null,
    2
  )
);

export default {
  development: {
    username: "root",
    password: "1234",
    database: "snablelahssan",
    host: "localhost",
    port: 3306,
    dialect: "mysql", // Change this to 'mysql2'
  },
  test: {
    username: process.env.MYSQL_DB_USER,
    password: process.env.MYSQL_DB_PASS,
    database: `${process.env.MYSQL_DB_NAME}_test`,
    host: process.env.MYSQL_DB_HOST,
    dialect: "mysql", // Change this to 'mysql2'
  },
  production: {
    username: process.env.MYSQL_DB_USER,
    password: process.env.MYSQL_DB_PASS,
    database: `${process.env.MYSQL_DB_NAME}_prod`,
    host: process.env.MYSQL_DB_HOST,
    dialect: "mysql", // Change this to 'mysql2'
  },
};
