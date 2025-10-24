const express = require('express');
const router = express.Router();
const db = require('./../../db'); // Adjust path as per your project structure

// Get next batch number based on group_by
router.get('/batches/next-batch-number', async (req, res) => {
  const { group_by } = req.query;
  if (!group_by) {
    return res.status(400).json({ success: false, message: 'group_by parameter is required' });
  }

  try {
    const [lastBatchRow] = await db.promise().query(
      'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(batch_number AS UNSIGNED) DESC LIMIT 1',
      [group_by]
    );

    let nextBatchNumber = 1;
    if (lastBatchRow.length > 0) {
      nextBatchNumber = parseInt(lastBatchRow[0].batch_number) + 1;
    }

    res.json({ success: true, batch_number: String(nextBatchNumber).padStart(5, '0') });
  } catch (err) {
    console.error('Error fetching next batch number:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch next batch number', error: err.message });
  }
});

// Create a new product
router.post('/products', async (req, res) => {
  const data = req.body;

  try {
    data.balance_stock = parseFloat(data.opening_stock) || 0;
    data.created_at = new Date();
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
        'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(batch_number AS UNSIGNED) DESC LIMIT 1',
        [data.group_by]
      );

      let lastBatchNumber = 0;
      if (lastBatchRow.length > 0) {
        lastBatchNumber = parseInt(lastBatchRow[0].batch_number) || 0;
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

        const batchNumber = String(lastBatchNumber + index + 1).padStart(5, '0');
        batchValues.push([
          productId,
          batchNumber,
          batch.mfgDate || null,
          batch.expDate || null,
          parseFloat(batch.quantity) || 0,
          parseFloat(batch.costPrice) || 0,
          parseFloat(batch.sellingPrice) || 0,
          parseFloat(batch.purchasePrice) || 0,
          parseFloat(batch.mrp) || 0,
          parseFloat(batch.batchPrice) || 0,
          barcode,
          data.group_by || 'Salescatalog',
          new Date(),
          new Date()
        ]);
      }

      // Insert batches
      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode, group_by, created_at, updated_at)
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

// Update a product
// Update a product
router.put('/products/:id', async (req, res) => {
  const productId = req.params.id;
  const data = req.body;
  const { batches, ...productData } = data;

  try {
    // Update product basic info
    if (Object.keys(productData).length > 0) {
      const updateFields = Object.keys(productData).map(k => `${k} = ?`).join(', ');
      const updateValues = Object.values(productData);
      const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
      await db.promise().query(updateSql, [...updateValues, productId]);
    }

    // Initialize batch counters
    let batchesUpdated = 0;
    let batchesInserted = 0;

    // Handle batches if maintain_batch is true
    if (data.maintain_batch && Array.isArray(batches)) {
      // Get existing batches for this product
      const [existingBatches] = await db.promise().query(
        'SELECT id, batch_number FROM batches WHERE product_id = ?',
        [productId]
      );

      const existingMap = new Map();
      existingBatches.forEach(batch => {
        existingMap.set(batch.id, batch.batch_number);
      });

      // Get the last batch number for the group_by
      const [lastBatchRow] = await db.promise().query(
        'SELECT batch_number FROM batches WHERE group_by = ? ORDER BY CAST(batch_number AS UNSIGNED) DESC LIMIT 1',
        [data.group_by || 'Salescatalog']
      );

      let lastBatchNumber = 0;
      if (lastBatchRow.length > 0) {
        lastBatchNumber = parseInt(lastBatchRow[0].batch_number) || 0;
      }
      console.log('Last batch number for group:', lastBatchNumber);

      const insertBatches = [];
      const updateBatches = [];

      for (const [index, batch] of batches.entries()) {
        console.log(`Processing batch ${index}:`, {
          id: batch.id,
          batch_number: batch.batch_number,
          isNew: !batch.id
        });

        let barcode = batch.barcode;
        const timestamp = Date.now();

        // Generate barcode if not provided
        if (!barcode) {
          barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
        }

        // Verify barcode uniqueness
        let finalBarcode = barcode;
        const [barcodeCheck] = await db.promise().query(
          'SELECT COUNT(*) as count FROM batches WHERE barcode = ? AND id != ?',
          [finalBarcode, batch.id || 0]
        );

        if (barcodeCheck[0].count > 0) {
          finalBarcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
        }

        const batchData = [
          batch.mfgDate || batch.mfg_date || null,
          batch.expDate || batch.exp_date || null,
          parseFloat(batch.quantity) || 0,
          parseFloat(batch.costPrice || batch.cost_price) || 0,
          parseFloat(batch.sellingPrice || batch.selling_price) || 0,
          parseFloat(batch.purchasePrice || batch.purchase_price) || 0,
          parseFloat(batch.mrp) || 0,
          parseFloat(batch.batchPrice || batch.batch_price) || 0,
          finalBarcode,
          data.group_by || 'Salescatalog',
          new Date()
        ];

        // Determine if this is a new batch or existing batch
        const isNewBatch = !batch.id || !existingMap.has(batch.id);

        if (!isNewBatch) {
          // Update existing batch - use existing batch number
          const existingBatchNumber = existingMap.get(batch.id);
          updateBatches.push({
            id: batch.id,
            data: [existingBatchNumber, ...batchData, batch.id]
          });
          batchesUpdated++;
        } else {
          // Insert new batch - generate new batch number
          const batchNumber = String(lastBatchNumber + batchesInserted + 1).padStart(5, '0');
          console.log('Adding NEW batch with number:', batchNumber);

          insertBatches.push([
            productId,
            batchNumber,
            ...batchData,
            new Date() // created_at
          ]);
          batchesInserted++;
        }
      }

      // Update existing batches
      if (updateBatches.length > 0) {
        console.log('Updating', updateBatches.length, 'batches');
        for (const batch of updateBatches) {
          await db.promise().query(
            `UPDATE batches SET 
             batch_number=?, mfg_date=?, exp_date=?, quantity=?, cost_price=?, selling_price=?, purchase_price=?, mrp=?, batch_price=?, barcode=?, group_by=?, updated_at=?
             WHERE id=?`,
            batch.data
          );
        }
      }

      // Insert new batches
      if (insertBatches.length > 0) {
        console.log('Inserting', insertBatches.length, 'NEW batches');
        console.log('Sample insert data:', insertBatches[0]);

        const batchSql = `
          INSERT INTO batches 
          (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode, group_by, updated_at, created_at)
          VALUES ?
        `;

        const [insertResult] = await db.promise().query(batchSql, [insertBatches]);
        console.log('Batches inserted successfully, result:', insertResult);
      } else {
        console.log('No new batches to insert');
      }

      // Delete batches that were removed from UI
      const batchesToKeepIds = batches
        .filter(b => b.id && existingMap.has(b.id))
        .map(b => b.id);

      console.log('✅ Batch IDs to KEEP:', batchesToKeepIds);
      console.log('📋 All existing batch IDs in DB:', Array.from(existingMap.keys()));

      if (batchesToKeepIds.length > 0) {
        const placeholders = batchesToKeepIds.map(() => '?').join(',');
        const [deleteResult] = await db.promise().query(
          `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
          [productId, ...batchesToKeepIds]
        );
        console.log('🗑️ Deleted batches that were removed from UI:', deleteResult.affectedRows);
      } else if (batches.length === 0) {
        const [deleteResult] = await db.promise().query(
          'DELETE FROM batches WHERE product_id = ?',
          [productId]
        );
        console.log('🗑️ No batches in request - deleted all batches:', deleteResult.affectedRows);
      }
    } else if (!data.maintain_batch) {
      // Delete all batches if maintain_batch is false
      const [deleteResult] = await db.promise().query(
        'DELETE FROM batches WHERE product_id = ?',
        [productId]
      );
      console.log('Maintain batch false - deleted all batches:', deleteResult.affectedRows);
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      id: productId,
      batchesUpdated,
      batchesInserted
    });
  } catch (err) {
    console.error('❌ Error updating product:', err);
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
    const [results] = await db.promise().query('SELECT * FROM products');
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
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ message: 'Failed to delete product' });
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

module.exports = router;