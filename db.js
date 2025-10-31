const mysql = require("mysql2"); // No /promise

// Create pool
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "ledger",
  connectionLimit: 10, // optional
  port: 3306
});

// Create pool
// const db = mysql.createPool({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "ledger",
//   connectionLimit: 10, // optional
//   port: 3307
// });

db.getConnection((err, connection) => {
  if (err) {
    console.error("Database connection failed:", err);
  } else {
    console.log("Connected to MySQL database!");
    connection.release();
  }
});

module.exports = db;






// const mysql = require("mysql2/promise"); // ✅ Use the promise version

// // Create pool with promises
// const db = mysql.createPool({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "ledger",
//   connectionLimit: 10,
//   port: 3306
// });

// // Test connection
// db.getConnection()
//   .then((connection) => {
//     console.log("Connected to MySQL database!");
//     connection.release();
//   })
//   .catch((err) => {
//     console.error("Database connection failed:", err);
//   });

// module.exports = db;