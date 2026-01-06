const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');

// utils / helpers (keep at top of file)
const toMySQLDateTime = (value) => {
  if (!value) return null;
  return new Date(value)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
};

// --------------------- CREATE ACCOUNT ---------------------
router.post("/accounts", async (req, res) => {
  // Clean the request body first - handle case inconsistencies
  const cleanRequestBody = {};
  const processedKeys = new Set();
  
  // Process all keys in request body, handling case inconsistencies
  Object.keys(req.body).forEach(key => {
    const lowerKey = key.toLowerCase();
    
    // If we haven't processed this key yet (case-insensitive)
    if (!processedKeys.has(lowerKey)) {
      processedKeys.add(lowerKey);
      
      // Handle target field specifically
      if (lowerKey === 'target') {
        // Use the value from 'target' if it exists, otherwise use 'Target'
        const targetValue = req.body.target !== undefined ? req.body.target : 
                           req.body.Target !== undefined ? req.body.Target : 100000;
        cleanRequestBody['target'] = targetValue;
      } else {
        // For other fields, keep the original key
        cleanRequestBody[key] = req.body[key];
      }
    }
  });
  
  // Remove any uppercase Target if it exists
  if (cleanRequestBody.Target) {
    delete cleanRequestBody.Target;
  }

  // Now destructure from cleaned request body
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
    target = 100000, // Now lowercase, default 100000
    ...otherData
  } = cleanRequestBody;

  // Supplier-specific adjustments
  if (group === 'SUPPLIERS') {
    assigned_staff = assigned_staff || null;
    staffid = staffid || null;
    entity_type = entity_type || null;
    role = 'supplier';
  }

  // Prepare data object for DB insertion
  // Use 'Target' (uppercase) for database column since that's what your table expects
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
    Target: target, // Map lowercase target to uppercase Target for DB
    ...otherData
  };
  
  // Replace undefined or empty strings with null
  Object.keys(data).forEach(key => {
    if (data[key] === undefined || data[key] === '') data[key] = null;
  });

  // Remove any lowercase target from data since we're using uppercase Target
  if (data.target) {
    delete data.target;
  }

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

// ================= UPDATE ACCOUNT =================
router.put("/accounts/:id", (req, res) => {
  const { id } = req.params;

  console.log("🔥 RAW BODY:", req.body);

  const updates = { ...req.body };

  // ❌ Block system-controlled fields
  delete updates.id;
  delete updates.created_at;
  delete updates.updated_at;

  // ✅ Fix DATETIME fields (VERY IMPORTANT)
  const datetimeFields = [
    "last_score_calculated",
    "otp_expires_at"
  ];

  datetimeFields.forEach((field) => {
    if (updates[field]) {
      updates[field] = toMySQLDateTime(updates[field]);
    }
  });

  const fields = [];
  const values = [];

  for (const key in updates) {
    fields.push(`\`${key}\` = ?`);
    values.push(updates[key] === "" ? null : updates[key]);
  }

  // ❌ Safety check
  if (fields.length === 0) {
    return res.status(400).json({ message: "No valid fields to update" });
  }

  const sql = `UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`;

  console.log("🔥 SQL:", sql);
  console.log("🔥 VALUES:", [...values, id]);

  db.query(sql, [...values, id], (err, result) => {
    if (err) {
      console.error("❌ FULL SQL ERROR:", err);
      return res.status(500).json({
        message: "SQL ERROR",
        code: err.code,
        sqlMessage: err.sqlMessage
      });
    }

    res.json({
      success: true,
      affectedRows: result.affectedRows
    });
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




// UPDATE retailer personal info
router.put("/update-retailer-info/:id", (req, res) => {
  const { id } = req.params;
  const { name, email, mobile_number } = req.body;

  if (!name || !email || !mobile_number) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const sql = `
    UPDATE accounts 
    SET name = ?, email = ?, mobile_number = ?
    WHERE id = ? AND role = 'retailer'
  `;

  db.query(sql, [name, email, mobile_number, id], (err, result) => {
    if (err) {
      console.error("❌ DB UPDATE ERROR:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Retailer not found" });
    }

    res.json({ success: true, message: "Profile updated successfully" });
  });
});

module.exports = router;




module.exports = router;