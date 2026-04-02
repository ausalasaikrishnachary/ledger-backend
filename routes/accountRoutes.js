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
  // Clean request body
  const cleanRequestBody = {};
  const processedKeys = new Set();
  
  Object.keys(req.body).forEach(key => {
    const lowerKey = key.toLowerCase();
    if (!processedKeys.has(lowerKey)) {
      processedKeys.add(lowerKey);
      if (lowerKey === 'target') {
        const targetValue = req.body.target ?? req.body.Target ?? 100000;
        cleanRequestBody['target'] = targetValue;
      } else {
        cleanRequestBody[key] = req.body[key];
      }
    }
  });
  if (cleanRequestBody.Target) delete cleanRequestBody.Target;

  // Destructure
  let {
    name,
    email,
    mobile_number,
    password,
    role,
    assigned_staff,
    staffid,
    entity_type,
    group,
    discount = 0,
    target = 100000,
    opening_balance = 0,
    opening_balance_type,
    ...otherData
  } = cleanRequestBody;

  // Supplier adjustments
  if (group === 'SUPPLIERS') {
    assigned_staff = assigned_staff || null;
    staffid = staffid || null;
    entity_type = entity_type || null;
    role = 'supplier';
  }

  const data = {
    name,
    email,
    mobile_number,
    password,
    role,
    assigned_staff,
    staffid,
    entity_type,
    group,
    discount,
    Target: target,
    opening_balance,
    opening_balance_type,
    ...otherData
  };

  Object.keys(data).forEach(key => {
    if (data[key] === undefined || data[key] === '') data[key] = null;
  });
  if (data.target) delete data.target;

  const sql = "INSERT INTO accounts SET ?";

  try {
    const [result] = await db.promise().query(sql, data);

    // Determine dual account message (only if is_dual_account = 1)
    let messageText = null;
    const roleLower = role?.toLowerCase();
    const groupUpper = group?.toUpperCase();
    if (data.is_dual_account == 1 || data.is_dual_account === '1') {
      if (roleLower === 'retailer') {
        messageText = "Supplier enabled for this retailer";
      } else if (roleLower === 'supplier' || groupUpper === 'SUPPLIERS') {
        messageText = "Retailer enabled for this supplier";
      }
    }

    // Send email always
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "bharathsiripuram98@gmail.com", pass: "alsishqgybtzonoj" },
      tls: { rejectUnauthorized: false },
    });

    const mailOptions = {
      from: "bharathsiripuram98@gmail.com",
      to: email,
      subject: "Your Account Details",
      text: `
Hello ${name},

Your account has been successfully created.
Mobile Number: ${mobile_number}
Role: ${role}
Email: ${email}
Password: ${password}

${messageText ? messageText : ''}
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (err) {
      console.error("Email Error:", err);
    }

    // Respond
    res.status(201).json({
      id: result.insertId,
      ...data,
      ...(messageText && { message: messageText })
    });

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

  try {
    // Fetch account regardless of role
    const sql = "SELECT * FROM accounts WHERE email = ? AND password = ?";
    const [results] = await db.promise().query(sql, [email, password]);

    if (results.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = results[0];
    const roleLower = user.role?.toLowerCase();
    const groupUpper = user.group?.toUpperCase();

    // Login logic:
    // 1. Retailers always allowed
    // 2. Suppliers with group = 'SUPPLIERS' only if is_dual_account = 1
if (
  (
    roleLower === 'retailer' ||
    (roleLower === 'supplier' && user.is_dual_account == 1)
  ) &&
  user.status == 1
)  {
      return res.status(200).json({
        message: "Login successful",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          mobile_number: user.mobile_number,
          entity_type: user.entity_type,
          business_name: user.business_name,
          discount: user.discount,
          shipping_address_line1: user.shipping_address_line1,
          shipping_address_line2: user.shipping_address_line2,
          shipping_city: user.shipping_city,
          shipping_pin_code: user.shipping_pin_code,
          shipping_state: user.shipping_state,
          shipping_country: user.shipping_country,
          staffid: user.staffid,
          assigned_staff: user.assigned_staff,
          is_dual_account: user.is_dual_account
          // Add other fields if needed
        }
      });
    } else {
  const roleName =
    roleLower === 'retailer'
      ? 'Retailer'
      : roleLower === 'supplier'
      ? 'Supplier'
      : 'User';

  return res.status(403).json({
    error: `${roleName} account not enabled for login. Please contact admin.`
  });
}
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

router.put("/accounts/:id", async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  // ❌ Block system-controlled fields
  delete updates.id;
  delete updates.created_at;
  delete updates.updated_at;

  // ✅ Fix DATETIME fields
  const datetimeFields = ["last_score_calculated", "otp_expires_at"];
  datetimeFields.forEach((field) => {
    if (updates[field]) updates[field] = toMySQLDateTime(updates[field]);
  });

  const fields = [];
  const values = [];
  for (const key in updates) {
    fields.push(`\`${key}\` = ?`);
    values.push(updates[key] === "" ? null : updates[key]);
  }
  if (fields.length === 0) return res.status(400).json({ message: "No valid fields to update" });

  try {
    // Fetch old account BEFORE update
    const [oldRows] = await db.promise().query("SELECT * FROM accounts WHERE id = ?", [id]);
    const oldAccount = oldRows[0];

    // Perform the update
    const sql = `UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`;
    const [result] = await db.promise().query(sql, [...values, id]);

    // Fetch updated account AFTER update
    const [rows] = await db.promise().query("SELECT * FROM accounts WHERE id = ?", [id]);
    const updatedAccount = rows[0];

    // Determine message based on dual account change
    let messageText = null;
    const role = updatedAccount.role?.toLowerCase();
    const group = updatedAccount.group?.toUpperCase();

    if ((oldAccount.is_dual_account == 0) && (updatedAccount.is_dual_account == 1)) {
      // 0 -> 1
      if (role === 'retailer') {
        messageText = "Supplier enabled for this retailer ";
      } else if (role === 'supplier' || group === 'SUPPLIERS') {
        messageText = "Retailer enabled for this supplier";
      }
    } else if ((oldAccount.is_dual_account == 1) && (updatedAccount.is_dual_account == 0)) {
      // 1 -> 0
      if (role === 'retailer') {
        messageText = "Supplier disabled for this retailer";
      } else if (role === 'supplier' || group === 'SUPPLIERS') {
        messageText = "Retailer disabled for this supplier";
      }
    }

    // Send email always, include messageText if exists
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "bharathsiripuram98@gmail.com", pass: "alsishqgybtzonoj" },
      tls: { rejectUnauthorized: false },
    });

    const mailOptions = {
      from: "bharathsiripuram98@gmail.com",
      to: updatedAccount.email,
      subject: "Your Account Updated",
      text: `
Hello ${updatedAccount.name},

Your account has been updated.
Mobile Number: ${updatedAccount.mobile_number}
Role: ${updatedAccount.role}
Email: ${updatedAccount.email}
Password: ${updatedAccount.password || updates.password || 'N/A'}

${messageText ? messageText : ''}
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (err) {
      console.error("Email Error:", err);
    }

    // JSON response
    res.json({
      success: true,
      affectedRows: result.affectedRows,
      ...(messageText && { message: messageText }),
    });

  } catch (err) {
    console.error("SQL ERROR:", err);
    res.status(500).json({ message: "SQL ERROR", code: err.code, sqlMessage: err.sqlMessage });
  }
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

router.put('/accounts/:id/status', (req, res) => {
  const { id } = req.params;

  // convert to number (important)
  const dualValue = Number(req.body.status);


  db.query(
    "UPDATE accounts SET status = ? WHERE id = ?",
    [dualValue, id],
    (err, result) => {
      if (err) {
        console.error("❌ DB ERROR:", err);
        return res.status(500).json({ error: "Failed to update dual account" });
      }


      res.json({
        message: "Dual account updated successfully",
        affectedRows: result.affectedRows,
        changedRows: result.changedRows
      });
    }
  );
});


router.get("/admin", (req, res) => {
  const query = `
    SELECT email, password 
    FROM accounts 
    WHERE role = 'admin'
    LIMIT 1
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, error: "Database error" });
    }

    if (results.length === 0) {
      return res.json({ success: false, error: "Admin not found" });
    }

    return res.json({
      success: true,
      admin: results[0]
    });
  });
});

module.exports = router;