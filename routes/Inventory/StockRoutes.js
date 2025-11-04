const express = require("express");
const router = express.Router();
const db = require("./../../db");

// Insert Stock Entry with Proper Product Balance Update
router.post("/stock/:productId", (req, res) => {
  const data = req.body;
  const productId = req.params.productId;
  const date = data.date;

  const stockIn = parseFloat(data.stock_in || 0);
  const stockOut = parseFloat(data.stock_out || 0);

  console.log('📦 Stock Entry Request:', {
    productId,
    stockIn,
    stockOut,
    batch_number: data.batch_number,
    voucher_id: data.voucher_id
  });

  // Step 1: Get the latest stock entry to get the previous balance
  const getLatestStockQuery = `
    SELECT balance_stock 
    FROM stock 
    WHERE product_id = ? 
    ORDER BY date DESC, id DESC 
    LIMIT 1
  `;
  
  db.query(getLatestStockQuery, [productId], (err, latestResult) => {
    if (err) {
      console.error('❌ Error fetching latest stock:', err);
      return res.status(500).send(err);
    }

    // Calculate opening stock (previous balance)
    let openingStock = 0;
    if (latestResult.length > 0) {
      openingStock = parseFloat(latestResult[0].balance_stock || 0);
    } else {
      // If no previous entries, get from product opening stock
      const getProductQuery = "SELECT opening_stock FROM products WHERE id = ?";
      db.query(getProductQuery, [productId], (err, productResult) => {
        if (err) {
          console.error('❌ Error fetching product:', err);
          return res.status(500).send(err);
        }
        if (productResult.length > 0) {
          openingStock = parseFloat(productResult[0].opening_stock || 0);
        }
      });
    }

    // Calculate new balance
    const newBalance = openingStock + stockIn - stockOut;

    console.log('🧮 Stock Calculation:', {
      openingStock,
      stockIn,
      stockOut,
      newBalance
    });

    // Step 2: Insert new stock entry
    const stockEntry = {
      product_id: productId,
      price_per_unit: data.price_per_unit || 0,
      opening_stock: openingStock,
      stock_in: stockIn,
      stock_out: stockOut,
      balance_stock: newBalance,
      batch_number: data.batch_number || null,
      voucher_id: data.voucher_id || null,
      date: date
    };

    const insertStockQuery = "INSERT INTO stock SET ?";
    db.query(insertStockQuery, stockEntry, (err2, result2) => {
      if (err2) {
        console.error('❌ Error inserting stock:', err2);
        return res.status(500).send(err2);
      }

      // Step 3: Update product totals by recalculating from all stock entries
      const recalculateProductQuery = `
        UPDATE products 
        SET 
          stock_in = (SELECT COALESCE(SUM(stock_in), 0) FROM stock WHERE product_id = ?),
          stock_out = (SELECT COALESCE(SUM(stock_out), 0) FROM stock WHERE product_id = ?),
          balance_stock = ?,
          updated_at = NOW()
        WHERE id = ?
      `;
      
      db.query(recalculateProductQuery, [productId, productId, newBalance, productId], (err3) => {
        if (err3) {
          console.error('❌ Error updating product:', err3);
          return res.status(500).send(err3);
        }

        console.log('✅ Stock entry created and product updated successfully');
        res.send({
          message: "Stock inserted and product totals updated successfully.",
          stock_id: result2.insertId,
          product_id: productId,
          opening_stock_used: openingStock,
          stock_in_added: stockIn,
          stock_out_added: stockOut,
          new_balance_stock: newBalance
        });
      });
    });
  });
});

