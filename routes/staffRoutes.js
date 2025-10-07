const express = require('express');
const router = express.Router();
const db = require('../db');

// Create Staff Account
router.post("/staff", (req, res) => {
  const {
    fullName,
    mobileNumber,
    email,
    role,
    status = "Active"
  } = req.body;

  // Validate required fields
  if (!fullName || !mobileNumber || !email || !role) {
    return res.status(400).send({ 
      error: "Full name, mobile number, email, and role are required" 
    });
  }

  // Validate mobile number format
  if (!/^\d{10}$/.test(mobileNumber)) {
    return res.status(400).send({ 
      error: "Mobile number must be 10 digits" 
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).send({ 
      error: "Please provide a valid email address" 
    });
  }

  // Check if mobile number already exists
  const checkMobileSql = "SELECT id FROM accounts WHERE mobile_number = ?";
  db.query(checkMobileSql, [mobileNumber], (err, results) => {
    if (err) return res.status(500).send({ error: "Database error" });
    
    if (results.length > 0) {
      return res.status(400).send({ 
        error: "Mobile number already exists" 
      });
    }

    // Check if email already exists
    const checkEmailSql = "SELECT id FROM accounts WHERE email = ?";
    db.query(checkEmailSql, [email], (err, emailResults) => {
      if (err) return res.status(500).send({ error: "Database error" });
      
      if (emailResults.length > 0) {
        return res.status(400).send({ 
          error: "Email already exists" 
        });
      }

      // Prepare staff data with all required fields set to NULL except the essential ones
      const staffData = {
        account_group_id: null,
        'group': "staff", // Escaped with backticks
        title: "Mr.",
        entity_type: "Individual",
        name: fullName,
        role: role,
        opening_balance: null,
        mobile_number: mobileNumber,
        email: email,
         password: "1234", 
        gstin: null,
        gst_registered_name: null,
        business_name: null,
        additional_business_name: null,
        display_name: fullName,
        phone_number: null,
        fax: null,
        account_number: null,
        account_name: null,
        bank_name: null,
        account_type: null,
        branch_name: null,
        ifsc_code: null,
        pan: null,
        tan: null,
        tds_slab_rate: null,
        currency: null,
        terms_of_payment: null,
        reverse_charge: "No",
        export_sez: "No",
        shipping_address_line1: null,
        shipping_address_line2: null,
        shipping_city: null,
        shipping_pin_code: null,
        shipping_state: null,
        shipping_country: null,
        shipping_branch_name: null,
        shipping_gstin: null,
        billing_address_line1: null,
        billing_address_line2: null,
        billing_city: null,
        billing_pin_code: null,
        billing_state: null,
        billing_country: null,
        billing_branch_name: null,
        billing_gstin: null,
        status: status
      };

      const sql = "INSERT INTO accounts SET ?";
      db.query(sql, staffData, (err, result) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).send({ error: "Failed to create staff account" });
        }
        
        res.status(201).send({ 
          message: "Staff account created successfully", 
          id: result.insertId,
          defaultPassword: "1234" /// Default password is mobile number
        });
      });
    });
  });
});

// Get All Staff Members - FIXED: Added backticks around `group`
router.get("/staff", (req, res) => {
  const sql = "SELECT id, name as full_name, mobile_number, email, role, status FROM accounts WHERE `group` = 'staff'";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({ error: "Failed to fetch staff data" });
    }
    res.send(results);
  });
});

// Get Single Staff Member - FIXED: Added backticks around `group`
router.get("/staff/:id", (req, res) => {
  const sql = "SELECT id, name as full_name, mobile_number, email, role, status FROM accounts WHERE id = ? AND `group` = 'staff'";
  db.query(sql, [req.params.id], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({ error: "Failed to fetch staff data" });
    }
    
    if (results.length === 0) {
      return res.status(404).send({ error: "Staff member not found" });
    }
    
    res.send(results[0]);
  });
});

// Update Staff Member - FIXED: Added backticks around `group`
router.put("/staff/:id", (req, res) => {
  const {
    fullName,
    email,
    role,
    status
  } = req.body;

  // Validate required fields
  if (!fullName || !email || !role) {
    return res.status(400).send({ 
      error: "Full name, email, and role are required" 
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).send({ 
      error: "Please provide a valid email address" 
    });
  }

  // Check if email already exists (excluding current staff member)
  const checkEmailSql = "SELECT id FROM accounts WHERE email = ? AND id != ?";
  db.query(checkEmailSql, [email, req.params.id], (err, results) => {
    if (err) return res.status(500).send({ error: "Database error" });
    
    if (results.length > 0) {
      return res.status(400).send({ 
        error: "Email already exists" 
      });
    }

    const updateData = {
      name: fullName,
      email: email,
      role: role,
      status: status,
      password: "1234",
      display_name: fullName
    };

    const sql = "UPDATE accounts SET ? WHERE id = ? AND `group` = 'staff'";
    db.query(sql, [updateData, req.params.id], (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send({ error: "Failed to update staff account" });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).send({ error: "Staff member not found" });
      }
      
      res.send({ 
        message: "Staff account updated successfully" 
      });
    });
  });
});

// Delete Staff Member - FIXED: Added backticks around `group`
router.delete("/staff/:id", (req, res) => {
  const sql = "DELETE FROM accounts WHERE id = ? AND `group` = 'staff'";
  db.query(sql, [req.params.id], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({ error: "Failed to delete staff account" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).send({ error: "Staff member not found" });
    }
    
    res.send({ message: "Staff account deleted successfully" });
  });
});


router.get("/account", (req, res) => {
  const sql = `
    SELECT 
      id, 
      name, 
      role
    FROM accounts
    WHERE LOWER(role) = 'staff'
  `;
  
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ success: false, error: "Failed to fetch staff data" });
    }
    res.json({ success: true, staff: results });
  });
});


module.exports = router;