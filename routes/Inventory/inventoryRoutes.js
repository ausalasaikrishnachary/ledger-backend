const express = require('express');
const router = express.Router();
const db = require('./../../db');

// Get next batch number based on group_by - IMPROVED VERSION
router.get('/batches/next-batch-number', async (req, res) => {
  const { group_by } = req.query;
  if (!group_by) {
    return res.status(400).json({ success: false, message: 'group_by parameter is required' });
  }

  try {
    const [lastBatchRow] = await db.promise().query(
      'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(REPLACE(batch_number, "P", "") AS UNSIGNED) DESC, CAST(REPLACE(batch_number, "S", "") AS UNSIGNED) DESC LIMIT 1',
      [group_by]
    );

    let nextBatchNumber = 1;
    if (lastBatchRow.length > 0) {
      const lastBatch = lastBatchRow[0].batch_number;
      // Extract numeric part from batch number (handle both numeric and prefixed)
      const numericPart = lastBatch.replace(/[^\d]/g, '');
      nextBatchNumber = parseInt(numericPart) + 1;
    }

    // Use different prefixes for different groups
    let prefix = '';
    if (group_by === 'Purchaseditems') {
      prefix = 'P';
    } else if (group_by === 'Salescatalog') {
      prefix = 'S';
    }

    const batchNumber = `${prefix}${String(nextBatchNumber).padStart(4, '0')}`;
    
    res.json({ success: true, batch_number: batchNumber });
  } catch (err) {
    console.error('Error fetching next batch number:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch next batch number', error: err.message });
  }
});

