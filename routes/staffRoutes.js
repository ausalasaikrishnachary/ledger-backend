const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');

// Create Staff Account
router.post("/staff", (req, res) => {
  const {
    fullName,
    mobileNumber,
    alternateNumber,
    email,
    dateOfBirth,
    gender,
    address,
    role,
    designation,
    department,
    joiningDate,
    incentivePercent,
    salary,
    bankAccountNumber,
    ifscCode,
    bankName,
    branchName,
    upiId,
    aadhaarNumber,
    panNumber,
    bloodGroup,
    emergencyContact,
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

      // Generate password
      const password = `${fullName.replace(/\s+/g, "")}@123`;

      // Prepare staff data with all new fields
      const staffData = {
        account_group_id: null,
        'group': "staff", 
        title: "Mr.",
        entity_type: "Individual",
        name: fullName,
        role: role,
        opening_balance: null,
        mobile_number: mobileNumber,
        alternate_number: alternateNumber || null,
        email: email,
        date_of_birth: dateOfBirth || null,
        gender: gender || null,
        address: address || null,
        designation: designation || null,
        department: department || null,
        joining_date: joiningDate || null,
        incentive_percent: incentivePercent || null,
        salary: salary || null,
        bank_account_number: bankAccountNumber || null,
        ifsc_code: ifscCode || null,
        bank_name: bankName || null,
        account_type: null,
        branch_name: branchName || null,
        upi_id: upiId || null,
        aadhaar_number: aadhaarNumber || null,
        pan: panNumber || null,
        tan: null,
        blood_group: bloodGroup || null,
        emergency_contact: emergencyContact || null,
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
        password: password,
        gstin: null,
        gst_registered_name: null,
        business_name: null,
        additional_business_name: null,
        display_name: fullName,
        phone_number: null,
        fax: null,
        account_number: null,
        account_name: null,
        status: status
      };

      const sql = "INSERT INTO accounts SET ?";
      db.query(sql, staffData, async (err, result) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).send({ error: "Failed to create staff account" });
        }

        // Send email
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
          subject: "Your Staff Account Details",
          text: `
Hello ${fullName},

Your staff account has been successfully created.

Phone Number: ${mobileNumber}
Role: ${role}
Email: ${email}
Password: ${password}

Please keep this information secure.
          `,
        };

        try {
          await transporter.sendMail(mailOptions);
          res.status(201).send({
            message: "Staff account created successfully and email sent",
            id: result.insertId,
            defaultPassword: password
          });
        } catch (mailErr) {
          console.error("Email error:", mailErr);
          res.status(201).send({
            message: "Staff account created but failed to send email",
            id: result.insertId,
            defaultPassword: password
          });
        }
      });
    });
  });
});

// Get All Staff Members - UPDATED: Added all new fields
router.get("/staff", (req, res) => {
  const sql = `
    SELECT 
      id, 
      name as full_name, 
      mobile_number, 
      alternate_number,
      email, 
      date_of_birth,
      gender,
      address,
      role, 
      designation,
      department,
      joining_date,
      incentive_percent,
      salary,
      bank_account_number,
      ifsc_code,
      bank_name,
      branch_name,
      upi_id,
      aadhaar_number,
      pan as pan_number,
      blood_group,
      emergency_contact,
      status 
    FROM accounts 
    WHERE \`group\` = 'staff'
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({ error: "Failed to fetch staff data" });
    }
    res.send(results);
  });
});

// Get Single Staff Member - UPDATED: Added all new fields
router.get("/staff/:id", (req, res) => {
  const sql = `
    SELECT 
      id, 
      name as full_name, 
      mobile_number, 
      alternate_number,
      email, 
      date_of_birth,
      gender,
      address,
      role, 
      designation,
      department,
      joining_date,
      incentive_percent,
      salary,
      bank_account_number,
      ifsc_code,
      bank_name,
      branch_name,
      upi_id,
      aadhaar_number,
      pan as pan_number,
      blood_group,
      emergency_contact,
      status 
    FROM accounts 
    WHERE id = ? AND \`group\` = 'staff'
  `;
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

// Update Staff Member - UPDATED: Added all new fields
router.put("/staff/:id", (req, res) => {
  const {
    fullName,
    alternateNumber,
    email,
    dateOfBirth,
    gender,
    address,
    role,
    designation,
    department,
    joiningDate,
    incentivePercent,
    salary,
    bankAccountNumber,
    ifscCode,
    bankName,
    branchName,
    upiId,
    aadhaarNumber,
    panNumber,
    bloodGroup,
    emergencyContact,
    status
  } = req.body;

  // Validate required fields
  if (!fullName || !email || !role) {
    return res.status(400).send({ error: "Full name, email, and role are required" });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).send({ error: "Please provide a valid email address" });
  }

  // Check if email already exists (excluding current staff member)
  const checkEmailSql = "SELECT id FROM accounts WHERE email = ? AND id != ?";
  db.query(checkEmailSql, [email, req.params.id], (err, results) => {
    if (err) return res.status(500).send({ error: "Database error" });

    if (results.length > 0) {
      return res.status(400).send({ error: "Email already exists" });
    }

    // Generate password from fullName
    const password = `${fullName.replace(/\s+/g, "")}@123`;

    // Update data with all new fields
    const updateData = {
      name: fullName,
      alternate_number: alternateNumber || null,
      email: email,
      date_of_birth: dateOfBirth || null,
      gender: gender || null,
      address: address || null,
      role: role,
      designation: designation || null,
      department: department || null,
      joining_date: joiningDate || null,
      incentive_percent: incentivePercent || null,
      salary: salary || null,
      bank_account_number: bankAccountNumber || null,
      ifsc_code: ifscCode || null,
      bank_name: bankName || null,
      branch_name: branchName || null,
      upi_id: upiId || null,
      aadhaar_number: aadhaarNumber || null,
      pan: panNumber || null,
      blood_group: bloodGroup || null,
      emergency_contact: emergencyContact || null,
      status: status,
      password: password,
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
        message: "Staff account updated successfully",
        id: req.params.id,
        password: password
      });
    });
  });
});

// Delete Staff Member
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

// Get Staff for Assignment
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