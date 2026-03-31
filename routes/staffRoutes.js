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
    status = "Active",
    invoiceEnabled,
    discount,           // ✅ New field
    target,             // ✅ New field
    creditLimit,        // ✅ New field
    openingBalance,     // ✅ New field
    openingBalanceType, // ✅ New field
    accountGroupId,     // ✅ New field
    
    // New Retailer Fields
    entity_type,
    gstin,
    business_name,
    display_name,
    gst_registered_name,
    additional_business_name,
    fax,
    accountNumber,
    accountName,
    account_type,
    tanNumber,
    tdsSlabRate,
    currency,
    termsOfPayment,
    reverseCharge,
    exportSez,
    
    // Shipping & Billing Address Fields
    shipping_address_line1,
    shipping_address_line2,
    shipping_city,
    shipping_pin_code,
    shipping_state,
    shipping_country,
    shipping_branch_name,
    shipping_gstin,
    
    billing_address_line1,
    billing_address_line2,
    billing_city,
    billing_pin_code,
    billing_state,
    billing_country,
    billing_branch_name,
    billing_gstin
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

    // Generate password
    const password = `${fullName.replace(/\s+/g, "")}@123`;
    const isDualAccount = invoiceEnabled === 1 ? 1 : 0;

    // Prepare staff data with all new fields
    const staffData = {
      account_group_id: accountGroupId || null,
      'group': "staff", 
      title: "Mr.",
      entity_type: entity_type || "Individual",
      name: fullName,
      role: role,
      opening_balance: openingBalance || null,
      opening_balance_type: openingBalanceType || null,
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
      discount: discount || 0,
      target: target || 100000,
      credit_limit: creditLimit || null,
      bank_account_number: bankAccountNumber || null,
      ifsc_code: ifscCode || null,
      bank_name: bankName || null,
      account_type: account_type || null,
      branch_name: branchName || null,
      upi_id: upiId || null,
      aadhaar_number: aadhaarNumber || null,
      pan: panNumber || null,
      tan: tanNumber || null,
      blood_group: bloodGroup || null,
      emergency_contact: emergencyContact || null,
      tds_slab_rate: tdsSlabRate || null,
      currency: currency || "INR",
      terms_of_payment: termsOfPayment || null,
      reverse_charge: reverseCharge || "No",
      export_sez: exportSez || "Not Applicable",
      
      // Shipping Address Fields
      shipping_address_line1: shipping_address_line1 || null,
      shipping_address_line2: shipping_address_line2 || null,
      shipping_city: shipping_city || null,
      shipping_pin_code: shipping_pin_code || null,
      shipping_state: shipping_state || null,
      shipping_country: shipping_country || "India",
      shipping_branch_name: shipping_branch_name || null,
      shipping_gstin: shipping_gstin || null,
      
      // Billing Address Fields
      billing_address_line1: billing_address_line1 || null,
      billing_address_line2: billing_address_line2 || null,
      billing_city: billing_city || null,
      billing_pin_code: billing_pin_code || null,
      billing_state: billing_state || null,
      billing_country: billing_country || "India",
      billing_branch_name: billing_branch_name || null,
      billing_gstin: billing_gstin || null,
      
      // Additional Business Fields
      gstin: gstin || null,
      gst_registered_name: gst_registered_name || null,
      business_name: business_name || null,
      additional_business_name: additional_business_name || null,
      display_name: display_name || fullName,
      fax: fax || null,
      
      // Account Information
      account_number: accountNumber || null,
      account_name: accountName || null,
      
      password: password,
      phone_number: null,
      status: status,
      is_dual_account: isDualAccount
    };

    const sql = "INSERT INTO accounts SET ?";
    db.query(sql, staffData, async (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send({ error: "Failed to create staff account" });
      }

      // Prepare email content based on is_dual_account
      let emailText = `
Hello ${fullName},

Your staff account has been successfully created.

Phone Number: ${mobileNumber}
Role: ${role}
Email: ${email}
Password: ${password}
`;

      // Add invoice creation message only if is_dual_account is 1
      if (isDualAccount === 1) {
        emailText += `

✅ You have been enabled to create invoices. You can now access the invoice creation feature in your account.`;
      }

      emailText += `

Please keep this information secure.`;

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
        text: emailText,
      };

      try {
        await transporter.sendMail(mailOptions);
        res.status(201).send({
          message: "Staff account created successfully and email sent",
          id: result.insertId,
          defaultPassword: password,
          is_dual_account: isDualAccount
        });
      } catch (mailErr) {
        console.error("Email error:", mailErr);
        res.status(201).send({
          message: "Staff account created but failed to send email",
          id: result.insertId,
          defaultPassword: password,
          is_dual_account: isDualAccount
        });
      }
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
      password,
      department,
      joining_date,
      incentive_percent,
      salary,
      discount,
      target,
      credit_limit,
      opening_balance,
      opening_balance_type,
      account_group_id,
      bank_account_number,
      ifsc_code,
      bank_name,
      account_type,
      branch_name,
      upi_id,
      aadhaar_number,
      pan as pan_number,
      tan as tan_number,
      blood_group,
      emergency_contact,
      tds_slab_rate,
      currency,
      terms_of_payment,
      reverse_charge,
      export_sez,
      status,
      is_dual_account,
      entity_type,
      gstin,
      business_name,
      display_name,
      gst_registered_name,
      additional_business_name,
      fax,
      account_number,
      account_name,
      shipping_address_line1,
      shipping_address_line2,
      shipping_city,
      shipping_pin_code,
      shipping_state,
      shipping_country,
      shipping_branch_name,
      shipping_gstin,
      billing_address_line1,
      billing_address_line2,
      billing_city,
      billing_pin_code,
      billing_state,
      billing_country,
      billing_branch_name,
      billing_gstin
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
      discount,
      target,
      credit_limit,
      opening_balance,
      opening_balance_type,
      account_group_id,
      bank_account_number,
      ifsc_code,
      bank_name,
      account_type,
      branch_name,
      upi_id,
      aadhaar_number,
      pan as pan_number,
      tan as tan_number,
      blood_group,
      emergency_contact,
      tds_slab_rate,
      currency,
      terms_of_payment,
      reverse_charge,
      export_sez,
      status,
      password,
      is_dual_account,
      entity_type,
      gstin,
      business_name,
      display_name,
      gst_registered_name,
      additional_business_name,
      fax,
      account_number,
      account_name,
      shipping_address_line1,
      shipping_address_line2,
      shipping_city,
      shipping_pin_code,
      shipping_state,
      shipping_country,
      shipping_branch_name,
      shipping_gstin,
      billing_address_line1,
      billing_address_line2,
      billing_city,
      billing_pin_code,
      billing_state,
      billing_country,
      billing_branch_name,
      billing_gstin
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
    
    console.log("Staff data with password:", results[0]);
    res.send(results[0]);
  });
});

