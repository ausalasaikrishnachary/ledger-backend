const express = require('express');
const router = express.Router();
const db = require('./../../db');

// Get next batch number based on group_by
router.get('/batches/next-batch-number', async (req, res) => {
  const { group_by, product_id } = req.query;
  const actualGroupBy = group_by || 'Salescatalog';
  
  console.log('🔢 Fetching next batch number for group:', actualGroupBy, 'product_id:', product_id);

  try {
    let prefix = '';
    if (actualGroupBy === 'Purchaseditems') {
      prefix = 'P';
    } else if (actualGroupBy === 'Salescatalog') {
      prefix = 'S';
    }

    const [allBatches] = await db.promise().query(
      `SELECT batch_number FROM batches 
       WHERE group_by = ? 
       ORDER BY 
         CAST(REPLACE(REPLACE(batch_number, 'S', ''), 'P', '') AS UNSIGNED) DESC,
         id DESC
       LIMIT 1`,
      [actualGroupBy]
    );

    let nextBatchNumber = 1;
    
    if (allBatches.length > 0) {
      const lastBatch = allBatches[0].batch_number;
      const numericMatch = lastBatch.match(/\d+/);
      if (numericMatch) {
        nextBatchNumber = parseInt(numericMatch[0]) + 1;
      }
    }

    const batchNumber = `${prefix}${String(nextBatchNumber).padStart(4, '0')}`;
    
    res.json({ 
      success: true, 
      batch_number: batchNumber
    });
  } catch (err) {
    console.error('❌ Error fetching next batch number:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch next batch number', 
      error: err.message 
    });
  }
});

