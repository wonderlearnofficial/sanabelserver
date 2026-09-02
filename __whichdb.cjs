// Prints only non-secret identifiers (host, port, db, var names). No passwords.
const names = Object.keys(process.env).filter((k) => /MYSQL|DATABASE|RAILWAY_TCP|RAILWAY_PRIVATE|RAILWAY_SERVICE/i.test(k)).sort();
console.log('VAR NAMES:', names.join(', '));
console.log('MYSQL_DB_HOST =', process.env.MYSQL_DB_HOST);
console.log('MYSQL_DB_PORT =', process.env.MYSQL_DB_PORT);
console.log('MYSQL_DB_NAME =', process.env.MYSQL_DB_NAME);
console.log('MYSQLHOST =', process.env.MYSQLHOST);
console.log('MYSQLDATABASE =', process.env.MYSQLDATABASE);
console.log('RAILWAY_TCP_PROXY_DOMAIN =', process.env.RAILWAY_TCP_PROXY_DOMAIN);
console.log('RAILWAY_TCP_PROXY_PORT =', process.env.RAILWAY_TCP_PROXY_PORT);
console.log('RAILWAY_SERVICE_NAME =', process.env.RAILWAY_SERVICE_NAME);
