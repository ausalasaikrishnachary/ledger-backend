const express = require("express");
const router = express.Router();
const db = require("./../../db");

// Insert Stock Entry with Product Balance Update
router.post("/stock/:productId", (req, res) => {
  const data = req.body;
  const productId = req.params.productId;
  const date = data.date;

  const stockIn = parseFloat(data.stock_in || 0);
  const stockOut = parseFloat(data.stock_out || 0);

  // Step 1: Get current product details
  const getProductQuery = "SELECT stock_in, stock_out, balance_stock FROM products WHERE id = ?";
  db.query(getProductQuery, [productId], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0) return res.status(404).send({ message: "Product not found" });

    const current = result[0];
    const openingStock = parseFloat(current.balance_stock || 0);
    const totalStockIn = parseFloat(current.stock_in || 0) + stockIn;
    const totalStockOut = parseFloat(current.stock_out || 0) + stockOut;
    const newBalance = openingStock + stockIn - stockOut;

    // Step 2: Insert new stock entry
    const stockEntry = {
      product_id: productId,
      price_per_unit: data.price_per_unit,
      opening_stock: null,
      stock_in: stockIn.toString(),
      stock_out: stockOut.toString(),
      balance_stock: newBalance.toString(),
      date: date
    };

    const insertStockQuery = "INSERT INTO stock SET ?";
    db.query(insertStockQuery, stockEntry, (err2, result2) => {
      if (err2) return res.status(500).send(err2);

      // Step 3: Update product stock_in, stock_out, balance_stock
      const updateProductQuery = `
        UPDATE products SET 
          stock_in = ?, 
          stock_out = ?, 
          balance_stock = ? 
        WHERE id = ?
      `;
      db.query(updateProductQuery, [totalStockIn, totalStockOut, newBalance, productId], (err3) => {
        if (err3) return res.status(500).send(err3);

        res.send({
          message: "Stock inserted and product totals updated successfully.",
          stock_id: result2.insertId,
          product_id: productId,
          updated_stock_in: totalStockIn,
          updated_stock_out: totalStockOut,
          updated_balance_stock: newBalance
        });
      });
    });
  });
});



module.exports = router;