router.put("/staff/:id", (req, res) => {
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
    aadhaarNumber,
    panNumber,
    bloodGroup,
    emergencyContact,
    status,

    // Retailer toggle
    is_dual_account,

    // Retailer fields
    entity_type,
    gstin,
    business_name,
    display_name,
    gst_registered_name,
    additional_business_name,
    fax,
    discount,
    Target,
    credit_limit,
    opening_balance,
    opening_balance_type,

    // Bank / tax fields
    accountNumber,
    accountName,
    accountType,
    bankName,
    ifscCode,
    branchName,
    upiId,
    tanNumber,
    tdsSlabRate,
    currency,
    termsOfPayment,
    reverseCharge,
    exportSez,

    // Shipping address
    shipping_address_line1,
    shipping_address_line2,
    shipping_city,
    shipping_pin_code,
    shipping_state,
    shipping_country,
    shipping_branch_name,
    shipping_gstin,

    // Billing address
    billing_address_line1,
    billing_address_line2,
    billing_city,
    billing_pin_code,
    billing_state,
    billing_country,
    billing_branch_name,
    billing_gstin,
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

  const password = `${fullName.replace(/\s+/g, "")}@123`;
  const isDualAccount = is_dual_account === 1 ? 1 : 0;

  // Fetch current staff data to detect changes for email notification
  const getCurrentSql =
    "SELECT name, email, mobile_number, role, is_dual_account, status FROM accounts WHERE id = ? AND `group` = 'staff'";

  db.query(getCurrentSql, [req.params.id], (err, currentData) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({ error: "Failed to fetch current staff data" });
    }

    if (currentData.length === 0) {
      return res.status(404).send({ error: "Staff member not found" });
    }

    const current = currentData[0];

    const hasChanges =
      current.name !== fullName ||
      current.email !== email ||
      current.role !== role ||
      current.is_dual_account !== isDualAccount ||
      current.status !== status;

    const updateData = {
      name:                     fullName,
      mobile_number:            mobileNumber || null,
      alternate_number:         alternateNumber || null,
      email:                    email,
      date_of_birth:            dateOfBirth || null,
      gender:                   gender || null,
      address:                  address || null,
      role:                     role,
      designation:              designation || null,
      department:               department || null,
      joining_date:             joiningDate || null,
      incentive_percent:        incentivePercent || null,
      salary:                   salary || null,

      // Retailer financial fields — fixed snake_case from frontend
      discount:                 discount || 0,
      target:                   Target || 100000,
      credit_limit:             credit_limit || null,
      opening_balance:          opening_balance || null,
      opening_balance_type:     opening_balance_type || null,

      // Bank / account fields
      account_number:           accountNumber || null,
      account_name:             accountName || null,
      bank_name:                bankName || null,
      ifsc_code:                ifscCode || null,
      account_type:             accountType || null,
      branch_name:              branchName || null,
      upi_id:                   upiId || null,

      // Documents
      aadhaar_number:           aadhaarNumber || null,
      pan:                      panNumber || null,
      blood_group:              bloodGroup || null,
      emergency_contact:        emergencyContact || null,

      // Tax fields
      tan:                      tanNumber || null,
      tds_slab_rate:            tdsSlabRate || null,
      currency:                 currency || "INR",
      terms_of_payment:         termsOfPayment || null,
      reverse_charge:           reverseCharge || "No",
      export_sez:               exportSez || "Not Applicable",

      // Retailer business info
      entity_type:              entity_type || null,
      gstin:                    gstin || null,
      gst_registered_name:      gst_registered_name || null,
      business_name:            business_name || null,
      additional_business_name: additional_business_name || null,
      display_name:             display_name || fullName,
      fax:                      fax || null,

      // Shipping address
      shipping_address_line1:   shipping_address_line1 || null,
      shipping_address_line2:   shipping_address_line2 || null,
      shipping_city:            shipping_city || null,
      shipping_pin_code:        shipping_pin_code || null,
      shipping_state:           shipping_state || null,
      shipping_country:         shipping_country || "India",
      shipping_branch_name:     shipping_branch_name || null,
      shipping_gstin:           shipping_gstin || null,

      // Billing address
      billing_address_line1:    billing_address_line1 || null,
      billing_address_line2:    billing_address_line2 || null,
      billing_city:             billing_city || null,
      billing_pin_code:         billing_pin_code || null,
      billing_state:            billing_state || null,
      billing_country:          billing_country || "India",
      billing_branch_name:      billing_branch_name || null,
      billing_gstin:            billing_gstin || null,

      status:                   status,
      password:                 password,
      is_dual_account:          isDualAccount,
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

      // Send notification email only if key fields changed
      if (hasChanges) {
        let emailText = `Hello ${fullName},

Your staff account has been successfully updated.

Phone Number: ${mobileNumber || "N/A"}
Role: ${role}
Email: ${email}
Password: ${password}`;

        if (isDualAccount === 1) {
          emailText += `\n\n✅ You have been enabled to create invoices. You can now access the invoice creation feature in your account.`;
        }

        emailText += `\n\nPlease keep this information secure.`;

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
          subject: "Your Staff Account Details - Updated",
          text: emailText,
        };

        transporter.sendMail(mailOptions).catch((mailErr) => {
          console.error("Email error:", mailErr);
        });
      }

      res.send({
        message: "Staff account updated successfully",
        id: req.params.id,
        password: password,
        is_dual_account: isDualAccount,
        changes_detected: hasChanges,
        email_sent: hasChanges,
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