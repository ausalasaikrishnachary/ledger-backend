const express = require('express');
const router = express.Router();
const db = require('./../../db');

// Create Product
router.post("/products", (req, res) => {
  const data = req.body;

  // Set balance_stock equal to opening_stock
  data.balance_stock = data.opening_stock;

  const productSql = "INSERT INTO products SET ?";

  db.query(productSql, data, (err, result) => {
    if (err) return res.status(500).send(err);

    const productId = result.insertId;

    // Prepare stock record
    const stockData = {
      product_id: productId,
      price_per_unit: data.price,
      opening_stock: data.opening_stock,
      stock_in: data.stock_in || "0",
      stock_out: data.stock_out || "0",
      balance_stock: data.opening_stock,
      date: new Date() // use current timestamp
    };

    const stockSql = "INSERT INTO stock SET ?";

    db.query(stockSql, stockData, (stockErr, stockResult) => {
      if (stockErr) return res.status(500).send(stockErr);
      res.send({ product_id: productId, stock_id: stockResult.insertId, ...data });
    });
  });
});

// Get All Products
router.get("/products", (req, res) => {
  db.query("SELECT * FROM products", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Get Single Product
router.get("/products/:id", (req, res) => {
  db.query("SELECT * FROM products WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results[0]);
  });
});

// Update Product
router.put("/products/:id", (req, res) => {
  const data = req.body;
  db.query("UPDATE products SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({ id: req.params.id, ...data });
  });
});

// Delete Product
router.delete("/products/:id", (req, res) => {
  const productId = req.params.id;

  // 1️⃣ Delete dependent rows in stock table
  db.query("DELETE FROM stock WHERE product_id = ?", [productId], (err, stockResult) => {
    if (err) {
      console.error("Error deleting stock rows:", err);
      return res.status(500).send({ message: "Failed to delete related stock", error: err });
    }

    // 2️⃣ Delete the product itself
    db.query("DELETE FROM products WHERE id = ?", [productId], (err, productResult) => {
      if (err) {
        console.error("Error deleting product:", err);
        return res.status(500).send({ message: "Failed to delete product", error: err });
      }

      res.send({ message: "Product deleted successfully!" });
    });
  });
});

module.exports = router;
