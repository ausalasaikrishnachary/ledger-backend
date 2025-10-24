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
  const getProductQuery = "SELECT stock_in, stock_out, balance_stock, opening_stock FROM products WHERE id = ?";
  db.query(getProductQuery, [productId], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0) return res.status(404).send({ message: "Product not found" });

    const current = result[0];
    
    // Use current balance_stock as opening_stock for the new entry
    const openingStockForNewEntry = parseFloat(current.balance_stock || 0);
    
    // These are for updating the product totals
    const totalStockIn = parseFloat(current.stock_in || 0) + stockIn;
    const totalStockOut = parseFloat(current.stock_out || 0) + stockOut;
    const newBalance = openingStockForNewEntry + stockIn - stockOut;

    console.log('Stock Calculation:', {
      productId,
      currentBalance: current.balance_stock,
      openingStockForNewEntry,
      stockIn,
      stockOut,
      newBalance,
      totalStockIn,
      totalStockOut
    });

    // Step 2: Insert new stock entry with current balance as opening stock
    // FIXED: Include batch_number and voucher_id in stock table
    const stockEntry = {
      product_id: productId,
      price_per_unit: data.price_per_unit,
      opening_stock: openingStockForNewEntry,
      stock_in: stockIn.toString(),
      stock_out: stockOut.toString(),
      balance_stock: newBalance.toString(),
      batch_number: data.batch_number || null, // Store batch number
      voucher_id: data.voucher_id || null, // Store voucher ID
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
          opening_stock_used: openingStockForNewEntry,
          stock_in_added: stockIn,
          stock_out_added: stockOut,
          new_balance_stock: newBalance,
          updated_stock_in: totalStockIn,
          updated_stock_out: totalStockOut,
          batch_number: data.batch_number,
          voucher_id: data.voucher_id
        });
      });
    });
  });
});

