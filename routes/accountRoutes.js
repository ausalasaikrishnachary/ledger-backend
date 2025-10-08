const express = require('express');
const router = express.Router();
const db = require('../db');

// Create Account
router.post("/accounts", (req, res) => {
  const data = req.body;

  // Always set default password as "1234" if not provided
  const accountData = {
    ...data,
    password: data.password || "1234"
  };

  const sql = "INSERT INTO accounts SET ?";
  db.query(sql, accountData, (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send({ error: "Database error", details: err });
    }

    res.send({
      message: "Account created successfully",
      id: result.insertId,
      defaultPassword: "1234",
      ...accountData
    });
  });
});


// Get All Accounts
router.get("/accounts", (req, res) => {
  db.query("SELECT * FROM accounts", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Get Single Account
router.get("/accounts/:id", (req, res) => {
  db.query("SELECT * FROM accounts WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results[0]);
  });
});

// Update Account
router.put("/accounts/:id", (req, res) => {
  const data = req.body;
  db.query("UPDATE accounts SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: req.params.id, ...data });
  });
});

// Delete Account
router.delete("/accounts/:id", (req, res) => {
  db.query("DELETE FROM accounts WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ message: "Deleted successfully." });
  });
});


module.exports = router;