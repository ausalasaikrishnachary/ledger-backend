// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // Adjust path as needed

// Dynamic Login Route
router.post("/login", (req, res) => {
  const { username, password } = req.body;

  // Validate required fields
  if (!username || !password) {
    return res.status(400).send({ 
      success: false,
      error: "Username (email/mobile) and password are required" 
    });
  }

  // Check if user exists by email or mobile number
  const sql = `
    SELECT 
      id, 
      name,
      email,
      mobile_number,
      role,
      password,
      status
    FROM accounts 
    WHERE (email = ? OR mobile_number = ?) AND status = 'Active'
  `;

  db.query(sql, [username, username], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({ 
        success: false,
        error: "Database error" 
      });
    }

    // if (results.length === 0) {
    //   return res.status(401).send({ 
    //     success: false,
    //     error: "Invalid username or account not active" 
    //   });
    // }

    const user = results[0];

    // Check password
    if (user.password !== password) {
      return res.status(401).send({ 
        success: false,
        error: "Invalid password" 
      });
    }

    // Determine route based on role
    let route;
    switch (user.role.toLowerCase()) {
      case 'admin':
        route = "/admindashboard";
        break;
      case 'staff':
        route = "/staffdashboard";
        break;
      case 'retailer':
        route = "/retailerdashboard";
        break;
      default:
        route = "/dashboard";
    }

    // Send success response with user data and route
    res.status(200).send({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mobile_number: user.mobile_number,
        role: user.role
      },
      route: route
    });
  });
});

module.exports = router;
