const express = require('express');
const router = express.Router();
const db = require('./../../db'); // Ensure this is using mysql.createConnection() or createPool()

// ---------- CATEGORY CRUD ----------

// Create Category
router.post("/categories", (req, res) => {
  const data = req.body;
  const sql = "INSERT INTO categories SET ?";
  db.query(sql, data, (err, result) => {
    if (err) {
      console.error("Error creating category:", err);
      return res.status(500).send(err);
    }
    res.send({ id: result.insertId, ...data });
  });
});

// Get All Categories
router.get("/categories", (req, res) => {
  const sql = "SELECT * FROM categories";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching categories:", err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Update Category
router.put("/categories/:id", (req, res) => {
  const data = req.body;
  const id = req.params.id;
  const sql = "UPDATE categories SET ? WHERE id = ?";
  db.query(sql, [data, id], (err, result) => {
    if (err) {
      console.error("Error updating category:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Category not found" });
    }
    res.send({ id, ...data });
  });
});

// Delete Category
router.delete("/categories/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM categories WHERE id = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting category:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Category not found" });
    }
    res.send({ message: "Category deleted successfully." });
  });
});


// ---------- COMPANY CRUD ----------

// Create Company
router.post("/companies", (req, res) => {
  const data = req.body;
  const sql = "INSERT INTO companies SET ?";
  db.query(sql, data, (err, result) => {
    if (err) {
      console.error("Error creating company:", err);
      return res.status(500).send(err);
    }
    res.send({ id: result.insertId, ...data });
  });
});

// Get All Companies
router.get("/companies", (req, res) => {
  const sql = "SELECT * FROM companies";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching companies:", err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Update Company
router.put("/companies/:id", (req, res) => {
  const data = req.body;
  const id = req.params.id;
  const sql = "UPDATE companies SET ? WHERE id = ?";
  db.query(sql, [data, id], (err, result) => {
    if (err) {
      console.error("Error updating company:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Company not found" });
    }
    res.send({ id, ...data });
  });
});

// Delete Company
router.delete("/companies/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM companies WHERE id = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting company:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Company not found" });
    }
    res.send({ message: "Company deleted successfully." });
  });
});

module.exports = router;
