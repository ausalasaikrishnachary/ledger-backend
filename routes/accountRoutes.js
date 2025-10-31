const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');

// Create Account
router.post("/accounts", async (req, res) => {
  const { name, email, phone_number, password, role, ...otherData } = req.body;

  // Validate required fields
  // if (!name || !email || !phone_number || !role || !password) {
  //   return res.status(400).json({
  //     error: "Missing required fields: name, email, phone_number, role, password",
  //   });
  // }

  // Prepare data for insertion, include role
  const data = { name, email, phone_number, password, role, ...otherData };
  const sql = "INSERT INTO accounts SET ?";

  try {
    // Insert into database
    const [result] = await db.promise().query(sql, data);

    // Setup Nodemailer with TLS fix
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "bharathsiripuram98@gmail.com",
        pass: "alsishqgybtzonoj",
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    // Email content including role
    const mailOptions = {
      from: "bharathsiripuram98@gmail.com",
      to: email,
      subject: "Your Retailer/Staff Account Details",
      text: `
Hello ${name},

Your account has been successfully created.
Phone Number: ${phone_number}
Role: ${role}
Email: ${email}
Password: ${password}

Please keep this information secure.
      `,
    };

    // Send email
    try {
      await transporter.sendMail(mailOptions);
      res.status(201).json({
        message: "User added and email sent successfully!",
        id: result.insertId,
        ...data,
      });
    } catch (mailErr) {
      console.error("Email Error:", mailErr);
      res.status(201).json({
        message: "User added but failed to send email",
        id: result.insertId,
        ...data,
      });
    }
  } catch (dbErr) {
    console.error("DB Insert Error:", dbErr);
    res.status(500).json({ error: "Failed to add user to database" });
  }
});

// Other routes (Get All Accounts, Get Single Account, Update Account, Delete Account) remain unchanged
router.get("/accounts", (req, res) => {
  db.query("SELECT * FROM accounts", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// router.get("/accounts/:id", (req, res) => {
//   db.query("SELECT * FROM accounts WHERE id = ?", [req.params.id], (err, results) => {
//     if (err) return res.status(500).send(err);
//     res.send(results[0]);
//   });
// });

router.get("/accounts/:id", (req, res) => {
  db.query("SELECT * FROM accounts WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).send(err);
    if (results.length === 0) return res.status(404).send("Account not found");
    res.send(results[0]);
  });
});


router.put("/accounts/:id", (req, res) => {
  const data = req.body;
  db.query("UPDATE accounts SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: req.params.id, ...data });
  });
});

router.delete("/accounts/:id", (req, res) => {
  db.query("DELETE FROM accounts WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ message: "Deleted successfully." });
  });
});










module.exports = router;