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



// router.post('/products', async (req, res) => {
//   const data = req.body;
// console.log("data",data)
//   try {
//     console.log('\n========== CREATE PRODUCT REQUEST ==========');
//     console.log('Maintain Batch:', data.maintain_batch);
//     console.log('Opening Stock:', data.opening_stock);
//     console.log('Batches count:', data.batches ? data.batches.length : 0);

//     // Calculate initial stock values
//     let openingStock = parseFloat(data.opening_stock || 0);
//     let stockIn = 0;
//     let stockOut = 0;
//     let balanceStock = openingStock;

//     // If product maintains batches, calculate from batches
//     if (data.maintain_batch && Array.isArray(data.batches) && data.batches.length > 0) {
//       const totalBatchQuantity = data.batches.reduce((total, batch) => {
//         return total + (parseFloat(batch.quantity) || 0);
//       }, 0);

//       openingStock = totalBatchQuantity;
//       balanceStock = totalBatchQuantity;

//       console.log('📊 Using batch-based stock calculation:', {
//         totalBatchQuantity,
//         openingStock,
//         balanceStock
//       });
//     }

//     const productData = {
//       ...data,
//       // opening_stock: openingStock,
//       // stock_in: stockIn,
//       // stock_out: stockOut,
//       // balance_stock: balanceStock,
//       created_at: new Date(),
//       updated_at: new Date()
//     };

//     const { batches, ...cleanProductData } = productData;

//     // Insert product
//     const columns = Object.keys(cleanProductData).join(', ');
//     const placeholders = Object.keys(cleanProductData).map(() => '?').join(', ');
//     const values = Object.values(cleanProductData);

//     const productSql = `INSERT INTO products (${columns}) VALUES (${placeholders})`;
//     const [productInsert] = await db.promise().query(productSql, values);

//     const productId = productInsert.insertId;

//     console.log('✅ Product created with stock:', {
//       productId,
//       opening_stock: openingStock,
//       stock_in: stockIn,
//       stock_out: stockOut,
//       balance_stock: balanceStock,
//       maintain_batch: data.maintain_batch
//     });

//     // Handle batches
//     if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
//       const batchValues = [];
//       let totalBatchQuantity = 0;

//       for (let index = 0; index < batches.length; index++) {
//         const batch = batches[index];
//         const batchQuantity = parseFloat(batch.quantity || 0);
//         totalBatchQuantity += batchQuantity;

//         let barcode = batch.barcode;
//         const timestamp = Date.now();
//         if (!barcode) {
//           barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
//         }

//         // Verify barcode uniqueness
//         const [barcodeCheck] = await db.promise().query(
//           'SELECT COUNT(*) as count FROM batches WHERE barcode = ?',
//           [barcode]
//         );

//         if (barcodeCheck[0].count > 0) {
//           barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
//         }

//         // Check if batch number already exists in the same group
//         const [batchNumberCheck] = await db.promise().query(
//           'SELECT COUNT(*) as count FROM batches WHERE batch_number = ? AND group_by = ?',
//           [batch.batch_number, data.group_by || 'Salescatalog']
//         );

//         if (batchNumberCheck[0].count > 0) {
//           return res.status(400).json({
//             success: false,
//             message: `Batch number "${batch.batch_number}" already exists in ${data.group_by || 'Salescatalog'}. Please use a unique batch number.`
//           });
//         }

//         // 🆕 Add new fields: opening_stock, stock_in, stock_out
//         const opening_stock_value = batch.opening_stock || batchQuantity;
//         const stock_in_value = batch.stock_in || 0;
//         const stock_out_value = batch.stock_out || 0;

//         batchValues.push([
//           productId,
//           batch.batch_number,
//           batch.mfg_date || batch.mfgDate || null,
//           batch.exp_date || batch.expDate || null,
//           batchQuantity,
//           opening_stock_value,
//           stock_in_value,
//           stock_out_value,
//           parseFloat(batch.selling_price || batch.sellingPrice) || 0,
//           parseFloat(batch.purchase_price || batch.purchasePrice) || 0,
//           parseFloat(batch.mrp) || 0,
//           parseFloat(batch.batch_price || batch.batchPrice) || 0,
//           barcode,
//           data.group_by || 'Salescatalog',
//           new Date(),
//           new Date()
//         ]);

//         console.log(`✅ Prepared batch: ${batch.batch_number} with quantity: ${batchQuantity}`);
//       }

