const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');

// Create Account
router.post("/accounts", async (req, res) => {
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
    discount,
    Target,
    ...otherData
  } = req.body;

  if (group === "SUPPLIERS") {
    assigned_staff = assigned_staff || null;
    staffid = staffid || null;
    entity_type = entity_type || null;
    role = "supplier";
  }

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
    discount: discount || 0,
    Target: Target || 100000,
    ...otherData,
  };

  Object.keys(data).forEach((key) => {
    if (data[key] === undefined || data[key] === "") {
      data[key] = null;
    }
  });

  const sql = "INSERT INTO accounts SET ?";

  try {
    console.log("Data being inserted:", data);
    const [result] = await db.promise().query(sql, data);

    if (role === "retailer") {
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
    if (dbErr.code === "ER_BAD_NULL_ERROR") {
      return res.status(400).json({
        error: "Database constraint violation. Some required fields are missing.",
        details: dbErr.sqlMessage,
      });
    }

    res.status(500).json({ error: "Failed to add user to database" });
  }
});


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

// GET account by ID
router.get("/accounts/:id", (req, res) => {
  const { id } = req.params;
  
  console.log('Fetching account with ID:', id);
  
  db.query("SELECT * FROM accounts WHERE id = ?", [id], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send({ 
        error: 'Database query failed',
        details: err.message 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).send({ error: 'Account not found' });
    }
    
    res.send(results[0]);
  });
});

// UPDATE account
router.put("/accounts/:id", (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  console.log('Updating account ID:', id);
  console.log('Update data:', updates);
  
  // Remove id from updates to prevent updating primary key
  delete updates.id;
  
  // Check if there are any fields to update
  const fields = Object.keys(updates);
  if (fields.length === 0) {
    return res.status(400).send({ error: 'No fields to update' });
  }
  
  // Build dynamic UPDATE query
  const setClause = fields.map(key => `\`${key}\` = ?`).join(', ');
  const values = fields.map(field => {
    let value = updates[field];
    // Convert empty strings to null for database
    if (value === '') return null;
    return value;
  });
  
  const query = `UPDATE accounts SET ${setClause} WHERE id = ?`;
  
  console.log('Executing query:', query);
  console.log('With values:', [...values, id]);
  
  db.query(query, [...values, id], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send({ 
        error: 'Database update failed',
        details: err.message,
        sqlMessage: err.sqlMessage 
      });
    }
    
    if (results.affectedRows === 0) {
      return res.status(404).send({ error: 'Account not found or no changes made' });
    }
    
    res.send({ 
      message: 'Account updated successfully', 
      affectedRows: results.affectedRows 
    });
  });
});

// DELETE account
router.delete("/accounts/:id", (req, res) => {
  const { id } = req.params;
  
  console.log('Deleting account ID:', id);
  
  db.query("DELETE FROM accounts WHERE id = ?", [id], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send({ 
        error: 'Database delete failed',
        details: err.message 
      });
    }
    
    if (results.affectedRows === 0) {
      return res.status(404).send({ error: 'Account not found' });
    }
    
    res.send({ 
      message: 'Account deleted successfully',
      affectedRows: results.affectedRows 
    });
  });
});


// router.put("/accounts/:id", (req, res) => {
//   const data = req.body;
//   db.query("UPDATE accounts SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
//     if (err) return res.status(500).send(err);
//     res.send({ id: req.params.id, ...data });
//   });
// });

// router.delete("/accounts/:id", (req, res) => {
//   db.query("DELETE FROM accounts WHERE id = ?", [req.params.id], (err, result) => {
//     if (err) return res.status(500).send(err);
//     res.send({ message: "Deleted successfully." });
//   });
// });



module.exports = router;