// Create purchase product with optional sales catalog - MAIN ENDPOINT
router.post('/products/purchase-with-sales', async (req, res) => {
  const data = req.body;
  const { create_sales_catalog, ...productData } = data;

  console.log('\n========== CREATE PURCHASE WITH SALES REQUEST ==========');
  console.log('Create Sales Catalog:', create_sales_catalog);
  console.log('Product Data:', JSON.stringify(productData, null, 2));

  try {
    // Set default values for purchase product
    productData.balance_stock = parseFloat(productData.opening_stock) || 0;
    productData.created_at = new Date();
    productData.updated_at = new Date();
    
    const { batches, ...purchaseProductData } = productData;

    // Insert purchase product
    const purchaseColumns = Object.keys(purchaseProductData).join(', ');
    const purchasePlaceholders = Object.keys(purchaseProductData).map(() => '?').join(', ');
    const purchaseValues = Object.values(purchaseProductData);

    const purchaseSql = `INSERT INTO products (${purchaseColumns}) VALUES (${purchasePlaceholders})`;
    const [purchaseInsert] = await db.promise().query(purchaseSql, purchaseValues);

    const purchaseProductId = purchaseInsert.insertId;
    console.log('✅ Purchase product created with ID:', purchaseProductId);

    // Handle batches for purchase product
    let purchaseBatchCount = 0;
    if (productData.maintain_batch && Array.isArray(batches) && batches.length > 0) {
      const [lastBatchRow] = await db.promise().query(
        'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(REPLACE(batch_number, "P", "") AS UNSIGNED) DESC LIMIT 1',
        ['Purchaseditems']
      );

      let lastBatchNumber = 0;
      if (lastBatchRow.length > 0) {
        const lastBatch = lastBatchRow[0].batch_number;
        const numericPart = lastBatch.replace(/[^\d]/g, '');
        lastBatchNumber = parseInt(numericPart) || 0;
      }

      const batchValues = [];
      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
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

        const batchNumber = `P${String(lastBatchNumber + index + 1).padStart(4, '0')}`;
        
        batchValues.push([
          purchaseProductId,
          batchNumber,
          batch.mfg_date || batch.mfgDate || null,
          batch.exp_date || batch.expDate || null,
          parseFloat(batch.quantity) || 0,
         
          parseFloat(batch.selling_price || batch.sellingPrice) || 0,
          parseFloat(batch.purchase_price || batch.purchasePrice) || 0,
          parseFloat(batch.mrp) || 0,
          parseFloat(batch.batch_price || batch.batchPrice) || 0,
          barcode,
          'Purchaseditems',
          new Date(),
          new Date()
        ]);
      }

      // Insert batches
      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, mfg_date, exp_date, quantity, selling_price, purchase_price, mrp, batch_price, barcode, group_by, created_at, updated_at)
        VALUES ?
      `;
      await db.promise().query(batchSql, [batchValues]);
      purchaseBatchCount = batches.length;
      console.log('✅ Purchase batches created:', purchaseBatchCount);
    }

    // Create sales catalog entry if requested
    let salesProductId = null;
    let salesBatchCount = 0;
    
    if (create_sales_catalog) {
      const salesProductData = {
        ...purchaseProductData,
        group_by: 'Salescatalog',
        stock_in: null,
        stock_out: null,
        balance_stock: purchaseProductData.opening_stock || "0",
        can_be_sold: true,
        maintain_batch: false, // Sales catalog doesn't maintain batches from purchase
        created_at: new Date(),
        updated_at: new Date()
      };

      // Remove fields that shouldn't be in sales catalog
      delete salesProductData.id;
      delete salesProductData.batches;

      const salesColumns = Object.keys(salesProductData).join(', ');
      const salesPlaceholders = Object.keys(salesProductData).map(() => '?').join(', ');
      const salesValues = Object.values(salesProductData);

      const salesSql = `INSERT INTO products (${salesColumns}) VALUES (${salesPlaceholders})`;
      const [salesInsert] = await db.promise().query(salesSql, salesValues);
      
      salesProductId = salesInsert.insertId;
      console.log('✅ Sales catalog product created with ID:', salesProductId);

      // Create a default batch for sales catalog with different batch number
      const [lastSalesBatchRow] = await db.promise().query(
        'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(REPLACE(batch_number, "S", "") AS UNSIGNED) DESC LIMIT 1',
        ['Salescatalog']
      );

      let lastSalesBatchNumber = 0;
      if (lastSalesBatchRow.length > 0) {
        const lastBatch = lastSalesBatchRow[0].batch_number;
        const numericPart = lastBatch.replace(/[^\d]/g, '');
        lastSalesBatchNumber = parseInt(numericPart) || 0;
      }

      const salesBatchNumber = `S${String(lastSalesBatchNumber + 1).padStart(4, '0')}`;
      const salesBarcode = `BS${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

      const salesBatchSql = `
        INSERT INTO batches 
        (product_id, batch_number, mfg_date, exp_date, quantity,  selling_price, purchase_price, mrp, batch_price, barcode, group_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await db.promise().query(salesBatchSql, [
        salesProductId,
        salesBatchNumber,
        null,
        null,
        parseFloat(salesProductData.opening_stock) || 0,
        0,
        parseFloat(salesProductData.price) || 0,
        0,
        0,
        0,
        salesBarcode,
        'Salescatalog',
        new Date(),
        new Date()
      ]);
      
      salesBatchCount = 1;
      console.log('✅ Sales catalog batch created:', salesBatchNumber);
    }

    console.log('========== REQUEST COMPLETED SUCCESSFULLY ==========\n');

    res.status(201).json({ 
      success: true, 
      purchase_product_id: purchaseProductId,
      sales_product_id: salesProductId,
      sales_catalog_created: !!create_sales_catalog,
      purchase_batch_count: purchaseBatchCount,
      sales_batch_count: salesBatchCount
    });
  } catch (err) {
    console.error('❌ Error creating purchase product:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create purchase product', 
      error: err.message 
    });
  }
});

// Create a new product (for sales catalog directly)
router.post('/products', async (req, res) => {
  const data = req.body;

  try {
    data.balance_stock = parseFloat(data.opening_stock) || 0;
    data.created_at = new Date();
    data.updated_at = new Date();
    const { batches, ...productData } = data;

    // Insert product
    const columns = Object.keys(productData).join(', ');
    const placeholders = Object.keys(productData).map(() => '?').join(', ');
    const values = Object.values(productData);

    const productSql = `INSERT INTO products (${columns}) VALUES (${placeholders})`;
    const [productInsert] = await db.promise().query(productSql, values);

    const productId = productInsert.insertId;

    // Handle batches
    if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
      // Get the last batch number for the group_by
      const [lastBatchRow] = await db.promise().query(
        'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(REPLACE(batch_number, "S", "") AS UNSIGNED) DESC LIMIT 1',
        [data.group_by]
      );

      let lastBatchNumber = 0;
      if (lastBatchRow.length > 0) {
        const lastBatch = lastBatchRow[0].batch_number;
        const numericPart = lastBatch.replace(/[^\d]/g, '');
        lastBatchNumber = parseInt(numericPart) || 0;
      }

      const batchValues = [];
      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
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

        const prefix = data.group_by === 'Purchaseditems' ? 'P' : 'S';
        const batchNumber = `${prefix}${String(lastBatchNumber + index + 1).padStart(4, '0')}`;
        
        batchValues.push([
          productId,
          batchNumber,
          batch.mfg_date || batch.mfgDate || null,
          batch.exp_date || batch.expDate || null,
          parseFloat(batch.quantity) || 0,
          
          parseFloat(batch.selling_price || batch.sellingPrice) || 0,
          parseFloat(batch.purchase_price || batch.purchasePrice) || 0,
          parseFloat(batch.mrp) || 0,
          parseFloat(batch.batch_price || batch.batchPrice) || 0,
          barcode,
          data.group_by || 'Salescatalog',
          new Date(),
          new Date()
        ]);
      }

      // Insert batches
      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, mfg_date, exp_date, quantity, selling_price, purchase_price, mrp, batch_price, barcode, group_by, created_at, updated_at)
        VALUES ?
      `;
      await db.promise().query(batchSql, [batchValues]);

      res.status(201).json({ success: true, product_id: productId, batch_count: batches.length });
    } else {
      res.status(201).json({ success: true, product_id: productId, batch_count: 0 });
    }
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ success: false, message: 'Failed to create product', error: err.message });
  }
});

