const mysql = require('mysql');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'spicedums',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 30000,
  connectTimeout: 10000
});

module.exports = {
  query(sql, params) {
    return new Promise((resolve, reject) => {
      pool.query(sql, params, (error, results, fields) => {
        if (error) return reject(error);
        resolve([results, fields]);
      });
    });
  }
};
