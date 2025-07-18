const express = require('express');
const router = express.Router();
const db = require('./../../db');

// Create Service
router.post("/services", (req, res) => {
  const data = req.body;
  const sql = "INSERT INTO services SET ?";
  db.query(sql, data, (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: result.insertId, ...data });
  });
});

// Get All Services
router.get("/services", (req, res) => {
  db.query("SELECT * FROM services", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Get Single Service
router.get("/services/:id", (req, res) => {
  db.query("SELECT * FROM services WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results[0]);
  });
});

// Update Service
router.put("/services/:id", (req, res) => {
  const data = req.body;
  db.query("UPDATE services SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: req.params.id, ...data });
  });
});

// Delete Service
router.delete("/services/:id", (req, res) => {
  db.query("DELETE FROM services WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ message: "Deleted successfully." });
  });
});

module.exports = router;