// Get Stock History for a Product
router.get("/stock/:productId", (req, res) => {
  const productId = req.params.productId;
  
  const query = `
    SELECT 
      s.*, 
      p.goods_name, 
      p.product_code, 
      v.VchNo as invoice_number, 
      v.TransactionType,
      b.batch_number
    FROM stock s 
    JOIN products p ON s.product_id = p.id 
    LEFT JOIN voucher v ON s.voucher_id = v.VoucherID
    LEFT JOIN batches b ON s.batch_number = b.batch_number AND s.product_id = b.product_id
    WHERE s.product_id = ? 
    ORDER BY s.date DESC, s.id DESC
  `;
  
  db.query(query, [productId], (err, results) => {
    if (err) {
      console.error('❌ Error fetching stock history:', err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Get All Stock Entries
router.get("/stock", (req, res) => {
  const query = `
    SELECT 
      s.*, 
      p.goods_name, 
      p.product_code, 
      v.VchNo as invoice_number, 
      v.TransactionType,
      b.batch_number
    FROM stock s 
    JOIN products p ON s.product_id = p.id 
    LEFT JOIN voucher v ON s.voucher_id = v.VoucherID
    LEFT JOIN batches b ON s.batch_number = b.batch_number AND s.product_id = b.product_id
    ORDER BY s.date DESC, s.id DESC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('❌ Error fetching all stock:', err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Get Current Stock Balance for a Product
router.get("/stock/balance/:productId", (req, res) => {
  const productId = req.params.productId;
  
  const query = `
    SELECT 
      id,
      goods_name,
      COALESCE(stock_in, 0) as stock_in,
      COALESCE(stock_out, 0) as stock_out,
      COALESCE(balance_stock, 0) as balance_stock,
      COALESCE(opening_stock, 0) as opening_stock,
      maintain_batch
    FROM products WHERE id = ?`;
  
  db.query(query, [productId], (err, results) => {
    if (err) {
      console.error('❌ Error fetching stock balance:', err);
      return res.status(500).send(err);
    }
    if (results.length === 0) return res.status(404).send({ message: "Product not found" });
    
    res.send(results[0]);
  });
});

// Fix product stock calculations
router.post('/products/fix-stock-calculation/:productId', async (req, res) => {
  const productId = req.params.productId;
  
  try {
    // Get product details
    const [product] = await db.promise().query('SELECT * FROM products WHERE id = ?', [productId]);
    
    if (product.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    const productData = product[0];
    
    let newOpeningStock = parseFloat(productData.opening_stock || 0);
    let newStockIn = 0;
    let newStockOut = parseFloat(productData.stock_out || 0);
    let newBalanceStock = 0;

    // If product maintains batches, calculate from batches
    if (productData.maintain_batch === 1) {
      const [batches] = await db.promise().query(
        'SELECT SUM(quantity) as total FROM batches WHERE product_id = ?',
        [productId]
      );
      
      const totalBatchStock = parseFloat(batches[0].total || 0);
      newOpeningStock = totalBatchStock;
      newBalanceStock = newOpeningStock - newStockOut;
    } else {
      // For non-batch products
      newBalanceStock = newOpeningStock + newStockIn - newStockOut;
    }
    
    // Update product with corrected values
    await db.promise().query(
      `UPDATE products SET 
        opening_stock = ?,
        stock_in = ?,
        stock_out = ?,
        balance_stock = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [newOpeningStock, newStockIn, newStockOut, newBalanceStock, productId]
    );
    
    console.log('✅ Fixed stock calculation for product:', {
      productId,
      opening_stock: newOpeningStock,
      stock_in: newStockIn,
      stock_out: newStockOut,
      balance_stock: newBalanceStock
    });
    
    res.json({
      success: true,
      message: 'Stock calculation fixed successfully',
      productId,
      opening_stock: newOpeningStock,
      stock_in: newStockIn,
      stock_out: newStockOut,
      balance_stock: newBalanceStock
    });
    
  } catch (error) {
    console.error('❌ Error fixing stock calculation:', error);
    res.status(500).json({ success: false, message: 'Failed to fix stock calculation', error: error.message });
  }
});

// Fix stock values for all products
router.post('/stock/fix-all-products', async (req, res) => {
  try {
    // Get all products
    const [products] = await db.promise().query('SELECT id, maintain_batch FROM products');
    
    let fixedCount = 0;
    
    for (const product of products) {
      let openingStock = 0;
      let stockIn = 0;
      let stockOut = 0;
      let balanceStock = 0;
      
      if (product.maintain_batch === 1) {
        // For batch-managed products, calculate from batches
        const [batches] = await db.promise().query(
          'SELECT SUM(quantity) as total FROM batches WHERE product_id = ?',
          [product.id]
        );
        
        openingStock = parseFloat(batches[0].total || 0);
        
        // Get current stock out from sales
        const [salesData] = await db.promise().query(
          'SELECT SUM(stock_out) as total_out FROM stock WHERE product_id = ?',
          [product.id]
        );
        
        stockOut = parseFloat(salesData[0].total_out || 0);
        stockIn = 0;
        balanceStock = openingStock + stockIn - stockOut;
      } else {
        // For non-batch products, keep existing logic
        const [currentProduct] = await db.promise().query(
          'SELECT opening_stock, stock_in, stock_out, balance_stock FROM products WHERE id = ?',
          [product.id]
        );
        
        if (currentProduct.length > 0) {
          openingStock = parseFloat(currentProduct[0].opening_stock || 0);
          stockIn = parseFloat(currentProduct[0].stock_in || 0);
          stockOut = parseFloat(currentProduct[0].stock_out || 0);
          balanceStock = openingStock + stockIn - stockOut;
        }
      }
      
      // Update product with corrected values
      await db.promise().query(
        `UPDATE products SET 
          opening_stock = ?,
          stock_in = ?,
          stock_out = ?,
          balance_stock = ?,
          updated_at = NOW()
         WHERE id = ?`,
        [openingStock, stockIn, stockOut, balanceStock, product.id]
      );
      
      fixedCount++;
    }
    
    res.json({
      success: true,
      message: `Stock values fixed for ${fixedCount} products`,
      fixed_count: fixedCount
    });
    
  } catch (error) {
    console.error('❌ Error fixing all products stock:', error);
    res.status(500).json({ success: false, message: 'Failed to fix stock', error: error.message });
  }
});

module.exports = router;