// Get Stock History for a Product with batch and voucher details
router.get("/stock/:productId", (req, res) => {
  const productId = req.params.productId;
  
  const query = `
    SELECT s.*, p.goods_name, p.product_code, v.VchNo as invoice_number, v.TransactionType
    FROM stock s 
    JOIN products p ON s.product_id = p.id 
    LEFT JOIN Voucher v ON s.voucher_id = v.VoucherID
    WHERE s.product_id = ? 
    ORDER BY s.date DESC, s.id DESC
  `;
  
  db.query(query, [productId], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Get All Stock Entries with product and voucher details
router.get("/stock", (req, res) => {
  const query = `
    SELECT s.*, p.goods_name, p.product_code, v.VchNo as invoice_number, v.TransactionType
    FROM stock s 
    JOIN products p ON s.product_id = p.id 
    LEFT JOIN Voucher v ON s.voucher_id = v.VoucherID
    ORDER BY s.date DESC, s.id DESC
  `;
  
  db.query(query, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Get Current Stock Balance for a Product
router.get("/stock/balance/:productId", (req, res) => {
  const productId = req.params.productId;
  
  const query = "SELECT balance_stock, stock_in, stock_out FROM products WHERE id = ?";
  
  db.query(query, [productId], (err, results) => {
    if (err) return res.status(500).send(err);
    if (results.length === 0) return res.status(404).send({ message: "Product not found" });
    
    res.send(results[0]);
  });
});

// Update Stock Entry
router.put("/stock/:stockId", (req, res) => {
  const stockId = req.params.stockId;
  const data = req.body;
  
  // First get the original stock entry to calculate differences
  const getStockQuery = "SELECT * FROM stock WHERE id = ?";
  db.query(getStockQuery, [stockId], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0) return res.status(404).send({ message: "Stock entry not found" });
    
    const originalEntry = result[0];
    const productId = originalEntry.product_id;
    
    const newStockIn = parseFloat(data.stock_in || 0);
    const newStockOut = parseFloat(data.stock_out || 0);
    const oldStockIn = parseFloat(originalEntry.stock_in || 0);
    const oldStockOut = parseFloat(originalEntry.stock_out || 0);
    
    const stockInDiff = newStockIn - oldStockIn;
    const stockOutDiff = newStockOut - oldStockOut;
    
    // Recalculate balance for this entry
    const newBalance = parseFloat(originalEntry.opening_stock) + newStockIn - newStockOut;
    
    // Update the stock entry
    const updateStockQuery = `
      UPDATE stock SET 
        price_per_unit = ?,
        stock_in = ?,
        stock_out = ?,
        balance_stock = ?,
        batch_number = ?,
        voucher_id = ?,
        date = ?
      WHERE id = ?
    `;
    
    db.query(updateStockQuery, [
      data.price_per_unit,
      newStockIn,
      newStockOut,
      newBalance,
      data.batch_number || null,
      data.voucher_id || null,
      data.date,
      stockId
    ], (err2) => {
      if (err2) return res.status(500).send(err2);
      
      // Update product totals
      const getProductQuery = "SELECT stock_in, stock_out, balance_stock FROM products WHERE id = ?";
      db.query(getProductQuery, [productId], (err3, result3) => {
        if (err3) return res.status(500).send(err3);
        
        const currentProduct = result3[0];
        const updatedStockIn = parseFloat(currentProduct.stock_in) + stockInDiff;
        const updatedStockOut = parseFloat(currentProduct.stock_out) + stockOutDiff;
        const updatedBalance = parseFloat(currentProduct.balance_stock) + stockInDiff - stockOutDiff;
        
        const updateProductQuery = `
          UPDATE products SET 
            stock_in = ?,
            stock_out = ?,
            balance_stock = ?
          WHERE id = ?
        `;
        
        db.query(updateProductQuery, [updatedStockIn, updatedStockOut, updatedBalance, productId], (err4) => {
          if (err4) return res.status(500).send(err4);
          
          res.send({
            message: "Stock entry updated successfully",
            updated_balance: updatedBalance,
            stock_in_diff: stockInDiff,
            stock_out_diff: stockOutDiff
          });
        });
      });
    });
  });
});

// Delete Stock Entry
router.delete("/stock/:stockId", (req, res) => {
  const stockId = req.params.stockId;
  
  // First get the stock entry to adjust product totals
  const getStockQuery = "SELECT * FROM stock WHERE id = ?";
  db.query(getStockQuery, [stockId], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0) return res.status(404).send({ message: "Stock entry not found" });
    
    const stockEntry = result[0];
    const productId = stockEntry.product_id;
    const stockIn = parseFloat(stockEntry.stock_in || 0);
    const stockOut = parseFloat(stockEntry.stock_out || 0);
    
    // Delete the stock entry
    const deleteStockQuery = "DELETE FROM stock WHERE id = ?";
    db.query(deleteStockQuery, [stockId], (err2) => {
      if (err2) return res.status(500).send(err2);
      
      // Update product totals by subtracting the deleted values
      const getProductQuery = "SELECT stock_in, stock_out, balance_stock FROM products WHERE id = ?";
      db.query(getProductQuery, [productId], (err3, result3) => {
        if (err3) return res.status(500).send(err3);
        
        const currentProduct = result3[0];
        const updatedStockIn = parseFloat(currentProduct.stock_in) - stockIn;
        const updatedStockOut = parseFloat(currentProduct.stock_out) - stockOut;
        const updatedBalance = parseFloat(currentProduct.balance_stock) - stockIn + stockOut;
        
        const updateProductQuery = `
          UPDATE products SET 
            stock_in = ?,
            stock_out = ?,
            balance_stock = ?
          WHERE id = ?
        `;
        
        db.query(updateProductQuery, [updatedStockIn, updatedStockOut, updatedBalance, productId], (err4) => {
          if (err4) return res.status(500).send(err4);
          
          res.send({
            message: "Stock entry deleted successfully",
            updated_balance: updatedBalance,
            stock_in_removed: stockIn,
            stock_out_removed: stockOut
          });
        });
      });
    });
  });
});

module.exports = router;