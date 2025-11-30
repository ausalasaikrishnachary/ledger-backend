const express = require("express");
const router = express.Router();
const db = require('./../../db');

// ============================
// Add to Cart
// ============================
// Add to Cart
router.post("/add-to-cart", (req, res) => {
  const { customer_id, product_id, quantity, credit_period, credit_percentage } = req.body;

  if (!customer_id || !product_id) {
    return res.status(400).json({ 
      success: false,
      error: "customer_id & product_id are required" 
    });
  }

  const sql = `
    INSERT INTO cart_items (customer_id, product_id, quantity, credit_period, credit_percentage)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [customer_id, product_id, quantity || 1, credit_period || 0, credit_percentage || 0],
    (err, result) => {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: err.message 
        });
      }
      
      res.json({ 
        success: true,
        message: "Item added to cart", 
        item_id: result.insertId 
      });
    }
  );
})

// ============================
// Remove From Cart
// ============================
router.delete("/remove-cart-item/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM cart_items WHERE id = ?";
  db.query(sql, [id], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ message: "Item removed from cart" });
  });
});

// ============================
// Update Quantity
// ============================
router.put("/update-cart-quantity/:id", (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  if (quantity === undefined) {
    return res.status(400).json({ error: "Quantity is required" });
  }

  const sql = "UPDATE cart_items SET quantity = ? WHERE id = ?";
  db.query(sql, [quantity, id], (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Quantity updated" });
  });
});

// ============================
// Update Credit Period + Percentage
// ============================
router.put("/update-cart-credit/:id", (req, res) => {
  const { id } = req.params;
  const { credit_period, credit_percentage } = req.body;

  const sql = `
    UPDATE cart_items 
    SET credit_period = ?, credit_percentage = ?
    WHERE id = ?
  `;

  db.query(sql, [credit_period, credit_percentage, id], (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Credit details updated" });
  });
});

// ============================
// Get Cart Items for Customer
// ============================
// Get Cart Items for Customer
router.get("/customer-cart/:customer_id", (req, res) => {
  const { customer_id } = req.params;

  const sql = "SELECT * FROM cart_items WHERE customer_id = ?";
  db.query(sql, [customer_id], (err, rows) => {
    if (err) {
      return res.status(500).json({ 
        success: false,
        error: err.message 
      });
    }
    
    res.json(rows);
  });
});

module.exports = router;
