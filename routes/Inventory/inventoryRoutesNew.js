const express = require('express');
const router = express.Router();
const db = require('./../../db');

router.get('/batches/check-batch-number', async (req, res) => {
  const { batch_number, group_by, product_id } = req.query;
  
  try {
    let query = `
      SELECT COUNT(*) as count FROM batches 
      WHERE batch_number = ? AND group_by = ?
    `;
    let params = [batch_number, group_by];

    // If product_id is provided, exclude current product's batches (for updates)
    if (product_id) {
      query += ' AND product_id != ?';
      params.push(product_id);
    }

    const [result] = await db.promise().query(query, params);
    
    res.json({
      exists: result[0].count > 0
    });
  } catch (err) {
    console.error('Error checking batch number:', err);
    res.status(500).json({
      success: false,
      message: 'Error checking batch number',
      error: err.message
    });
  }
});
// Create a new product (FIXED VERSION)
// Create a new product (FIXED VERSION - No auto-increment)
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

        // Check if batch number already exists in the same group
        const [batchNumberCheck] = await db.promise().query(
          'SELECT COUNT(*) as count FROM batches WHERE batch_number = ? AND group_by = ?',
          [batch.batch_number, data.group_by || 'Salescatalog']
        );

        if (batchNumberCheck[0].count > 0) {
          return res.status(400).json({
            success: false,
            message: `Batch number "${batch.batch_number}" already exists in ${data.group_by || 'Salescatalog'}. Please use a unique batch number.`
          });
        }
        
        batchValues.push([
          productId,
          batch.batch_number, // Use the manually entered batch number
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

        console.log(`✅ Prepared batch: ${batch.batch_number} with quantity: ${batchQuantity}`);
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
// Update a product (FIXED VERSION - No auto-increment)
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

        // Check for duplicate batch numbers for NEW batches
        if (!batch.isExisting) {
          const [batchNumberCheck] = await db.promise().query(
            'SELECT COUNT(*) as count FROM batches WHERE batch_number = ? AND group_by = ? AND product_id != ?',
            [batch.batch_number, data.group_by || 'Salescatalog', productId]
          );

          if (batchNumberCheck[0].count > 0) {
            return res.status(400).json({
              success: false,
              message: `Batch number "${batch.batch_number}" already exists in ${data.group_by || 'Salescatalog'}. Please use a unique batch number.`
            });
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
          // INSERT new batch - use manually entered batch number
          console.log('➕ INSERTING NEW batch with number:', batch.batch_number);
          
          const insertSql = `
            INSERT INTO batches 
            (product_id, batch_number, mfg_date, exp_date, quantity,  
             selling_price, purchase_price, mrp, batch_price, barcode, group_by, 
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          const insertValues = [
            productId,
            batch.batch_number, // Use manually entered batch number
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

// Get products by category ID
router.get('/products/category/:category_id', async (req, res) => {
  const categoryId = req.params.category_id;
  
  console.log('🔍 Fetching products for category ID:', categoryId);
  
  try {
    const [results] = await db.promise().query(
      'SELECT * FROM products WHERE category_id = ? ORDER BY goods_name ASC',
      [categoryId]
    );
    
    console.log('✅ Products found:', results.length);
    console.log('📦 Products data:', results);
    
    res.json(results);
  } catch (err) {
    console.error('❌ Error fetching products by category:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch products by category', 
      error: err.message 
    });
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



router.get('/products/:id/with-batches', async (req, res) => {
  try {
    // Query to get product details, batches, and stock data
    const query = `
      SELECT 
        p.id,
        p.group_by,
        p.goods_name,
        p.category_id,
        p.company_id,
        p.price,
        p.inclusive_gst,
        p.gst_rate,
        p.non_taxable,
        p.net_price,
        p.hsn_code,
        p.unit,
        p.cess_rate,
        p.cess_amount,
        p.sku,
        p.opening_stock,
        p.stock_in,
        p.stock_out,
        p.balance_stock,
        p.opening_stock_date,
        p.min_stock_alert,
        p.max_stock_alert,
        p.description,
        p.maintain_batch,
        p.can_be_sold,
        p.created_at,
        p.updated_at,
        b.id as batch_id,
        b.batch_number as batch_batch_number,
        b.group_by as batch_group_by,
        b.mfg_date,
        b.exp_date,
        b.quantity as batch_quantity,
        b.cost_price,
        b.selling_price,
        b.purchase_price,
        b.mrp,
        b.batch_price,
        b.barcode,
        b.created_at as batch_created_at,
        b.updated_at as batch_updated_at,
        s.id as stock_id,
        s.product_id as stock_product_id,
        s.price_per_unit,
        s.opening_stock as stock_opening_stock,
        s.stock_in as stock_stock_in,
        s.stock_out as stock_stock_out,
        s.balance_stock as stock_balance_stock,
        s.batch_number as stock_batch_number,
        s.voucher_id,
        s.date
      FROM products p
      LEFT JOIN batches b ON p.id = b.product_id
      LEFT JOIN stock s ON p.id = s.product_id
      WHERE p.id = ?
      ORDER BY b.created_at DESC, s.date DESC
    `;
    
    const [results] = await db.promise().query(query, [req.params.id]);
    
    // If no product found
    if (results.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Get unique stock records to avoid duplicates from JOIN
    const uniqueStocks = [];
    const seenStockIds = new Set();
    
    results.forEach(row => {
      if (row.stock_id && !seenStockIds.has(row.stock_id)) {
        seenStockIds.add(row.stock_id);
        uniqueStocks.push({
          id: row.stock_id,
          product_id: row.stock_product_id,
          price_per_unit: row.price_per_unit,
          opening_stock: row.stock_opening_stock,
          stock_in: row.stock_stock_in,
          stock_out: row.stock_stock_out,
          balance_stock: row.stock_balance_stock,
          batch_number: row.stock_batch_number,
          voucher_id: row.voucher_id,
          date: row.date
        });
      }
    });
    
    // Structure the response
    const response = {
      id: results[0].id,
      group_by: results[0].group_by,
      goods_name: results[0].goods_name,
      category_id: results[0].category_id,
      company_id: results[0].company_id,
      price: results[0].price,
      inclusive_gst: results[0].inclusive_gst,
      gst_rate: results[0].gst_rate,
      non_taxable: results[0].non_taxable,
      net_price: results[0].net_price,
      hsn_code: results[0].hsn_code,
      unit: results[0].unit,
      cess_rate: results[0].cess_rate,
      cess_amount: results[0].cess_amount,
      sku: results[0].sku,
      opening_stock: results[0].opening_stock,
      stock_in: results[0].stock_in,
      stock_out: results[0].stock_out,
      balance_stock: results[0].balance_stock,
      opening_stock_date: results[0].opening_stock_date,
      min_stock_alert: results[0].min_stock_alert,
      max_stock_alert: results[0].max_stock_alert,
      description: results[0].description,
      maintain_batch: results[0].maintain_batch,
      can_be_sold: results[0].can_be_sold,
      created_at: results[0].created_at,
      updated_at: results[0].updated_at,
      batches: results.filter(row => row.batch_id !== null)
        .reduce((unique, row) => {
          if (!unique.find(b => b.id === row.batch_id)) {
            unique.push({
              id: row.batch_id,
              batch_number: row.batch_batch_number,
              group_by: row.batch_group_by,
              mfg_date: row.mfg_date,
              exp_date: row.exp_date,
              quantity: row.batch_quantity,
              cost_price: row.cost_price,
              selling_price: row.selling_price,
              purchase_price: row.purchase_price,
              mrp: row.mrp,
              batch_price: row.batch_price,
              barcode: row.barcode,
              created_at: row.batch_created_at,
              updated_at: row.batch_updated_at
            });
          }
          return unique;
        }, []),
      stock: uniqueStocks
    };
    
    res.json(response);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ message: 'Failed to fetch product' });
  }
});
module.exports = router;