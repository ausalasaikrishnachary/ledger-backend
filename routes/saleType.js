const express = require("express");
const router = express.Router();
const db = require("../db"); // Adjust path according to your project structure

// ================= CREATE SALE TYPE =================
router.post("/saletypes", (req, res) => {
  const { sale_type, series } = req.body;

  if (!sale_type || !series) {
    return res.status(400).json({
      success: false,
      message: "Sale Type and Series are required",
    });
  }

  const sql = `
    INSERT INTO saletypes (sale_type, series)
    VALUES (?, ?)
  `;

  db.query(sql, [sale_type, series], (err, result) => {
    if (err) {
      console.error("Error creating sale type:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.status(201).json({
      success: true,
      message: "Sale Type created successfully",
      id: result.insertId,
    });
  });
});

// ================= GET ALL SALE TYPES =================
router.get("/saletypes", (req, res) => {
  const sql = `
    SELECT * FROM saletypes
    ORDER BY id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching sale types:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      success: true,
      data: results,
    });
  });
});

// ================= GET SINGLE SALE TYPE =================
router.get("/saletypes/:id", (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT * FROM saletypes
    WHERE id = ?
  `;

  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error("Error fetching sale type:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Sale Type not found",
      });
    }

    res.json({
      success: true,
      data: results[0],
    });
  });
});

// ================= UPDATE SALE TYPE =================
router.put("/saletypes/:id", (req, res) => {
  const { id } = req.params;
  const { sale_type, series } = req.body;

  if (!sale_type || !series) {
    return res.status(400).json({
      success: false,
      message: "Sale Type and Series are required",
    });
  }

  const sql = `
    UPDATE saletypes
    SET sale_type = ?, series = ?
    WHERE id = ?
  `;

  db.query(sql, [sale_type, series, id], (err, result) => {
    if (err) {
      console.error("Error updating sale type:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Sale Type not found",
      });
    }

    res.json({
      success: true,
      message: "Sale Type updated successfully",
    });
  });
});

// ================= DELETE SALE TYPE =================
router.delete("/saletypes/:id", (req, res) => {
  const { id } = req.params;

  const sql = `
    DELETE FROM saletypes
    WHERE id = ?
  `;

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting sale type:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Sale Type not found",
      });
    }

    res.json({
      success: true,
      message: "Sale Type deleted successfully",
    });
  });
});

module.exports = router;