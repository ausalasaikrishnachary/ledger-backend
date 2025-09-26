const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

// Create Staff
router.post("/staff", async (req, res) => {
  try {
    const { fullName, mobileNumber, email, role, status } = req.body;

    // Validate required fields
    if (!fullName || !mobileNumber || !email || !role) {
      return res.status(400).json({
        error: "Missing required fields: fullName, mobileNumber, email, role"
      });
    }

    // Check if staff with email already exists
    const checkEmailQuery = "SELECT * FROM staff WHERE email = ?";
    db.query(checkEmailQuery, [email], async (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          error: "Database error",
          details: err.message
        });
      }

      if (results.length > 0) {
        return res.status(409).json({
          error: "Staff with this email already exists"
        });
      }

      // Generate default password (mobile number)
      const defaultPassword = mobileNumber;
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);

      const staffData = {
        full_name: fullName,
        mobile_number: mobileNumber,
        email: email,
        role: role,
        status: status || 'Active',
        password: hashedPassword
      };

      const sql = "INSERT INTO staff SET ?";
      db.query(sql, staffData, (err, result) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).json({
            error: "Failed to create staff account",
            details: err.message
          });
        }

        // Return success response without password
        const { password, ...staffWithoutPassword } = staffData;
        res.status(201).json({
          message: "Staff account created successfully",
          staff: {
            id: result.insertId,
            ...staffWithoutPassword
          }
        });
      });
    });

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
});

// Get All Staff
router.get("/staff", (req, res) => {
  const sql = "SELECT id, full_name, mobile_number, email, role, status, created_at FROM staff ORDER BY created_at DESC";
  
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        error: "Failed to fetch staff",
        details: err.message
      });
    }
    res.json(results);
  });
});

// Get Single Staff by ID
router.get("/staff/:id", (req, res) => {
  const sql = "SELECT id, full_name, mobile_number, email, role, status, created_at FROM staff WHERE id = ?";
  
  db.query(sql, [req.params.id], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        error: "Failed to fetch staff",
        details: err.message
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        error: "Staff not found"
      });
    }

    res.json(results[0]);
  });
});

// Update Staff
router.put("/staff/:id", async (req, res) => {
  try {
    const { fullName, mobileNumber, email, role, status } = req.body;
    const staffId = req.params.id;

    // Check if staff exists
    const checkStaffQuery = "SELECT * FROM staff WHERE id = ?";
    db.query(checkStaffQuery, [staffId], (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          error: "Database error",
          details: err.message
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          error: "Staff not found"
        });
      }

      // Check if email is being changed and if it already exists for another staff
      if (email && email !== results[0].email) {
        const checkEmailQuery = "SELECT * FROM staff WHERE email = ? AND id != ?";
        db.query(checkEmailQuery, [email, staffId], (err, emailResults) => {
          if (err) {
            console.error("Database error:", err);
            return res.status(500).json({
              error: "Database error",
              details: err.message
            });
          }

          if (emailResults.length > 0) {
            return res.status(409).json({
              error: "Email already exists for another staff member"
            });
          }

          updateStaff();
        });
      } else {
        updateStaff();
      }

      function updateStaff() {
        const updateData = {
          full_name: fullName,
          mobile_number: mobileNumber,
          email: email,
          role: role,
          status: status
        };

        // Remove undefined fields
        Object.keys(updateData).forEach(key => {
          if (updateData[key] === undefined) {
            delete updateData[key];
          }
        });

        const sql = "UPDATE staff SET ? WHERE id = ?";
        db.query(sql, [updateData, staffId], (err, result) => {
          if (err) {
            console.error("Database error:", err);
            return res.status(500).json({
              error: "Failed to update staff",
              details: err.message
            });
          }

          res.json({
            message: "Staff updated successfully",
            staff: {
              id: parseInt(staffId),
              ...updateData
            }
          });
        });
      }
    });

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
});

// Delete Staff
router.delete("/staff/:id", (req, res) => {
  const staffId = req.params.id;

  // Check if staff exists
  const checkStaffQuery = "SELECT * FROM staff WHERE id = ?";
  db.query(checkStaffQuery, [staffId], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        error: "Database error",
        details: err.message
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        error: "Staff not found"
      });
    }

    const sql = "DELETE FROM staff WHERE id = ?";
    db.query(sql, [staffId], (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          error: "Failed to delete staff",
          details: err.message
        });
      }

      res.json({
        message: "Staff deleted successfully"
      });
    });
  });
});

// Update Staff Status
router.patch("/staff/:id/status", (req, res) => {
  const staffId = req.params.id;
  const { status } = req.body;

  if (!status || !['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({
      error: "Valid status (Active/Inactive) is required"
    });
  }

  const sql = "UPDATE staff SET status = ? WHERE id = ?";
  db.query(sql, [status, staffId], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        error: "Failed to update staff status",
        details: err.message
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Staff not found"
      });
    }

    res.json({
      message: `Staff status updated to ${status} successfully`
    });
  });
});

module.exports = router;