//       // 🆕 Updated batch insert query (added new columns)
//       const batchSql = `
//         INSERT INTO batches 
//         (product_id, batch_number, mfg_date, exp_date, quantity, opening_stock, stock_in, stock_out, 
//          selling_price, purchase_price, mrp, batch_price, barcode, group_by, created_at, updated_at)
//         VALUES ?
//       `;
//       await db.promise().query(batchSql, [batchValues]);

//       console.log('✅ Batches created:', batches.length);
//     }

//     res.status(201).json({
//       success: true,
//       product_id: productId,
//       opening_stock: openingStock,
//       balance_stock: balanceStock
//     });
//   } catch (err) {
//     console.error('❌ Error creating product:', err);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create product',
//       error: err.message
//     });
//   }
// });


// routes.js
// router.post('/products', async (req, res) => {
//   const data = req.body;
//   let connection;

//   try {
//     connection = await new Promise((resolve, reject) => {
//       db.getConnection((err, conn) => {
//         if (err) reject(err);
//         else resolve(conn);
//       });
//     });

//     console.log('\n========== 🧾 CREATE PRODUCT REQUEST ==========');
//     console.log('Request Body:', data);

//     const {
//       group_by,
//       goods_name,
//       category_id,
//       company_id,
//       price,
//       inclusive_gst,
//       gst_rate,
//       non_taxable,
//       net_price,
//       hsn_code,
//       unit,
//       cess_rate,
//       cess_amount,
//       sku,
//       min_stock_alert,
//       max_stock_alert,
//       description,
//       maintain_batch,
//       opening_stock,
//       batch_number, // 🧩 from frontend if maintain_batch = true
//     } = data;

//     const now = new Date();

//     // 🔹 1️⃣ Insert Product
//     const insertProductQuery = `
//       INSERT INTO products (
//         group_by, goods_name, category_id, company_id, price,
//         inclusive_gst, gst_rate, non_taxable, net_price, hsn_code,
//         unit, cess_rate, cess_amount, sku, min_stock_alert, max_stock_alert,
//         description, maintain_batch, can_be_sold, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//     `;

//     const [productResult] = await connection.promise().query(insertProductQuery, [
//       group_by || 'Salescatalog',
//       goods_name,
//       category_id || null,
//       company_id || null,
//       price || 0,
//       inclusive_gst || 'Exclusive',
//       gst_rate || 0,
//       non_taxable || '',
//       net_price || 0,
//       hsn_code || '',
//       unit || 'Units',
//       cess_rate || '',
//       cess_amount || '',
//       sku || '',
//       min_stock_alert || 0,
//       max_stock_alert || 0,
//       description || '',
//       maintain_batch || false,
//       true,
//       now,
//       now,
//     ]);

//     const productId = productResult.insertId;
//     console.log(`✅ Product created with ID: ${productId}`);

//     // 🔹 2️⃣ Prepare Batch Data
//     const batchData = {
//       product_id: productId,
//       batch_number: maintain_batch ? batch_number || `BATCH-${Math.floor(1000 + Math.random() * 9000)}` : 'DEFAULT',
//       group_by: group_by || 'Salescatalog',
//       mfg_date: data.mfg_date || null,
//       exp_date: data.exp_date || null,
//       quantity: opening_stock || 0,
//       opening_stock: opening_stock || 0,
//       stock_in: 0,
//       stock_out: 0,
//       cost_price: price || 0,
//       selling_price: price || 0,
//       purchase_price: price || 0,
//       mrp: price || 0,
//       batch_price: price || 0,
//       barcode: maintain_batch
//         ? `${batch_number || 'BATCH'}-${Math.floor(100 + Math.random() * 900)}`
//         : `DEFAULT-${Math.floor(100 + Math.random() * 900)}`,
//       created_at: now,
//       updated_at: now,
//     };

//     console.log('🔹 Batch Data to Insert:', batchData);

//     // 🔹 3️⃣ Insert into Batches Table
//     const insertBatchQuery = `
//       INSERT INTO batches (
//         product_id, batch_number, group_by, mfg_date, exp_date,
//         quantity, opening_stock, stock_in, stock_out, cost_price,
//         selling_price, purchase_price, mrp, batch_price, barcode,
//         created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//     `;

