const express = require("express");
const router = express.Router();
const db = require("./../../db");

// RESET PASSWORD (oldPassword → newPassword)
router.post("/reset-password", (req, res) => {
  const { email, oldPassword, newPassword } = req.body;

  if (!email || !oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: "All fields required",
    });
  }

  // Step 1 — Check if old password matches
  const checkSql = "SELECT password FROM accounts WHERE email = ?";

  db.query(checkSql, [email], (err, results) => {
    if (err) {
      console.error("Query error:", err);
      return res.status(500).json({ success: false, error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(400).json({
        success: false,
        error: "User not found",
      });
    }

    const currentPassword = results[0].password;

    if (currentPassword !== oldPassword) {
      return res.status(400).json({
        success: false,
        error: "Old password is incorrect",
      });
    }

    // Step 2 — Update password
    const updateSql = "UPDATE accounts SET password = ? WHERE email = ?";

    db.query(updateSql, [newPassword, email], (err, updateResult) => {
      if (err) {
        console.error("Update error:", err);
        return res.status(500).json({
          success: false,
          error: "Failed to update password",
        });
      }

      return res.json({
        success: true,
        message: "Password updated successfully",
      });
    });
  });
});

module.exports = router;
