const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');

// --------------------- CREATE ACCOUNT ---------------------
router.post("/accounts", async (req, res) => {
  // Destructure request body with defaults
  let {
    name,
    email,
    phone_number,
    password,
    role,
    assigned_staff,
    staffid,
    entity_type,
    group,
    discount = 0,    // default 0
    Target = 100000, // default 100000
    ...otherData
  } = req.body;

  // Supplier-specific adjustments
  if (group === 'SUPPLIERS') {
    assigned_staff = assigned_staff || null;
    staffid = staffid || null;
    entity_type = entity_type || null;
    role = 'supplier';
  }

  // Prepare data object for DB insertion
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
    discount,
    Target,
    ...otherData
  };
  // Replace undefined or empty strings with null
  Object.keys(data).forEach(key => {
    if (data[key] === undefined || data[key] === '') data[key] = null;
  });

  const sql = "INSERT INTO accounts SET ?";

  try {
    const [result] = await db.promise().query(sql, data);

    // Send email only for retailer
    if (role === 'retailer') {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "bharathsiripuram98@gmail.com",
          pass: "alsishqgybtzonoj",
        },
        tls: { rejectUnauthorized: false },
      });

      const mailOptions = {
        from: "bharathsiripuram98@gmail.com",
        to: email,
        subject: "Your Retailer Account Details",
        text: `
Hello ${name},

Your retailer account has been successfully created.
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
          message: "Retailer added and email sent successfully!",
          id: result.insertId,
          ...data,
        });
   } catch (mailErr) {
        console.error("Email Error:", mailErr);
        res.status(201).json({
          message: "Retailer added but failed to send email",
          id: result.insertId,
          ...data,
        });
      }
    } else {
      res.status(201).json({
        message: "Supplier added successfully!",
        id: result.insertId,
        ...data,
      });
    }
  } catch (dbErr) {
    console.error("DB Insert Error:", dbErr);
    if (dbErr.code === 'ER_BAD_NULL_ERROR') {
      return res.status(400).json({
        error: "Database constraint violation. Some required fields are missing.",
        details: dbErr.sqlMessage
      });
    }
    res.status(500).json({ error: "Failed to add user to database" });
  }
});

// --------------------- GET ALL ACCOUNTS ---------------------
router.get("/accounts", (req, res) => {
  db.query("SELECT * FROM accounts", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

router.get("/accounts/retailers", (req, res) => {
  const query = "SELECT * FROM accounts WHERE role = 'retailer'";

  db.query(query, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Add this login route to your backend
router.post("/accounts/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const sql = "SELECT * FROM accounts WHERE email = ? AND password = ? AND role = 'retailer'";

  try {
    const [results] = await db.promise().query(sql, [email, password]);
    
    if (results.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Login successful
    const user = results[0];
    res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile_number:user.mobile_number,
        entity_type:user.entity_type,
        business_name:user.business_name,
        discount:user.discount,
        shipping_address_line1: user.shipping_address_line1,
        shipping_address_line2:user.shipping_address_line2,
        shipping_city:user.shipping_city,
        shipping_pin_code:user.shipping_pin_code,
        shipping_state:user.shipping_state,
        shipping_country:user.shipping_country,
        staffid:user.staffid,
        assigned_staff:user.assigned_staff


        // Add other fields you need
      }
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Database query failed", details: err.message });
  }
});


// --------------------- GET ACCOUNT BY ID ---------------------
router.get("/accounts/:id", (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM accounts WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).send({ error: "Database query failed", details: err.message });
    if (results.length === 0) return res.status(404).send({ error: "Account not found" });
    res.send(results[0]);
  });
});


// --------------------- UPDATE ACCOUNT ---------------------
router.put("/accounts/:id", (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Remove id to avoid updating primary key
  delete updates.id;

  const fields = Object.keys(updates);
  if (fields.length === 0) return res.status(400).send({ error: 'No fields to update' });

  const setClause = fields.map(key => `\`${key}\` = ?`).join(', ');
  const values = fields.map(field => updates[field] === '' ? null : updates[field]);

  const query = `UPDATE accounts SET ${setClause} WHERE id = ?`;

  db.query(query, [...values, id], (err, results) => {
    if (err) return res.status(500).send({ error: 'Database update failed', details: err.message });
    if (results.affectedRows === 0) return res.status(404).send({ error: 'Account not found or no changes made' });
    res.send({ message: 'Account updated successfully', affectedRows: results.affectedRows });
  });
});

// --------------------- DELETE ACCOUNT ---------------------
router.delete("/accounts/:id", (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM accounts WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).send({ error: 'Database delete failed', details: err.message });
    if (results.affectedRows === 0) return res.status(404).send({ error: 'Account not found' });
    res.send({ message: 'Account deleted successfully', affectedRows: results.affectedRows });
  });
});


router.get("/get-sales-retailers/:id", (req, res) => {
  const staffId = req.params.id;

  const query = `
    SELECT *
    FROM accounts
    WHERE role = 'retailer' AND staffid = ?
  `;

  db.query(query, [staffId], (err, results) => {
    if (err) {
      console.error("DB Error:", err);
      return res.json({
        success: false,
        error: "Database error"
      });
    }

    return res.json({
      success: true,
      data: results
    });
  });
});


// --------------------- GET STAFF DETAILS BY STAFFID ---------------------
// --------------------- GET STAFF DETAILS BY ID ---------------------
router.get("/accounts/get-staff/:id", (req, res) => {
  const { id } = req.params;

  if (!id || id === "null" || id === "undefined") {
    return res.status(400).json({
      success: false,
      error: "Staff ID is required"
    });
  }

  const query = `
    SELECT id, name, email, mobile_number
    FROM accounts 
    WHERE id = ?
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({
        success: false,
        error: "Database error"
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const user = results[0];
    return res.json({
      success: true,
      staff: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.mobile_number,
        // mobile: user.mobile_number // Alias for frontend
      }
    });
  });
});

module.exports = router;