//     await connection.promise().query(insertBatchQuery, [
//       batchData.product_id,
//       batchData.batch_number,
//       batchData.group_by,
//       batchData.mfg_date,
//       batchData.exp_date,
//       batchData.quantity,
//       batchData.opening_stock,
//       batchData.stock_in,
//       batchData.stock_out,
//       batchData.cost_price,
//       batchData.selling_price,
//       batchData.purchase_price,
//       batchData.mrp,
//       batchData.batch_price,
//       batchData.barcode,
//       batchData.created_at,
//       batchData.updated_at,
//     ]);

//     console.log(`✅ Batch inserted (${batchData.batch_number}) successfully`);

//     res.status(201).json({
//       success: true,
//       message: 'Product and batch created successfully.',
//       productId,
//       batchNumber: batchData.batch_number,
//     });
//   } catch (error) {
//     console.error('❌ Error creating product:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error creating product and batch.',
//       error: error.message,
//     });
//   } finally {
//     if (connection) connection.release();
//   }
// });



router.post('/products', async (req, res) => {
  const data = req.body;
  console.log("📦 Incoming Product Data:", data);

  try {
    console.log('\n========== CREATE PRODUCT REQUEST ==========');
    console.log('Maintain Batch:', data.maintain_batch);
    console.log('Opening Stock:', data.opening_stock);
    console.log('Batches Count:', data.batches ? data.batches.length : 0);

    // Prepare timestamps
    const now = new Date();

    // Prepare clean product data (only valid columns for `products`)
    const {
      batches, // remove batches before inserting product
      opening_stock,
      stock_in,
      stock_out,
      balance_stock,
      opening_stock_date,
      ...cleanProduct
    } = data;

    const productData = {
      ...cleanProduct,
      created_at: now,
      updated_at: now,
    };

    // Insert product into `products`
    const productColumns = Object.keys(productData).join(", ");
    const placeholders = Object.keys(productData).map(() => "?").join(", ");
    const productValues = Object.values(productData);

    const productSql = `INSERT INTO products (${productColumns}) VALUES (${placeholders})`;
    const [productInsert] = await db.promise().query(productSql, productValues);

    const productId = productInsert.insertId;
    console.log("✅ Product Created:", productId);

    // ========== Handle Batches ==========
    if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
      // If product maintains batches
      const batchValues = [];

      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        const quantity = parseFloat(batch.quantity || 0);
        const barcode =
          batch.barcode ||
          `B${Date.now()}${index}${Math.random().toString(36).substr(2, 5)}`;

        batchValues.push([
          productId,
          batch.batch_number,
          data.group_by || "Salescatalog",
          batch.mfg_date || null,
          batch.exp_date || null,
          quantity,
          parseFloat(batch.opening_stock || quantity),
          parseFloat(batch.stock_in || 0),
          parseFloat(batch.stock_out || 0),
          parseFloat(batch.cost_price || 0),
          parseFloat(batch.selling_price || 0),
          parseFloat(batch.purchase_price || 0),
          parseFloat(batch.mrp || 0),
          parseFloat(batch.batch_price || 0),
          barcode,
          now,
          now,
        ]);
      }

      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, group_by, mfg_date, exp_date, quantity, opening_stock, stock_in, stock_out, 
         cost_price, selling_price, purchase_price, mrp, batch_price, barcode, created_at, updated_at)
        VALUES ?
      `;
      await db.promise().query(batchSql, [batchValues]);

      console.log("✅ Batches Inserted:", batchValues.length);
    } else {
      // If maintain_batch = false, create a default batch
      const openingStock = parseFloat(data.opening_stock || 0);
      const stockIn = 0;
      const stockOut = parseFloat(data.stock_out || 0);
      const balanceStock = openingStock + stockIn - stockOut;

      const barcode = `DEF${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

      const defaultBatch = [
        productId,
        "DEFAULT",
        data.group_by || "Salescatalog",
        null, // mfg_date
        null, // exp_date
        balanceStock,
        openingStock,
        stockIn,
        stockOut,
        0, // cost_price
        parseFloat(data.price || 0), // selling_price
        0, // purchase_price
        parseFloat(data.price || 0), // mrp
        parseFloat(data.price || 0), // batch_price
        barcode,
        now,
        now,
      ];

      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, group_by, mfg_date, exp_date, quantity, opening_stock, stock_in, stock_out, 
         cost_price, selling_price, purchase_price, mrp, batch_price, barcode, created_at, updated_at)
        VALUES (?)
      `;
      await db.promise().query(batchSql, [defaultBatch]);

      console.log("✅ Default batch created for non-batch product:", {
        productId,
        openingStock,
        balanceStock,
      });
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      product_id: productId,
    });
  } catch (err) {
    console.error("❌ Error creating product:", err);
    res.status(500).json({
      success: false,
      message: "Failed to create product",
      error: err.message,
    });
  }
});


router.put('/products/:id', async (req, res) => {
  const productId = req.params.id;
  const data = req.body;
  const { batches, ...productData } = data;

  console.log('\n========== UPDATE PRODUCT REQUEST ==========');
  console.log('Product ID:', productId);
  console.log('Maintain Batch:', data.maintain_batch);
  console.log('Batches received:', batches ? batches.length : 0);

  try {
    // ✅ Update main product info
    const allowedProductFields = [
      'group_by', 'goods_name', 'category_id', 'company_id',
      'price', 'inclusive_gst', 'gst_rate', 'non_taxable', 'net_price',
      'hsn_code', 'unit', 'cess_rate', 'cess_amount', 'sku',
      'min_stock_alert', 'max_stock_alert', 'description',
      'maintain_batch', 'can_be_sold'
    ];

    const filteredProductData = {};
    for (const key of allowedProductFields) {
      if (productData[key] !== undefined) filteredProductData[key] = productData[key];
    }

    if (Object.keys(filteredProductData).length > 0) {
      filteredProductData.updated_at = new Date();

      const updateFields = Object.keys(filteredProductData)
        .map(k => `${k} = ?`)
        .join(', ');
      const updateValues = Object.values(filteredProductData);

      const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
      await db.promise().query(updateSql, [...updateValues, productId]);
      console.log('✅ Product basic info updated');
    }

    // ✅ Batch Handling
    if (data.maintain_batch && Array.isArray(batches)) {
      console.log('\n========== PROCESSING BATCHES ==========');

      const [existingBatches] = await db.promise().query(
        'SELECT * FROM batches WHERE product_id = ?',
        [productId]
      );

      const processedBatchIds = [];

      for (const [index, batch] of batches.entries()) {
        let barcode = batch.barcode;
        if (!barcode) {
          const timestamp = Date.now();
          barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
        }

        const batchData = {
          batch_number: batch.batch_number,
          group_by: data.group_by || 'Salescatalog',
          mfg_date: batch.mfg_date || batch.mfgDate || null,
          exp_date: batch.exp_date || batch.expDate || null,
          quantity: parseFloat(batch.quantity || 0),
          opening_stock: parseFloat(batch.opening_stock || batch.quantity || 0),
          stock_in: parseFloat(batch.stock_in || 0),
          stock_out: parseFloat(batch.stock_out || 0),
          cost_price: parseFloat(batch.cost_price || 0),
          selling_price: parseFloat(batch.selling_price || 0),
          purchase_price: parseFloat(batch.purchase_price || 0),
          mrp: parseFloat(batch.mrp || 0),
          batch_price: parseFloat(batch.batch_price || 0),
          barcode,
          updated_at: new Date()
        };

        console.log('🔹 Batch Data:', batchData);

        const hasValidId = batch.id && !batch.id.toString().includes('temp_');
        const isExisting = batch.isExisting && hasValidId;

        if (isExisting) {
          const updateSql = `
            UPDATE batches SET 
              batch_number = ?, group_by = ?, mfg_date = ?, exp_date = ?, quantity = ?, 
              opening_stock = ?, stock_in = ?, stock_out = ?, cost_price = ?, selling_price = ?, 
              purchase_price = ?, mrp = ?, batch_price = ?, barcode = ?, updated_at = ?
            WHERE id = ?
          `;
          const values = [
            batchData.batch_number, batchData.group_by,
            batchData.mfg_date, batchData.exp_date, batchData.quantity,
            batchData.opening_stock, batchData.stock_in, batchData.stock_out,
            batchData.cost_price, batchData.selling_price, batchData.purchase_price,
            batchData.mrp, batchData.batch_price, batchData.barcode, batchData.updated_at,
            parseInt(batch.id)
          ];
          await db.promise().query(updateSql, values);
          processedBatchIds.push(parseInt(batch.id));
          console.log('✅ Updated batch:', batch.id);
        } else {
          const insertSql = `
            INSERT INTO batches (
              product_id, batch_number, group_by, mfg_date, exp_date, quantity, opening_stock, 
              stock_in, stock_out, cost_price, selling_price, purchase_price, mrp, batch_price, 
              barcode, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          const values = [
            productId, batchData.batch_number, batchData.group_by,
            batchData.mfg_date, batchData.exp_date, batchData.quantity,
            batchData.opening_stock, batchData.stock_in, batchData.stock_out,
            batchData.cost_price, batchData.selling_price, batchData.purchase_price,
            batchData.mrp, batchData.batch_price, batchData.barcode,
            new Date(), batchData.updated_at
          ];
          const [result] = await db.promise().query(insertSql, values);
          processedBatchIds.push(result.insertId);
          console.log('✅ Inserted new batch ID:', result.insertId);
        }
      }

      if (processedBatchIds.length > 0) {
        const placeholders = processedBatchIds.map(() => '?').join(',');
        await db.promise().query(
          `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
          [productId, ...processedBatchIds]
        );
      }

    } else {
      // ✅ Maintain batch = false → ensure DEFAULT batch exists
      console.log('\n⚙️ Maintain batch = FALSE → Using default batch');

      const [existingDefault] = await db.promise().query(
        'SELECT * FROM batches WHERE product_id = ? AND batch_number = "DEFAULT"',
        [productId]
      );

      const openingStockValue = parseFloat(data.opening_stock || data.quantity || 0);
      const batchData = {
        batch_number: 'DEFAULT',
        group_by: data.group_by || 'Salescatalog',
        mfg_date: null,
        exp_date: null,
        quantity: openingStockValue,
        opening_stock: openingStockValue,
        stock_in: 0,
        stock_out: 0,
        cost_price: parseFloat(data.price || 0),
        selling_price: parseFloat(data.price || 0),
        purchase_price: parseFloat(data.price || 0),
        mrp: parseFloat(data.price || 0),
        batch_price: parseFloat(data.price || 0),
        barcode: 'DEFAULT-123',
        updated_at: new Date()
      };

      console.log('🔹 Default Batch Data:', batchData);

      if (existingDefault.length > 0) {
        const updateSql = `
          UPDATE batches SET 
            quantity = ?, opening_stock = ?, cost_price = ?, selling_price = ?, 
            purchase_price = ?, mrp = ?, batch_price = ?, updated_at = ?
          WHERE product_id = ? AND batch_number = "DEFAULT"
        `;
        const values = [
          batchData.quantity, batchData.opening_stock,
          batchData.cost_price, batchData.selling_price,
          batchData.purchase_price, batchData.mrp,
          batchData.batch_price, batchData.updated_at,
          productId
        ];
        await db.promise().query(updateSql, values);
        console.log('🔄 Updated DEFAULT batch');
      } else {
        const insertSql = `
          INSERT INTO batches (
            product_id, batch_number, group_by, mfg_date, exp_date, quantity, opening_stock,
            stock_in, stock_out, cost_price, selling_price, purchase_price, mrp, batch_price,
            barcode, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
          productId, batchData.batch_number, batchData.group_by,
          batchData.mfg_date, batchData.exp_date, batchData.quantity,
          batchData.opening_stock, batchData.stock_in, batchData.stock_out,
          batchData.cost_price, batchData.selling_price, batchData.purchase_price,
          batchData.mrp, batchData.batch_price, batchData.barcode,
          new Date(), batchData.updated_at
        ];
        await db.promise().query(insertSql, values);
        console.log('✅ Inserted DEFAULT batch');
      }
    }

    console.log('\n✅ UPDATE COMPLETED SUCCESSFULLY\n');
    res.json({ success: true, message: 'Product updated successfully', id: productId });

  } catch (err) {
    console.error('❌ Error updating product:', err);
    res.status(500).json({ success: false, message: 'Failed to update product', error: err.message });
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
    // await db.promise().query('DELETE FROM stock WHERE product_id = ?', [productId]);
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
        p.min_stock_alert,
        p.max_stock_alert,
        p.description,
        p.maintain_batch,
        p.can_be_sold,
        p.created_at,
        p.updated_at,
        b.id AS batch_id,
        b.batch_number,
        b.group_by AS batch_group_by,
        b.mfg_date,
        b.exp_date,
        b.quantity,
        b.opening_stock AS batch_opening_stock,
        b.stock_in AS batch_stock_in,
        b.stock_out AS batch_stock_out,
        (b.opening_stock + b.stock_in - b.stock_out) AS current_stock,
        b.cost_price,
        b.selling_price,
        b.purchase_price,
        b.mrp,
        b.batch_price,
        b.barcode,
        b.created_at AS batch_created_at,
        b.updated_at AS batch_updated_at
      FROM products p
      LEFT JOIN batches b ON p.id = b.product_id
      WHERE p.id = ?
      ORDER BY b.created_at DESC
    `;

    const [results] = await db.promise().query(query, [req.params.id]);

    if (results.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Map batches uniquely
    const batches = results
      .filter(row => row.batch_id !== null)
      .reduce((unique, row) => {
        if (!unique.find(b => b.id === row.batch_id)) {
          unique.push({
            id: row.batch_id,
            batch_number: row.batch_number,
            group_by: row.batch_group_by,
            mfg_date: row.mfg_date,
            exp_date: row.exp_date,
            quantity: row.quantity,
            opening_stock: row.batch_opening_stock,
            stock_in: row.batch_stock_in,
            stock_out: row.batch_stock_out,
            current_stock: row.current_stock,
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
      }, []);

    const product = {
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
      min_stock_alert: results[0].min_stock_alert,
      max_stock_alert: results[0].max_stock_alert,
      description: results[0].description,
      maintain_batch: results[0].maintain_batch,
      can_be_sold: results[0].can_be_sold,
      created_at: results[0].created_at,
      updated_at: results[0].updated_at,
      batches
    };

    res.json(product);
  } catch (err) {
    console.error('❌ Error fetching product with batches:', err);
    res.status(500).json({ message: 'Failed to fetch product with batches', error: err.message });
  }
});


// Get vouchers by product_id
router.get("/vouchers/by-product/:product_id", (req, res) => {
  const productId = req.params.product_id;

  if (!productId) {
    return res.status(400).send({ error: "Product ID is required" });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error("Database connection error:", err);
      return res.status(500).send({ error: "Database connection failed" });
    }

    // Query joins voucher and voucherdetails
    const query = `
      SELECT 
        v.*,
        vd.id AS detail_id,
        vd.quantity AS detail_quantity,
        vd.total AS detail_total,
        vd.batch AS detail_batch,
        vd.product_id AS detail_product_id
      FROM voucher v
      INNER JOIN voucherdetails vd ON v.VoucherID = vd.voucher_id
      WHERE vd.product_id = ?
      ORDER BY v.Date DESC, v.EntryDate DESC
    `;

    connection.query(query, [productId], (err, results) => {
      connection.release();

      if (err) {
        console.error("Database query error:", err);
        return res.status(500).send({ error: "Failed to fetch vouchers", details: err.message });
      }

      // Group vouchers by VoucherID
      const grouped = {};

      results.forEach(row => {
        if (!grouped[row.VoucherID]) {
          grouped[row.VoucherID] = {
            ...row,
            batchDetails: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
        }

        // Push voucherdetails record
        grouped[row.VoucherID].batchDetails.push({
          id: row.detail_id,
          product_id: row.detail_product_id,
          batch: row.detail_batch,
          quantity: row.detail_quantity,
          total: row.detail_total
        });

        // Add totals
        grouped[row.VoucherID].totalQuantity += parseFloat(row.detail_quantity || 0);
        grouped[row.VoucherID].totalAmount += parseFloat(row.detail_total || 0);
      });

      const finalVouchers = Object.values(grouped);

      res.send({
        success: true,
        productId,
        totalVouchers: finalVouchers.length,
        vouchers: finalVouchers
      });
    });
  });
});


router.get('/get-sales-products', async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT 
        p.id,
        p.goods_name,
        p.group_by,
        p.price,
        p.unit,
        p.category_id,
        p.gst_rate,
        p.inclusive_gst,
        c.category_name
      FROM products p
      LEFT JOIN categories c 
        ON p.category_id = c.id
      WHERE p.group_by = 'Salescatalog'
      ORDER BY p.created_at DESC
    `);

    const products = rows.map(item => ({
      id: item.id,
      name: item.goods_name,
      supplier: item.group_by,
      price: item.price,
      unit: item.unit,
      category_id: item.category_id,
      category: item.category_name ,
      gst_rate: item.gst_rate,
      inclusive_gst: item.inclusive_gst   // ⭐ added
    }));

    res.json(products);

  } catch (err) {
    console.error('Error fetching products with category:', err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});




module.exports = router;