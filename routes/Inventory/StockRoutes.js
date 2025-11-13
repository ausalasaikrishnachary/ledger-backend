const express = require("express");
const router = express.Router();
const db = require("./../../db");


// Add Stock
router.post('/stock/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, remark, batchId, batch_number } = req.body;

    console.log('Received request:', { productId, quantity, remark, batchId, batch_number });

    // Handle the case where quantity might be an object
    let actualQuantity;
    if (typeof quantity === 'object' && quantity !== null) {
      actualQuantity = parseInt(quantity.quantity) || 0;
      console.log('Quantity is object, extracted value:', actualQuantity);
    } else {
      actualQuantity = parseInt(quantity) || 0;
    }

    // Validate required fields
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    const quantityToAdd = actualQuantity;
    
    if (quantityToAdd <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

    let batch;
    
    // If batchId is provided, use it to find the batch
    if (batchId) {
      const getBatchByIdQuery = 'SELECT * FROM batches WHERE id = ? AND product_id = ?';
      const [existingBatch] = await db.promise().query(getBatchByIdQuery, [batchId, productId]);
      
      if (!existingBatch || existingBatch.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No batch found with ID: ${batchId} for this product`
        });
      }
      batch = existingBatch[0];
    } 
    // If batch_number is provided, use it to find the batch
    else if (batch_number) {
      const getBatchByNumberQuery = 'SELECT * FROM batches WHERE product_id = ? AND batch_number = ?';
      const [existingBatch] = await db.promise().query(getBatchByNumberQuery, [productId, batch_number]);
      
      if (!existingBatch || existingBatch.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No batch found with batch number: ${batch_number} for this product`
        });
      }
      batch = existingBatch[0];
    } 
    // If no batch identifier provided, return error
    else {
      return res.status(400).json({
        success: false,
        message: 'Either batchId or batch_number is required'
      });
    }

    // Calculate new quantities
    const currentQuantity = parseInt(batch.quantity) || 0;
    const currentStockIn = parseInt(batch.stock_in) || 0;
    const currentOpeningStock = parseInt(batch.opening_stock) || 0;
    
    const newQuantity = currentQuantity + quantityToAdd;
    const newStockIn = currentStockIn + quantityToAdd;
    const newOpeningStock = currentOpeningStock + quantityToAdd;

    console.log('Updating batch:', {
      batchId: batch.id,
      batchNumber: batch.batch_number,
      existingQuantity: currentQuantity,
      quantityToAdd: quantityToAdd,
      newQuantity: newQuantity,
      existingStockIn: currentStockIn,
      newStockIn: newStockIn,
      existingOpeningStock: currentOpeningStock,
      newOpeningStock: newOpeningStock
    });

    // Update the batch record - including opening_stock
    const updateQuery = `
      UPDATE batches 
      SET 
        quantity = ?,
       
        opening_stock = ?,
        updated_at = ?,
        remark = ?
      WHERE id = ? AND product_id = ?
    `;

    const [result] = await db.promise().query(updateQuery, [
      newQuantity, 
     
      newOpeningStock,
      currentTimestamp, 
      remark || batch.remark,
      batch.id, 
      productId
    ]);

    if (result.affectedRows > 0) {
      res.status(200).json({
        success: true,
        message: 'Stock added successfully',
        data: {
          id: batch.id,
          batch_number: batch.batch_number,
          old_quantity: currentQuantity,
          new_quantity: newQuantity,
          quantity_added: quantityToAdd,
          old_stock_in: currentStockIn,
          new_stock_in: newStockIn,
          old_opening_stock: currentOpeningStock,
          new_opening_stock: newOpeningStock,
          remark: remark || batch.remark
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to add stock - no rows affected'
      });
    }

  } catch (error) {
    console.error('Error adding stock:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Deduct Quantity
router.post('/stock-deducted/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, batchId, batch_number, remark } = req.body;

    // Convert quantity to integer
    let actualQuantity = parseInt(quantity) || 0;
    if (actualQuantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });
    }

    let batch;

    // Find batch by ID or batch_number
    if (batchId) {
      const [existingBatch] = await db.promise().query(
        'SELECT * FROM batches WHERE id = ? AND product_id = ?',
        [batchId, productId]
      );
      if (!existingBatch || existingBatch.length === 0) {
        return res.status(404).json({ success: false, message: `No batch found with ID: ${batchId}` });
      }
      batch = existingBatch[0];
    } else if (batch_number) {
      const [existingBatch] = await db.promise().query(
        'SELECT * FROM batches WHERE product_id = ? AND batch_number = ?',
        [productId, batch_number]
      );
      if (!existingBatch || existingBatch.length === 0) {
        return res.status(404).json({ success: false, message: `No batch found with batch number: ${batch_number}` });
      }
      batch = existingBatch[0];
    } else {
      return res.status(400).json({ success: false, message: 'Either batchId or batch_number is required' });
    }

    // Get current values
    const currentQuantity = parseInt(batch.quantity) || 0;
    const currentOpeningStock = parseInt(batch.opening_stock) || 0;

    // Validate deduction
    if (actualQuantity > currentQuantity) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot deduct more than available quantity (${currentQuantity})` 
      });
    }

    // Calculate new values
    const newQuantity = currentQuantity - actualQuantity;
    const newOpeningStock = currentOpeningStock - actualQuantity;

    const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Update quantity, opening_stock and remark
    const updateQuery = `
      UPDATE batches
      SET quantity = ?, opening_stock = ?, updated_at = ?, remark = ?
      WHERE id = ? AND product_id = ?
    `;
    const [result] = await db.promise().query(updateQuery, [
      newQuantity,
      newOpeningStock,
      currentTimestamp,
      remark || batch.remark,
      batch.id,
      productId
    ]);

    if (result.affectedRows > 0) {
      res.status(200).json({
        success: true,
        message: 'Quantity deducted successfully',
        data: {
          id: batch.id,
          batch_number: batch.batch_number,
          old_quantity: currentQuantity,
          new_quantity: newQuantity,
          quantity_deducted: actualQuantity,
          old_opening_stock: currentOpeningStock,
          new_opening_stock: newOpeningStock,
          remark: remark || batch.remark,
        }
      });
    } else {
      res.status(500).json({ success: false, message: 'Failed to deduct quantity - no rows affected' });
    }

  } catch (error) {
    console.error('Error deducting quantity:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});


// Get batches by product_id
router.get('/batch/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    const query = `
      SELECT id, product_id, batch_number, quantity
      FROM batches 
      WHERE product_id = ? 
      ORDER BY created_at DESC, batch_number ASC
    `;

    const [batches] = await db.promise().query(query, [productId]);

    res.status(200).json({
      success: true,
      message: 'Batches fetched successfully',
      data: batches
    });

  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});






// Get Stock History for a Product - FIXED VERSION (Show individual batches properly)
router.get("/stock/:productId", async (req, res) => {
  const productId = req.params.productId;
  
  try {
    const query = `
      SELECT 
        s.*, 
        p.goods_name, 
        p.product_code, 
        v.VchNo as invoice_number, 
        v.TransactionType,
        b.batch_number,
        b.mfg_date,
        b.exp_date,
        b.quantity as current_batch_quantity
      FROM stock s 
      JOIN products p ON s.product_id = p.id 
      LEFT JOIN voucher v ON s.voucher_id = v.VoucherID
      LEFT JOIN batches b ON s.batch_number = b.batch_number AND s.product_id = b.product_id
      WHERE s.product_id = ? 
      ORDER BY s.date DESC, s.id DESC
    `;
    
    const [results] = await db.promise().query(query, [productId]);

    // Get current batch quantities for accurate opening stock calculation
    const [currentBatches] = await db.promise().query(
      'SELECT batch_number, quantity FROM batches WHERE product_id = ?',
      [productId]
    );

    const batchQuantities = {};
    currentBatches.forEach(batch => {
      batchQuantities[batch.batch_number] = parseFloat(batch.quantity) || 0;
    });

    // Process each stock entry to show accurate batch-wise opening stock
    const processedResults = results.map(record => {
      let calculatedOpeningStock = record.opening_stock;
      
      // If this is a batch-specific record, use the batch quantity as opening stock
      if (record.batch_number && batchQuantities[record.batch_number] !== undefined) {
        calculatedOpeningStock = batchQuantities[record.batch_number];
      }
      
      return {
        ...record,
        calculated_opening_stock: calculatedOpeningStock,
        current_batch_quantity: batchQuantities[record.batch_number] || 0
      };
    });

    // Group by batch number to show separate batches
    const batchStock = {};
    processedResults.forEach(record => {
      const batchKey = record.batch_number || 'NO_BATCH';
      if (!batchStock[batchKey]) {
        batchStock[batchKey] = {
          batch_number: record.batch_number,
          batch_details: record,
          stock_entries: [],
          total_stock_in: 0,
          total_stock_out: 0,
          current_balance: record.current_batch_quantity || 0
        };
      }
      batchStock[batchKey].stock_entries.push(record);
      batchStock[batchKey].total_stock_in += parseFloat(record.stock_in || 0);
      batchStock[batchKey].total_stock_out += parseFloat(record.stock_out || 0);
    });
    
    res.send({
      individual_entries: processedResults,
      batch_wise_summary: Object.values(batchStock)
    });
  } catch (err) {
    console.error('❌ Error fetching stock history:', err);
    res.status(500).send(err);
  }
});

// Get All Stock Entries - FIXED VERSION
router.get("/stock", async (req, res) => {
  try {
    const query = `
      SELECT 
        s.*, 
        p.goods_name, 
        p.product_code, 
        v.VchNo as invoice_number, 
        v.TransactionType,
        b.batch_number,
        b.mfg_date,
        b.exp_date,
        b.quantity as current_batch_quantity
      FROM stock s 
      JOIN products p ON s.product_id = p.id 
      LEFT JOIN voucher v ON s.voucher_id = v.VoucherID
      LEFT JOIN batches b ON s.batch_number = b.batch_number AND s.product_id = b.product_id
      ORDER BY s.date DESC, s.id DESC
    `;
    
    const [results] = await db.promise().query(query);

    // Get current batch quantities for all products
    const [currentBatches] = await db.promise().query(
      'SELECT product_id, batch_number, quantity FROM batches'
    );

    const batchQuantities = {};
    currentBatches.forEach(batch => {
      const key = `${batch.product_id}_${batch.batch_number}`;
      batchQuantities[key] = parseFloat(batch.quantity) || 0;
    });

    // Process each stock entry
    const processedResults = results.map(record => {
      const batchKey = `${record.product_id}_${record.batch_number}`;
      let calculatedOpeningStock = record.opening_stock;
      
      if (record.batch_number && batchQuantities[batchKey] !== undefined) {
        calculatedOpeningStock = batchQuantities[batchKey];
      }
      
      return {
        ...record,
        calculated_opening_stock: calculatedOpeningStock,
        current_batch_quantity: batchQuantities[batchKey] || 0
      };
    });

    // Group by product and batch to show separate batches
    const productBatchStock = {};
    processedResults.forEach(record => {
      const productKey = record.product_id;
      const batchKey = record.batch_number || 'NO_BATCH';
      const compositeKey = `${productKey}_${batchKey}`;
      
      if (!productBatchStock[compositeKey]) {
        productBatchStock[compositeKey] = {
          product_id: record.product_id,
          goods_name: record.goods_name,
          product_code: record.product_code,
          batch_number: record.batch_number,
          batch_details: record,
          stock_entries: [],
          total_stock_in: 0,
          total_stock_out: 0,
          current_balance: record.current_batch_quantity || 0
        };
      }
      productBatchStock[compositeKey].stock_entries.push(record);
      productBatchStock[compositeKey].total_stock_in += parseFloat(record.stock_in || 0);
      productBatchStock[compositeKey].total_stock_out += parseFloat(record.stock_out || 0);
    });
    
    res.send({
      individual_entries: processedResults,
      batch_wise_summary: Object.values(productBatchStock)
    });
  } catch (err) {
    console.error('❌ Error fetching all stock:', err);
    res.status(500).send(err);
  }
});

// Get Current Stock Balance for a Product - FIXED VERSION
router.get("/stock/balance/:productId", async (req, res) => {
  const productId = req.params.productId;
  
  try {
    const query = `
      SELECT 
        p.id,
        p.goods_name,
        p.maintain_batch,
        COALESCE(p.stock_in, 0) as total_stock_in,
        COALESCE(p.stock_out, 0) as total_stock_out,
        COALESCE(p.balance_stock, 0) as total_balance_stock,
        COALESCE(p.opening_stock, 0) as opening_stock,
        b.batch_number,
        b.quantity as batch_quantity,
        b.mfg_date,
        b.exp_date
      FROM products p 
      LEFT JOIN batches b ON p.id = b.product_id
      WHERE p.id = ?
      ORDER BY b.batch_number ASC
    `;
    
    const [results] = await db.promise().query(query, [productId]);
    
    if (results.length === 0) {
      return res.status(404).send({ message: "Product not found" });
    }
    
    const productData = {
      id: results[0].id,
      goods_name: results[0].goods_name,
      maintain_batch: results[0].maintain_batch,
      opening_stock: results[0].opening_stock,
      total_stock_in: results[0].total_stock_in,
      total_stock_out: results[0].total_stock_out,
      total_balance_stock: results[0].total_balance_stock,
      batches: []
    };
    
    // Add batch-wise information
    results.forEach(row => {
      if (row.batch_number) {
        productData.batches.push({
          batch_number: row.batch_number,
          quantity: row.batch_quantity,
          mfg_date: row.mfg_date,
          exp_date: row.exp_date
        });
      }
    });
    
    res.send(productData);
  } catch (err) {
    console.error('❌ Error fetching stock balance:', err);
    res.status(500).send(err);
  }
});

// Fix product stock calculations - FIXED VERSION
router.post('/products/fix-stock-calculation/:productId', async (req, res) => {
  const productId = req.params.productId;
  
  try {
    // Get product details
    const [product] = await db.promise().query('SELECT * FROM products WHERE id = ?', [productId]);
    
    if (product.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    const productData = product[0];
    
    let newOpeningStock = 0;
    let newStockIn = 0;
    let newStockOut = 0;
    let newBalanceStock = 0;

    // If product maintains batches, calculate from batches
    if (productData.maintain_batch === 1) {
      const [batches] = await db.promise().query(
        'SELECT SUM(quantity) as total FROM batches WHERE product_id = ?',
        [productId]
      );
      
      newOpeningStock = parseFloat(batches[0].total || 0);
      
      // Get current stock in/out from stock table
      const [stockData] = await db.promise().query(
        'SELECT SUM(stock_in) as total_in, SUM(stock_out) as total_out FROM stock WHERE product_id = ?',
        [productId]
      );
      
      newStockIn = parseFloat(stockData[0].total_in || 0);
      newStockOut = parseFloat(stockData[0].total_out || 0);
      newBalanceStock = newOpeningStock + newStockIn - newStockOut;
    } else {
      // For non-batch products, keep existing logic
      newOpeningStock = parseFloat(productData.opening_stock || 0);
      newStockIn = parseFloat(productData.stock_in || 0);
      newStockOut = parseFloat(productData.stock_out || 0);
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

// Fix stock values for all products - FIXED VERSION
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
        
        // Get current stock in/out from stock table
        const [stockData] = await db.promise().query(
          'SELECT SUM(stock_in) as total_in, SUM(stock_out) as total_out FROM stock WHERE product_id = ?',
          [product.id]
        );
        
        stockIn = parseFloat(stockData[0].total_in || 0);
        stockOut = parseFloat(stockData[0].total_out || 0);
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

// Get batch-wise stock summary - FIXED VERSION
router.get("/stock/batch-summary/:productId", async (req, res) => {
  const productId = req.params.productId;
  
  try {
    const query = `
      SELECT 
        s.batch_number,
        b.mfg_date,
        b.exp_date,
        b.quantity as current_batch_quantity,
        SUM(s.stock_in) as total_stock_in,
        SUM(s.stock_out) as total_stock_out,
        COUNT(s.id) as transaction_count
      FROM stock s
      LEFT JOIN batches b ON s.batch_number = b.batch_number AND s.product_id = b.product_id
      WHERE s.product_id = ? AND s.batch_number IS NOT NULL
      GROUP BY s.batch_number, b.mfg_date, b.exp_date, b.quantity
      ORDER BY s.batch_number
    `;
    
    const [results] = await db.promise().query(query, [productId]);
    
    res.send(results);
  } catch (err) {
    console.error('❌ Error fetching batch summary:', err);
    res.status(500).send(err);
  }
});

// Get individual batch stock details
router.get("/stock/batch/:productId/:batchNumber", async (req, res) => {
  const productId = req.params.productId;
  const batchNumber = req.params.batchNumber;
  
  try {
    const query = `
      SELECT 
        s.*, 
        p.goods_name, 
        p.product_code, 
        v.VchNo as invoice_number, 
        v.TransactionType,
        b.quantity as current_batch_quantity,
        b.mfg_date,
        b.exp_date
      FROM stock s 
      JOIN products p ON s.product_id = p.id 
      LEFT JOIN voucher v ON s.voucher_id = v.VoucherID
      LEFT JOIN batches b ON s.batch_number = b.batch_number AND s.product_id = b.product_id
      WHERE s.product_id = ? AND s.batch_number = ?
      ORDER BY s.date DESC, s.id DESC
    `;
    
    const [results] = await db.promise().query(query, [productId, batchNumber]);
    
    if (results.length === 0) {
      return res.status(404).send({ message: "No stock records found for this batch" });
    }
    
    // Calculate running balance for this specific batch
    let runningBalance = parseFloat(results[0].current_batch_quantity || 0);
    const processedResults = results.map(record => {
      const stockIn = parseFloat(record.stock_in || 0);
      const stockOut = parseFloat(record.stock_out || 0);
      
      // For display purposes, show batch quantity as opening stock
      return {
        ...record,
        calculated_opening_stock: runningBalance + stockOut - stockIn,
        running_balance: runningBalance
      };
    }).reverse(); // Reverse to show in chronological order
    
    res.send({
      batch_info: {
        batch_number: batchNumber,
        current_quantity: results[0].current_batch_quantity,
        mfg_date: results[0].mfg_date,
        exp_date: results[0].exp_date,
        product_name: results[0].goods_name
      },
      stock_entries: processedResults
    });
  } catch (err) {
    console.error('❌ Error fetching batch stock details:', err);
    res.status(500).send(err);
  }
});

module.exports = router;