const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');

// Create Account
router.post("/accounts", async (req, res) => {
  let { name, email, phone_number, password, role, assigned_staff, staffid, entity_type, group, ...otherData } = req.body;

  // For SUPPLIERS group, set specific fields to NULL
  if (group === 'SUPPLIERS') {
    assigned_staff = assigned_staff || null;
    staffid = staffid || null;
    entity_type = entity_type || null;
    role = 'supplier';
  }

  // Prepare data for insertion
  const data = { 
    name, 
    email, 
    phone_number, 
    password, 
    role, 
    assigned_staff, 
    staffid, 
    entity_type,
    group,
    ...otherData 
  };

  // Clean the data - remove undefined values
  Object.keys(data).forEach(key => {
    if (data[key] === undefined || data[key] === '') {
      data[key] = null;
    }
  });

  const sql = "INSERT INTO accounts SET ?";

  try {
    const [result] = await db.promise().query(sql, data);

    // Email setup (your existing code)
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

    const mailOptions = {
      from: "bharathsiripuram98@gmail.com",
      to: email,
      subject: "Your Account Details",
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
    
    // Check if it's a NULL constraint violation
    if (dbErr.code === 'ER_BAD_NULL_ERROR') {
      return res.status(400).json({ 
        error: "Database constraint violation. Some required fields are missing.",
        details: dbErr.sqlMessage 
      });
    }
    
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

router.get("/accounts/:id", (req, res) => {
  db.query("SELECT * FROM accounts WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).send(err);
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