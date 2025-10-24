const mysql = require("mysql2"); // No /promise

// Create pool
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "ledger",
  connectionLimit: 10, // optional
  port: 4306
});

db.getConnection((err, connection) => {
  if (err) {
    console.error("Database connection failed:", err);
  } else {
    console.log("Connected to MySQL database!");
    connection.release();
  }
});

module.exports = db;
