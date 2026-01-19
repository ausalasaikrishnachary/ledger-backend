const express = require("express");
const router = express.Router();
const db = require('./../../db');

// ============================
// Add to Cart
router.post("/add-to-cart", (req, res) => {
  const {
    customer_id,
    product_id,
    staff_id,
    quantity,
    credit_period,
    credit_percentage
  } = req.body;

  console.log("Add to cart request body:", req.body);

  if (!customer_id || !product_id) {
    return res.status(400).json({
      success: false,
      error: "customer_id & product_id are required"
    });
  }

  // ✅ Correct column name: id
  const priceSql = `SELECT price FROM products WHERE id = ?`;

  db.query(priceSql, [product_id], (err, productResult) => {
    if (err) {
      console.error("Price fetch error:", err);
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }

    if (productResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Product not found"
      });
    }

    // 🔥 Convert VARCHAR price → NUMBER safely
    let rawPrice = productResult[0].price;

    if (!rawPrice) {
      return res.status(400).json({
        success: false,
        error: "Product price is not set"
      });
    }

    // Remove commas & convert to number
    const price = parseFloat(String(rawPrice).replace(/,/g, ""));

    if (isNaN(price)) {
      return res.status(400).json({
        success: false,
        error: "Invalid product price format"
      });
    }

    const insertSql = `
      INSERT INTO cart_items
      (customer_id, product_id, price, staff_id, quantity, credit_period, credit_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      customer_id,
      product_id,
      price,
      staff_id || null,
      quantity || 1,
      credit_period || 0,
      credit_percentage || 0
    ];

    console.log("Insert values:", values);

    db.query(insertSql, values, (err, result) => {
      if (err) {
        console.error("Insert error:", err);
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
    });
  });
});

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


// In your backend cart routes file
// ============================
// Get Cart Items for Customer with Product Details
// ============================
// GET CART WITH FULL PRODUCT DETAILS (Name, Price, Unit, GST)
// This is CORRECT — keep this one
router.get("/customer-cart/:customer_id", (req, res) => {
  const { customer_id } = req.params;

  const sql = `
    SELECT 
      ci.id,
      ci.customer_id,
      ci.product_id,
      ci.quantity,
      ci.credit_period,
      ci.credit_percentage,
      ci.staff_id,
      ci.created_at,
      p.name AS product_name,
      p.price AS product_price,
      p.unit AS product_unit,
      p.gst_rate AS product_gst,
      p.balance_stock,
      p.category,
      p.supplier
      -- Add more fields if needed: image, hsn_code, etc.
    FROM cart_items ci
    LEFT JOIN products p ON ci.product_id = p.id
    WHERE ci.customer_id = ?
    ORDER BY ci.created_at DESC
  `;

  db.query(sql, [customer_id], (err, rows) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json(rows);
  });
});


router.put("/update-cart-price/:id", (req, res) => {
  const { id } = req.params;
  const { price } = req.body;

  if (price === undefined) {
    return res.status(400).json({ error: "Price is required" });
  }

  const sql = "UPDATE cart_items SET price = ? WHERE id = ?";
  db.query(sql, [price, id], (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Price updated" });
  });
});

module.exports = router;