// Update a product - COMPLETELY FIXED VERSION
router.put('/products/:id', async (req, res) => {
  const productId = req.params.id;
  const data = req.body;
  const { batches, ...productData } = data;

  console.log('\n========== UPDATE PRODUCT REQUEST ==========');
  console.log('Product ID:', productId);
  console.log('Maintain Batch:', data.maintain_batch);
  console.log('Batches received:', batches ? batches.length : 0);
  console.log('Batches data:', JSON.stringify(batches, null, 2));

  try {
    // Update product basic info
    if (Object.keys(productData).length > 0) {
      productData.updated_at = new Date();
      const updateFields = Object.keys(productData).map(k => `${k} = ?`).join(', ');
      const updateValues = Object.values(productData);
      const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
      await db.promise().query(updateSql, [...updateValues, productId]);
      console.log('✅ Product basic info updated');
    }

    // Initialize batch counters
    let batchesUpdated = 0;
    let batchesInserted = 0;
    let batchesDeleted = 0;

    // Handle batches if maintain_batch is true
    if (data.maintain_batch && Array.isArray(batches)) {
      console.log('\n========== PROCESSING BATCHES ==========');
      
      // Get existing batches for this product
      const [existingBatches] = await db.promise().query(
        'SELECT * FROM batches WHERE product_id = ?',
        [productId]
      );

      console.log('📦 Existing batches in DB:', existingBatches.length);
      existingBatches.forEach(batch => {
        console.log(`  - ID: ${batch.id}, Batch No: ${batch.batch_number}`);
      });

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
      console.log('📊 Last batch number for group:', lastBatchNumber);

      // Store IDs of batches that were processed in this request
      const processedBatchIds = [];

      // Process each batch from request
      for (const [index, batch] of batches.entries()) {
        console.log(`\n🔍 Processing batch ${index}:`, {
          id: batch.id,
          isExisting: batch.isExisting,
          batch_number: batch.batch_number || batch.batchNumber,
          hasValidId: batch.id && !batch.id.toString().includes('temp_')
        });

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
            console.log('⚠️ Barcode conflict, generated new:', barcode);
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

        // FIXED: Check if this is an existing batch
        const hasValidDatabaseId = batch.id && !batch.id.toString().includes('temp_');
        const isExistingBatch = batch.isExisting === true && hasValidDatabaseId;

        console.log(`🔍 Batch detection - isExistingBatch: ${isExistingBatch}, ID: ${batch.id}, hasValidDatabaseId: ${hasValidDatabaseId}`);

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
          batchesUpdated++;
          processedBatchIds.push(parseInt(batch.id)); // Track this batch ID
          console.log('✅ Updated batch ID:', batch.id);
          
        } else {
          // INSERT new batch
          const prefix = data.group_by === 'Purchaseditems' ? 'P' : 'S';
          const newBatchNumber = `${prefix}${String(lastBatchNumber + batchesInserted + 1).padStart(4, '0')}`;
          console.log('➕ INSERTING NEW batch with number:', newBatchNumber);
          
          const insertSql = `
            INSERT INTO batches 
            (product_id, batch_number, mfg_date, exp_date, quantity,  
             selling_price, purchase_price, mrp, batch_price, barcode, group_by, 
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          batchesInserted++;
          processedBatchIds.push(insertResult.insertId); // Track the newly inserted batch ID
          console.log('✅ Inserted new batch with ID:', insertResult.insertId);
        }
      }

      // FIXED: SMART DELETION LOGIC - Only delete batches that are not processed in this request
      console.log('\n🗑️ Checking for batches to delete...');
      
      console.log('Processed batch IDs (updated + inserted):', processedBatchIds);
      console.log('All existing batch IDs in DB:', Array.from(existingBatchMap.keys()));

      if (processedBatchIds.length > 0) {
        // Delete batches that exist in DB but weren't processed in this request
        const placeholders = processedBatchIds.map(() => '?').join(',');
        const [deleteResult] = await db.promise().query(
          `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
          [productId, ...processedBatchIds]
        );
        batchesDeleted = deleteResult.affectedRows;
        console.log('🗑️ Deleted', batchesDeleted, 'batches that were not in the current request');
      } else if (batches.length === 0 && existingBatches.length > 0) {
        // If no batches in request but batches exist in DB, delete all
        const [deleteResult] = await db.promise().query(
          'DELETE FROM batches WHERE product_id = ?',
          [productId]
        );
        batchesDeleted = deleteResult.affectedRows;
        console.log('🗑️ No batches in request - deleted all', batchesDeleted, 'existing batches');
      } else {
        console.log('✅ No batches to delete');
      }

    } else if (!data.maintain_batch) {
      // Delete all batches if maintain_batch is false
      console.log('\n🗑️ Maintain batch is FALSE - deleting all batches');
      const [deleteResult] = await db.promise().query(
        'DELETE FROM batches WHERE product_id = ?',
        [productId]
      );
      batchesDeleted = deleteResult.affectedRows;
      console.log('🗑️ Deleted', batchesDeleted, 'batches');
    }

    console.log('\n========== UPDATE SUMMARY ==========');
    console.log('✅ Product updated successfully');
    console.log('📊 Batches Updated:', batchesUpdated);
    console.log('📊 Batches Inserted:', batchesInserted);
    console.log('📊 Batches Deleted:', batchesDeleted);
    console.log('========================================\n');

    res.json({
      success: true,
      message: 'Product updated successfully',
      id: productId,
      batchesUpdated,
      batchesInserted,
      batchesDeleted
    });
  } catch (err) {
    console.error('❌ Error updating product:', err);
    console.error('❌ Error stack:', err.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: err.message,
      sqlMessage: err.sqlMessage
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
    // Delete related records first
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