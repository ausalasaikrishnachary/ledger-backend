require("dotenv").config();
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

const db = require("../db"); // 👈 use your existing DB connection

console.log("📦 MySQL Auto Backup System Started");

// 📁 Create backupDB folder
const backupFolder = path.join(__dirname, "backupDB");

if (!fs.existsSync(backupFolder)) {
  fs.mkdirSync(backupFolder);
  console.log("📁 backupDB folder created");
}

// 📧 Email Config
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// ⏰ Every 2 Minutes
// cron.schedule("* 2 * * *", async () => {
//   console.log("⏰ Creating Backup Using Existing DB...");

//   const fileName = `ledger_backup_${Date.now()}.sql`;
//   const backupPath = path.join(backupFolder, fileName);

//   try {

//     let sqlDump = "";

//     // Get all tables
//     const [tables] = await db.promise().query("SHOW TABLES");

//     for (let tableObj of tables) {
//       const tableName = Object.values(tableObj)[0];

//       // Get CREATE TABLE
//       const [createTable] = await db
//         .promise()
//         .query(`SHOW CREATE TABLE \`${tableName}\``);

//       sqlDump += `\n\n${createTable[0]["Create Table"]};\n\n`;

//       // Get Data
//       const [rows] = await db
//         .promise()
//         .query(`SELECT * FROM \`${tableName}\``);

//       for (let row of rows) {
//         const columns = Object.keys(row)
//           .map((col) => `\`${col}\``)
//           .join(", ");

//         const values = Object.values(row)
//           .map((val) =>
//             val === null
//               ? "NULL"
//               : `'${val.toString().replace(/'/g, "\\'")}'`
//           )
//           .join(", ");

//         sqlDump += `INSERT INTO \`${tableName}\` (${columns}) VALUES (${values});\n`;
//       }
//     }

//     fs.writeFileSync(backupPath, sqlDump);

//     console.log("✅ Backup Stored in backupDB:", fileName);

//     // Send Email
//     await transporter.sendMail({
//       from: process.env.EMAIL_USER,
//       to: process.env.RECEIVER_EMAIL,
//       subject: "Automatic MySQL Database Backup",
//       text: "Full database backup attached.",
//       attachments: [
//         {
//           filename: fileName,
//           path: backupPath,
//         },
//       ],
//     });

//     console.log("✅ Backup Email Sent Successfully");

//   } catch (error) {
//     console.error("❌ Backup Failed:", error);
//   }
// });

module.exports = {};