const express = require('express');
const router = express.Router();
const db = require('./../../db');

// ---------- CATEGORY CRUD ----------

// Create Category
router.post("/categories", (req, res) => {
  const data = req.body;
  const sql = "INSERT INTO categories SET ?";
  db.query(sql, data, (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: result.insertId, ...data });
  });
});

// Get All Categories
router.get("/categories", (req, res) => {
  db.query("SELECT * FROM categories", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Update Category
router.put("/categories/:id", (req, res) => {
  const data = req.body;
  db.query("UPDATE categories SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: req.params.id, ...data });
  });
});

// Delete Category
router.delete("/categories/:id", (req, res) => {
  db.query("DELETE FROM categories WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ message: "Category deleted successfully." });
  });
});

// ---------- COMPANY CRUD ----------

// Create Company
router.post("/companies", (req, res) => {
  const data = req.body;
  const sql = "INSERT INTO companies SET ?";
  db.query(sql, data, (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: result.insertId, ...data });
  });
});

// Get All Companies
router.get("/companies", (req, res) => {
  db.query("SELECT * FROM companies", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Update Company
router.put("/companies/:id", (req, res) => {
  const data = req.body;
  db.query("UPDATE companies SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: req.params.id, ...data });
  });
});

// Delete Company
router.delete("/companies/:id", (req, res) => {
  db.query("DELETE FROM companies WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ message: "Company deleted successfully." });
  });
});

module.exports = router;