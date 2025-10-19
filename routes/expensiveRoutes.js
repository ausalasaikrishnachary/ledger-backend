const express = require("express");
const db = require("../db.js"); // Your MySQL connection
const router = express.Router();

/// POST - Add new expense
router.post("/expensive", (req, res) => {
  const { staff_id, staff_name, category_id, category, amount, date, note, status } = req.body;

  const sql = `
    INSERT INTO expensive 
      (staff_id, staff_name, category_id, category, amount, date, note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [staff_id, staff_name, category_id, category, amount, date, note, status],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send({
        id: result.insertId,
        staff_id,
        staff_name,
        category_id,
        category,
        amount,
        date,
        note,
        status,
      });
    }
  );
});


// GET all expenses
router.get("/expensive", (req, res) => {
  db.query("SELECT * FROM expensive ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// GET single expense
router.get("/expensive/:id", (req, res) => {
  db.query("SELECT * FROM expensive WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send(result[0]);
  });
});

// PUT - Update expense
router.put("/expensive/:id", (req, res) => {
  const data = req.body;
  db.query("UPDATE expensive SET ? WHERE id = ?", [data, req.params.id], (err) => {
    if (err) return res.status(500).send(err);
    res.send({ id: req.params.id, ...data });
  });
});

// DELETE - Delete expense
router.delete("/expensive/:id", (req, res) => {
  db.query("DELETE FROM expensive WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err);
    res.send({ message: "Deleted successfully." });
  });
});

module.exports = router;