// Create a new product (FIXED VERSION)
router.post('/products', async (req, res) => {
  const data = req.body;

  try {
    console.log('\n========== CREATE PRODUCT REQUEST ==========');
    console.log('Maintain Batch:', data.maintain_batch);
    console.log('Opening Stock:', data.opening_stock);
    console.log('Batches count:', data.batches ? data.batches.length : 0);

    // Calculate initial stock values
    let openingStock = parseFloat(data.opening_stock || 0);
    let stockIn = 0;
    let stockOut = 0;
    let balanceStock = openingStock;

    // If product maintains batches, calculate from batches
    if (data.maintain_batch && Array.isArray(data.batches) && data.batches.length > 0) {
      const totalBatchQuantity = data.batches.reduce((total, batch) => {
        return total + (parseFloat(batch.quantity) || 0);
      }, 0);
      
      openingStock = totalBatchQuantity;
      balanceStock = totalBatchQuantity;
      
      console.log('📊 Using batch-based stock calculation:', {
        totalBatchQuantity,
        openingStock,
        balanceStock
      });
    }

    const productData = {
      ...data,
      opening_stock: openingStock,
      stock_in: stockIn,
      stock_out: stockOut,
      balance_stock: balanceStock,
      created_at: new Date(),
      updated_at: new Date()
    };

    const { batches, ...cleanProductData } = productData;

    // Insert product
    const columns = Object.keys(cleanProductData).join(', ');
    const placeholders = Object.keys(cleanProductData).map(() => '?').join(', ');
    const values = Object.values(cleanProductData);

    const productSql = `INSERT INTO products (${columns}) VALUES (${placeholders})`;
    const [productInsert] = await db.promise().query(productSql, values);

    const productId = productInsert.insertId;

    console.log('✅ Product created with stock:', {
      productId,
      opening_stock: openingStock,
      stock_in: stockIn,
      stock_out: stockOut,
      balance_stock: balanceStock,
      maintain_batch: data.maintain_batch
    });

    // Handle batches
    if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
      const batchValues = [];
      let totalBatchQuantity = 0;

      // Get the starting batch number
      let currentBatchNumber = 1;
      try {
        const [lastBatchRow] = await db.promise().query(
          'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(REPLACE(REPLACE(batch_number, "S", ""), "P", "") AS UNSIGNED) DESC LIMIT 1',
          [data.group_by || 'Salescatalog']
        );
        
        if (lastBatchRow.length > 0) {
          const lastBatch = lastBatchRow[0].batch_number;
          const numericMatch = lastBatch.match(/\d+/);
          if (numericMatch) {
            currentBatchNumber = parseInt(numericMatch[0]) + 1;
          }
        }
      } catch (error) {
        console.error('Error getting batch number:', error);
      }

      const prefix = data.group_by === 'Purchaseditems' ? 'P' : 'S';

      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        const batchQuantity = parseFloat(batch.quantity || 0);
        totalBatchQuantity += batchQuantity;
        
        let barcode = batch.barcode;
        const timestamp = Date.now();
        if (!barcode) {
          barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
        }

        // Verify barcode uniqueness
        const [barcodeCheck] = await db.promise().query(
          'SELECT COUNT(*) as count FROM batches WHERE barcode = ?',
          [barcode]
        );

        if (barcodeCheck[0].count > 0) {
          barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
        }

        const batchNumber = `${prefix}${String(currentBatchNumber + index).padStart(4, '0')}`;
        
        batchValues.push([
          productId,
          batchNumber,
          batch.mfg_date || batch.mfgDate || null,
          batch.exp_date || batch.expDate || null,
          batchQuantity,
          parseFloat(batch.selling_price || batch.sellingPrice) || 0,
          parseFloat(batch.purchase_price || batch.purchasePrice) || 0,
          parseFloat(batch.mrp) || 0,
          parseFloat(batch.batch_price || batch.batchPrice) || 0,
          barcode,
          data.group_by || 'Salescatalog',
          new Date(),
          new Date()
        ]);

        console.log(`✅ Prepared batch: ${batchNumber} with quantity: ${batchQuantity}`);
      }

      // Insert batches
      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, mfg_date, exp_date, quantity, selling_price, purchase_price, mrp, batch_price, barcode, group_by, created_at, updated_at)
        VALUES ?
      `;
      await db.promise().query(batchSql, [batchValues]);

      console.log('✅ Batches created:', batches.length);
    }

    res.status(201).json({ 
      success: true, 
      product_id: productId,
      opening_stock: openingStock,
      balance_stock: balanceStock
    });
  } catch (err) {
    console.error('❌ Error creating product:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create product', 
      error: err.message 
    });
  }
});

// Update a product (COMPLETELY FIXED VERSION)
router.put('/products/:id', async (req, res) => {
  const productId = req.params.id;
  const data = req.body;
  const { batches, ...productData } = data;

  console.log('\n========== UPDATE PRODUCT REQUEST ==========');
  console.log('Product ID:', productId);
  console.log('Maintain Batch:', data.maintain_batch);
  console.log('Batches received:', batches ? batches.length : 0);

  try {
    // Calculate stock values for non-batch products
    if (!data.maintain_batch) {
      const openingStock = parseFloat(data.opening_stock || 0);
      const stockIn = 0;
      const stockOut = parseFloat(productData.stock_out || 0);
      const balanceStock = openingStock + stockIn - stockOut;
      
      productData.opening_stock = openingStock;
      productData.stock_in = stockIn;
      productData.stock_out = stockOut;
      productData.balance_stock = balanceStock;
      
      console.log('📊 Non-batch product stock calculation:', {
        opening_stock: openingStock,
        stock_in: stockIn,
        stock_out: stockOut,
        balance_stock: balanceStock
      });
    }

    // Update product basic info
    if (Object.keys(productData).length > 0) {
      productData.updated_at = new Date();
      const updateFields = Object.keys(productData).map(k => `${k} = ?`).join(', ');
      const updateValues = Object.values(productData);
      const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
      await db.promise().query(updateSql, [...updateValues, productId]);
      console.log('✅ Product basic info updated');
    }

    // Handle batches if maintain_batch is true
    if (data.maintain_batch && Array.isArray(batches)) {
      console.log('\n========== PROCESSING BATCHES ==========');
      
      // Get existing batches for this product
      const [existingBatches] = await db.promise().query(
        'SELECT * FROM batches WHERE product_id = ?',
        [productId]
      );

      console.log('📦 Existing batches in DB:', existingBatches.length);

      // Create a map of existing batch IDs
      const existingBatchMap = new Map();
      existingBatches.forEach(batch => {
        existingBatchMap.set(batch.id, batch);
      });

      // Get the highest batch number for new batches
      const [lastBatchRow] = await db.promise().query(
        'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(REPLACE(batch_number, "P", "") AS UNSIGNED) DESC, CAST(REPLACE(batch_number, "S", "") AS UNSIGNED) DESC LIMIT 1',
        [data.group_by || 'Salescatalog']
      );

      let lastBatchNumber = 0;
      if (lastBatchRow.length > 0) {
        const lastBatch = lastBatchRow[0].batch_number;
        const numericPart = lastBatch.replace(/[^\d]/g, '');
        lastBatchNumber = parseInt(numericPart) || 0;
      }

      // Store IDs of batches that were processed in this request
      const processedBatchIds = [];

      // Process each batch from request
      for (const [index, batch] of batches.entries()) {
        // Generate or verify barcode
        let barcode = batch.barcode;
        if (!barcode) {
          const timestamp = Date.now();
          barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
        }

        // Verify barcode uniqueness for new batches
        if (!batch.isExisting) {
          const [barcodeCheck] = await db.promise().query(
            'SELECT COUNT(*) as count FROM batches WHERE barcode = ?',
            [barcode]
          );

          if (barcodeCheck[0].count > 0) {
            const timestamp = Date.now();
            barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
          }
        }

        // Prepare batch data
        const batchData = {
          mfg_date: batch.mfg_date || batch.mfgDate || null,
          exp_date: batch.exp_date || batch.expDate || null,
          quantity: parseFloat(batch.quantity) || 0,
          selling_price: parseFloat(batch.selling_price || batch.sellingPrice) || 0,
          purchase_price: parseFloat(batch.purchase_price || batch.purchasePrice) || 0,
          mrp: parseFloat(batch.mrp) || 0,
          batch_price: parseFloat(batch.batch_price || batch.batchPrice) || 0,
          barcode: barcode,
          group_by: data.group_by || 'Salescatalog',
          updated_at: new Date()
        };

        // Check if this is an existing batch
        const hasValidDatabaseId = batch.id && !batch.id.toString().includes('temp_');
        const isExistingBatch = batch.isExisting === true && hasValidDatabaseId;

        if (isExistingBatch) {
          // UPDATE existing batch
          console.log('🔄 UPDATING existing batch ID:', batch.id);
          
          const updateSql = `
            UPDATE batches SET 
              mfg_date = ?, exp_date = ?, quantity = ?,  
              selling_price = ?, purchase_price = ?, mrp = ?, batch_price = ?, 
              barcode = ?, group_by = ?, updated_at = ?
            WHERE id = ?
          `;
          
          const updateValues = [
            batchData.mfg_date,
            batchData.exp_date,
            batchData.quantity,
            batchData.selling_price,
            batchData.purchase_price,
            batchData.mrp,
            batchData.batch_price,
            batchData.barcode,
            batchData.group_by,
            batchData.updated_at,
            parseInt(batch.id)
          ];
          
          await db.promise().query(updateSql, updateValues);
          processedBatchIds.push(parseInt(batch.id));
          console.log('✅ Updated batch ID:', batch.id);
          
        } else {
          // INSERT new batch
          const prefix = data.group_by === 'Purchaseditems' ? 'P' : 'S';
          const newBatchNumber = `${prefix}${String(lastBatchNumber + 1).padStart(4, '0')}`;
          lastBatchNumber++;
          
          console.log('➕ INSERTING NEW batch with number:', newBatchNumber);
          
          const insertSql = `
            INSERT INTO batches 
            (product_id, batch_number, mfg_date, exp_date, quantity,  
             selling_price, purchase_price, mrp, batch_price, barcode, group_by, 
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          const insertValues = [
            productId,
            newBatchNumber,
            batchData.mfg_date,
            batchData.exp_date,
            batchData.quantity,
            batchData.selling_price,
            batchData.purchase_price,
            batchData.mrp,
            batchData.batch_price,
            batchData.barcode,
            batchData.group_by,
            new Date(),
            batchData.updated_at
          ];
          
          const [insertResult] = await db.promise().query(insertSql, insertValues);
          processedBatchIds.push(insertResult.insertId);
          console.log('✅ Inserted new batch with ID:', insertResult.insertId);
        }
      }

      // Delete batches that exist in DB but weren't processed in this request
      if (processedBatchIds.length > 0) {
        const placeholders = processedBatchIds.map(() => '?').join(',');
        const [deleteResult] = await db.promise().query(
          `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
          [productId, ...processedBatchIds]
        );
        console.log('🗑️ Deleted', deleteResult.affectedRows, 'batches that were not in the current request');
      } else if (batches.length === 0 && existingBatches.length > 0) {
        // If no batches in request but batches exist in DB, delete all
        const [deleteResult] = await db.promise().query(
          'DELETE FROM batches WHERE product_id = ?',
          [productId]
        );
        console.log('🗑️ No batches in request - deleted all', deleteResult.affectedRows, 'existing batches');
      }

      // Update product stock from batches
      const [batchTotals] = await db.promise().query(
        'SELECT SUM(quantity) as total_quantity FROM batches WHERE product_id = ?',
        [productId]
      );
      
      const totalBatchQuantity = parseFloat(batchTotals[0].total_quantity || 0);
      
      await db.promise().query(
        'UPDATE products SET opening_stock = ?, balance_stock = ? WHERE id = ?',
        [totalBatchQuantity, totalBatchQuantity, productId]
      );
      
      console.log('✅ Updated product stock from batches:', totalBatchQuantity);
    } else if (!data.maintain_batch) {
      // Delete all batches if maintain_batch is false
      console.log('\n🗑️ Maintain batch is FALSE - deleting all batches');
      const [deleteResult] = await db.promise().query(
        'DELETE FROM batches WHERE product_id = ?',
        [productId]
      );
      console.log('🗑️ Deleted', deleteResult.affectedRows, 'batches');
    }

    console.log('\n========== UPDATE COMPLETED ==========\n');

    res.json({
      success: true,
      message: 'Product updated successfully',
      id: productId
    });
  } catch (err) {
    console.error('❌ Error updating product:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: err.message
    });
  }
});

// Check barcode uniqueness
router.get('/batches/check-barcode/:barcode', async (req, res) => {
  const barcode = req.params.barcode;
  try {
    const [result] = await db.promise().query(
      'SELECT COUNT(*) as count FROM batches WHERE barcode = ?',
      [barcode]
    );
    res.json({ available: result[0].count === 0 });
  } catch (err) {
    console.error('Error checking barcode:', err);
    res.status(500).json({ success: false, message: 'Failed to check barcode', error: err.message });
  }
});

// Get all products
router.get('/products', async (req, res) => {
  try {
    const [results] = await db.promise().query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(results);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});

// Get single product
router.get('/products/:id', async (req, res) => {
  try {
    const [results] = await db.promise().query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    res.json(results[0] || null);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ message: 'Failed to fetch product' });
  }
});

// Delete product
router.delete('/products/:id', async (req, res) => {
  const productId = req.params.id;
  try {
    await db.promise().query('DELETE FROM stock WHERE product_id = ?', [productId]);
    await db.promise().query('DELETE FROM batches WHERE product_id = ?', [productId]);
    await db.promise().query('DELETE FROM products WHERE id = ?', [productId]);
    
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product', error: err.message });
  }
});

// Get product batches
router.get('/products/:id/batches', async (req, res) => {
  try {
    const [results] = await db.promise().query(
      'SELECT * FROM batches WHERE product_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(results);
  } catch (err) {
    console.error('Error fetching batches:', err);
    res.status(500).json({ message: 'Failed to fetch batches' });
  }
});

// Get products by group type
router.get('/products/group/:group_type', async (req, res) => {
  const groupType = req.params.group_type;
  try {
    const [results] = await db.promise().query(
      'SELECT * FROM products WHERE group_by = ? ORDER BY created_at DESC',
      [groupType]
    );
    res.json(results);
  } catch (err) {
    console.error('Error fetching products by group:', err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});

// Search products
router.get('/products/search/:query', async (req, res) => {
  const query = req.params.query;
  try {
    const [results] = await db.promise().query(
      'SELECT * FROM products WHERE goods_name LIKE ? OR sku LIKE ? OR hsn_code LIKE ? ORDER BY created_at DESC',
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );
    res.json(results);
  } catch (err) {
    console.error('Error searching products:', err);
    res.status(500).json({ message: 'Failed to search products' });
  }
});

module.exports = router;