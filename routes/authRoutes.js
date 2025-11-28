// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'tharunkumarreddy1212@gmail.com',
    pass: 'lucy drra jctw zadi'
  }
});

// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Forgot Password - Send OTP
router.post("/forgot-password", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send({
      success: false,
      error: "Email is required"
    });
  }

  // Check if email exists in accounts table
  const checkEmailSql = "SELECT id, email FROM accounts WHERE email = ? AND status = 'Active'";
  
  db.query(checkEmailSql, [email], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({
        success: false,
        error: "Database error"
      });
    }

    if (results.length === 0) {
      return res.status(404).send({
        success: false,
        error: "Email not found or account not active"
      });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP expires in 10 minutes

    // Update accounts table with OTP
    const updateSql = "UPDATE accounts SET otp = ?, otp_expires_at = ?, otp_used = 0 WHERE email = ?";
    
    db.query(updateSql, [otp, expiresAt, email], (updateErr) => {
      if (updateErr) {
        console.error("Update OTP error:", updateErr);
        return res.status(500).send({
          success: false,
          error: "Failed to generate OTP"
        });
      }

      // Send OTP via email
      const mailOptions = {
        from: 'tharunkumarreddy1212@gmail.com',
        to: email,
        subject: 'Password Reset OTP',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You requested to reset your password. Use the OTP below to proceed:</p>
            <div style="background: #f4f4f4; padding: 15px; text-align: center; margin: 20px 0;">
              <h1 style="margin: 0; color: #007bff; letter-spacing: 5px;">${otp}</h1>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
          </div>
        `
      };

      transporter.sendMail(mailOptions, (mailErr) => {
        if (mailErr) {
          console.error("Email error:", mailErr);
          // Still return success as OTP is generated and stored
          return res.status(200).send({
            success: true,
            message: "OTP generated successfully. Check your email for the OTP.",
            otp: otp // For development/testing
          });
        }

        res.status(200).send({
          success: true,
          message: "OTP sent to your email address"
        });
      });
    });
  });
});

// Verify OTP and Reset Password
router.post("/reset-password", (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).send({
      success: false,
      error: "Email, OTP and new password are required"
    });
  }

  // Verify OTP from accounts table
  const verifySql = "SELECT * FROM accounts WHERE email = ? AND otp = ? AND otp_used = 0 AND otp_expires_at > NOW()";
  
  db.query(verifySql, [email, otp], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({
        success: false,
        error: "Database error"
      });
    }

    if (results.length === 0) {
      return res.status(400).send({
        success: false,
        error: "Invalid or expired OTP"
      });
    }

    // Update password and mark OTP as used in accounts table
    const updateSql = "UPDATE accounts SET password = ?, otp_used = 1, otp = NULL, otp_expires_at = NULL WHERE email = ?";
    
    db.query(updateSql, [newPassword, email], (updateErr, updateResults) => {
      if (updateErr) {
        console.error("Update password error:", updateErr);
        return res.status(500).send({
          success: false,
          error: "Failed to reset password"
        });
      }

      if (updateResults.affectedRows === 0) {
        return res.status(404).send({
          success: false,
          error: "User not found"
        });
      }

      res.status(200).send({
        success: true,
        message: "Password reset successfully"
      });
    });
  });
});

module.exports = router;