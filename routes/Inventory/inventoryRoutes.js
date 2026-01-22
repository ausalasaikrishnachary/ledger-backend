const express = require('express');
const router = express.Router();
const db = require('./../../db');

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/products/';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});


// Upload images route
router.post('/products/:id/upload-images', upload.array('images', 10), async (req, res) => {
  try {
    const productId = req.params.id;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    // Get existing images
    const [existingProduct] = await db.promise().query(
      'SELECT images FROM products WHERE id = ?',
      [productId]
    );

    let existingImages = [];
    if (existingProduct[0]?.images) {
      try {
        existingImages = JSON.parse(existingProduct[0].images);
      } catch (e) {
        existingImages = [];
      }
    }

    // Add new images
    const newImages = req.files.map(file => `/uploads/products/${file.filename}`);
    const allImages = [...existingImages, ...newImages];

    // Update product with new images array
    await db.promise().query(
      'UPDATE products SET images = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(allImages), new Date(), productId]
    );

    res.json({
      success: true,
      message: 'Images uploaded successfully',
      images: allImages
    });

  } catch (err) {
    console.error('Error uploading images:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to upload images',
      error: err.message
    });
  }
});

// Delete image route
router.delete('/products/:id/image', async (req, res) => {
  try {
    const productId = req.params.id;
    const { imagePath } = req.body;

    // Get current images
    const [product] = await db.promise().query(
      'SELECT images FROM products WHERE id = ?',
      [productId]
    );

    if (!product[0]) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    let images = [];
    try {
      images = JSON.parse(product[0].images || '[]');
    } catch (e) {
      images = [];
    }

    // Remove image from array
    const updatedImages = images.filter(img => img !== imagePath);

    // Update database
    await db.promise().query(
      'UPDATE products SET images = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(updatedImages), new Date(), productId]
    );

    // Delete physical file
    if (imagePath.startsWith('/uploads/')) {
      const filePath = imagePath.substring(1); // Remove leading slash
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.json({
      success: true,
      message: 'Image deleted successfully',
      images: updatedImages
    });

  } catch (err) {
    console.error('Error deleting image:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image',
      error: err.message
    });
  }
});

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
//       min_sale_price: price || 0,
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
//         quantity, opening_stock, stock_in, stock_out, min_sale_price,
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
//       batchData.min_sale_price,
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
  console.log("📦 Incoming Product Data:", JSON.stringify(data, null, 2));

  // Handle images if provided
  let imagesArray = [];
  if (data.images && Array.isArray(data.images)) {
    imagesArray = data.images;
  }

  try {
    console.log('\n========== CREATE PRODUCT REQUEST ==========');
    console.log('Maintain Batch:', data.maintain_batch);
    console.log('Product Type:', data.product_type);
    console.log('Price (from frontend):', data.price);
    console.log('Purchase Price:', data.purchase_price);
    console.log('MRP:', data.mrp);
    console.log('Opening Stock:', data.opening_stock);
    console.log('Batches Count:', data.batches ? data.batches.length : 0);

    // Prepare timestamps
    const now = new Date();

    // Prepare clean product data
    const {
      batches,
      opening_stock,
      stock_in,
      stock_out,
      balance_stock,
      opening_stock_date,
      ...cleanProduct
    } = data;

    const productData = {
      ...cleanProduct,
      unit: data.unit,
      product_type: data.product_type || null,
      price: data.price || 0,
      purchase_price: data.purchase_price || 0,
      mrp: data.mrp || 0,
      images: JSON.stringify(imagesArray),
      created_at: now,
      updated_at: now,
    };

    console.log('📊 Product data for DB insertion:', {
      product_type: productData.product_type,
      price: productData.price,
      purchase_price: productData.purchase_price,
      mrp: productData.mrp,
      maintain_batch: productData.maintain_batch
    });

    // Insert product into `products`
    const productColumns = Object.keys(productData).join(", ");
    const placeholders = Object.keys(productData).map(() => "?").join(", ");
    const productValues = Object.values(productData);

    const productSql = `INSERT INTO products (${productColumns}) VALUES (${placeholders})`;
    const [productInsert] = await db.promise().query(productSql, productValues);

    const productId = productInsert.insertId;
    console.log("✅ Product Created with ID:", productId);

    // Get product values for batches
    const productPrice = parseFloat(data.price || 0);
    const productMRP = parseFloat(data.mrp || 0);
    const productPurchasePrice = parseFloat(data.purchase_price || 0);
    const productOpeningStock = parseFloat(data.opening_stock || 0);
    const productType = data.product_type || null;

    console.log('💰 Values for batches:', {
      productPrice,
      productMRP,
      productPurchasePrice,
      productOpeningStock,
      productType
    });

    // ========== Handle Batches ==========
    if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
      console.log('📦 Creating batches for maintain_batch=true');
      
      const batchValues = [];

      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        
        // Calculate quantity from opening stock
        const openingStock = parseFloat(batch.opening_stock || batch.quantity || productOpeningStock || 0);
        const stockIn = parseFloat(batch.stock_in || 0);
        const stockOut = parseFloat(batch.stock_out || 0);
        const quantity = openingStock + stockIn - stockOut;

        const barcode = batch.barcode || `B${Date.now()}${index}${Math.random().toString(36).substr(2, 5)}`;

        // Use batch prices if available, otherwise use product prices
        const batchSellingPrice = parseFloat(batch.selling_price || batch.sellingPrice || productPrice || 0);
        const batchMRP = parseFloat(batch.mrp || productMRP || 0);
        const batchPurchasePrice = parseFloat(batch.purchase_price || batch.purchasePrice || productPurchasePrice || 0);
        const batchMinSalePrice = parseFloat(batch.min_sale_price || 0);

        console.log(`📦 Batch ${index + 1} data:`, {
          batchNumber: batch.batch_number,
          openingStock,
          quantity,
          selling_price: batchSellingPrice,
          mrp: batchMRP,
          purchase_price: batchPurchasePrice,
          product_type: productType
        });

        batchValues.push([
          productId,
          batch.batch_number,
          data.group_by || "Salescatalog",
          batch.mfg_date || batch.mfgDate || null,
          batch.exp_date || batch.expDate || null,
          productType, // product_type comes HERE, after exp_date
          quantity,
          openingStock,
          stockIn,
          stockOut,
          parseFloat(batch.cost_price || 0),
          batchSellingPrice,
          batchPurchasePrice,
          batchMRP,
          batchMinSalePrice,
          batchSellingPrice,
          barcode,
          batch.remark || '',
          now,
          now,
        ]);
      }

      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, group_by, mfg_date, exp_date, product_type, quantity, opening_stock, 
         stock_in, stock_out, cost_price, selling_price, purchase_price, mrp, min_sale_price, 
         batch_price, barcode, remark, created_at, updated_at)
        VALUES ?
      `;
      await db.promise().query(batchSql, [batchValues]);

      console.log("✅ Batches Inserted:", batchValues.length);
      console.log("✅ Product Type in batches:", productType);
      
    } else {
      // If maintain_batch = false, create a default batch
      console.log('📦 Creating DEFAULT batch for maintain_batch=false');
      
      const openingStock = parseFloat(data.opening_stock || 0);
      const stockIn = 0;
      const stockOut = 0;
      const quantity = openingStock + stockIn - stockOut;

      const barcode = `DEF${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

      console.log('📦 Default batch data:', {
        productId,
        openingStock,
        quantity,
        selling_price: productPrice,
        mrp: productMRP,
        purchase_price: productPurchasePrice,
        product_type: productType
      });

      const defaultBatch = [
        productId,
        "DEFAULT",
        data.group_by || "Salescatalog",
        null,
        null,
        productType, // product_type comes HERE, after exp_date
        quantity,
        openingStock,
        stockIn,
        stockOut,
        0,
        productPrice,
        productPurchasePrice,
        productMRP,
        parseFloat(data.min_sale_price || 0),
        productPrice,
        barcode,
        '',
        now,
        now,
      ];

      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, group_by, mfg_date, exp_date, product_type, quantity, opening_stock, 
         stock_in, stock_out, cost_price, selling_price, purchase_price, mrp, min_sale_price, 
         batch_price, barcode, remark, created_at, updated_at)
        VALUES (?)
      `;
      await db.promise().query(batchSql, [defaultBatch]);

      console.log("✅ Default batch created for non-batch product");
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      product_id: productId,
      product_type: productType,
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
  console.log('Product Type:', data.product_type);
  console.log('Opening stock from request (batches only):', data.opening_stock);

  try {
    // ✅ First, fetch existing product
    const [existingProduct] = await db.promise().query(
      'SELECT * FROM products WHERE id = ?',
      [productId]
    );

    if (existingProduct.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const existing = existingProduct[0];
    
    // ✅ Update main product info
    const updateData = {
      group_by: data.group_by || existing.group_by,
      goods_name: data.goods_name || existing.goods_name,
      category_id: data.category_id || existing.category_id,
      company_id: data.company_id || existing.company_id,
      price: data.price || existing.price,
      purchase_price: data.purchase_price || existing.purchase_price,
      mrp: data.mrp || existing.mrp,
      inclusive_gst: data.inclusive_gst || existing.inclusive_gst,
      gst_rate: data.gst_rate || existing.gst_rate,
      non_taxable: data.non_taxable || existing.non_taxable,
      net_price: data.net_price || existing.net_price,
      hsn_code: data.hsn_code || existing.hsn_code,
      unit: data.unit || existing.unit_id,
      cess_rate: data.cess_rate || existing.cess_rate,
      cess_amount: data.cess_amount || existing.cess_amount,
      sku: data.sku || existing.sku,
      min_stock_alert: data.min_stock_alert || existing.min_stock_alert,
      max_stock_alert: data.max_stock_alert || existing.max_stock_alert,
      description: data.description || existing.description,
      maintain_batch: data.maintain_batch !== undefined ? data.maintain_batch : existing.maintain_batch,
      can_be_sold: data.can_be_sold !== undefined ? data.can_be_sold : existing.can_be_sold,
      min_sale_price: data.min_sale_price || existing.min_sale_price,
      product_type: data.product_type || existing.product_type || null,
      updated_at: new Date()
    };

    console.log('📊 Update data for products table:', {
      product_type: updateData.product_type,
      price: updateData.price,
      purchase_price: updateData.purchase_price,
      mrp: updateData.mrp,
      maintain_batch: updateData.maintain_batch
    });

    // Update product
    const updateFields = Object.keys(updateData)
      .map(k => `${k} = ?`)
      .join(', ');
    const updateValues = Object.values(updateData);

    const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
    await db.promise().query(updateSql, [...updateValues, productId]);
    console.log('✅ Product basic info updated');

    // Handle images
    if (data.images !== undefined) {
      await db.promise().query(
        'UPDATE products SET images = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(data.images), new Date(), productId]
      );
      console.log('✅ Images updated');
    }

    // Get current values
    const currentPrice = parseFloat(data.price || existing.price || 0);
    const currentMRP = parseFloat(data.mrp || existing.mrp || 0);
    const currentPurchasePrice = parseFloat(data.purchase_price || existing.purchase_price || 0);
    const requestOpeningStock = parseFloat(data.opening_stock || 0);
    const currentProductType = data.product_type || existing.product_type || null;

    console.log('💰 Current values:', {
      currentPrice,
      currentMRP,
      currentPurchasePrice,
      requestOpeningStock,
      currentProductType
    });

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

        let openingStock;
        if (batch.opening_stock !== undefined && batch.opening_stock !== null && batch.opening_stock !== '') {
          openingStock = parseFloat(batch.opening_stock);
          console.log(`Using batch opening_stock from request: ${openingStock}`);
        } else if (batch.quantity !== undefined && batch.quantity !== null && batch.quantity !== '') {
          openingStock = parseFloat(batch.quantity);
          console.log(`Using batch quantity as opening_stock: ${openingStock}`);
        } else {
          openingStock = 0;
          console.log(`Using default opening_stock: ${openingStock}`);
        }

        // Calculate stock values
        const stockIn = parseFloat(batch.stock_in || 0);
        const stockOut = parseFloat(batch.stock_out || 0);
        const quantity = openingStock + stockIn - stockOut;

        // Get prices
        const batchSellingPrice = parseFloat(batch.selling_price || batch.sellingPrice || currentPrice || 0);
        const batchMRP = parseFloat(batch.mrp || currentMRP || 0);
        const batchPurchasePrice = parseFloat(batch.purchase_price || batch.purchasePrice || currentPurchasePrice || 0);
        const batchMinSalePrice = parseFloat(batch.min_sale_price || 0);

        console.log(`🔹 Batch ${index + 1} "${batch.batch_number}" data:`, {
          openingStock,
          quantity,
          selling_price: batchSellingPrice,
          mrp: batchMRP,
          purchase_price: batchPurchasePrice,
          product_type: currentProductType,
          isExisting: batch.isExisting
        });

        const batchData = {
          batch_number: batch.batch_number,
          group_by: data.group_by || existing.group_by || 'Salescatalog',
          mfg_date: batch.mfg_date || batch.mfgDate || null,
          exp_date: batch.exp_date || batch.expDate || null,
          quantity: quantity,
          opening_stock: openingStock,
          stock_in: stockIn,
          stock_out: stockOut,
          cost_price: parseFloat(batch.cost_price || 0),
          selling_price: batchSellingPrice,
          purchase_price: batchPurchasePrice,
          mrp: batchMRP,
          min_sale_price: batchMinSalePrice,
          batch_price: batchSellingPrice,
          barcode,
          remark: batch.remark || '',
          product_type: currentProductType, // ADDED: product_type for batch
          updated_at: new Date()
        };

        const hasValidId = batch.id && !batch.id.toString().includes('temp_');
        const isExistingBatch = batch.isExisting && hasValidId;

        if (isExistingBatch) {
          // UPDATE existing batch with product_type
          const updateSql = `
            UPDATE batches SET 
              batch_number = ?, group_by = ?, mfg_date = ?, exp_date = ?, quantity = ?, 
              opening_stock = ?, stock_in = ?, stock_out = ?, cost_price = ?, selling_price = ?, 
              purchase_price = ?, mrp = ?, min_sale_price = ?, batch_price = ?, barcode = ?, 
              remark = ?, product_type = ?, updated_at = ?
            WHERE id = ?
          `;
          const values = [
            batchData.batch_number, batchData.group_by,
            batchData.mfg_date, batchData.exp_date, batchData.quantity,
            batchData.opening_stock,
            batchData.stock_in, batchData.stock_out,
            batchData.cost_price, batchData.selling_price, batchData.purchase_price,
            batchData.mrp, batchData.min_sale_price, batchData.batch_price,
            batchData.barcode, batchData.remark, batchData.product_type, // product_type included
            batchData.updated_at,
            parseInt(batch.id)
          ];
          await db.promise().query(updateSql, values);
          processedBatchIds.push(parseInt(batch.id));
          console.log(`✅ Updated existing batch "${batchData.batch_number}" with product_type: ${batchData.product_type}`);
        } else {
          // INSERT new batch with product_type
          const insertSql = `
            INSERT INTO batches (
              product_id, batch_number, group_by, mfg_date, exp_date, product_type, quantity, opening_stock, 
              stock_in, stock_out, cost_price, selling_price, purchase_price, mrp, min_sale_price, 
              batch_price, barcode, remark, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          const values = [
            productId, 
            batchData.batch_number, 
            batchData.group_by,
            batchData.mfg_date, 
            batchData.exp_date, 
            batchData.product_type, // product_type included
            batchData.quantity,
            batchData.opening_stock,
            batchData.stock_in, 
            batchData.stock_out,
            batchData.cost_price, 
            batchData.selling_price, 
            batchData.purchase_price,
            batchData.mrp, 
            batchData.min_sale_price, 
            batchData.batch_price,
            batchData.barcode, 
            batchData.remark,
            new Date(), 
            batchData.updated_at
          ];
          const [result] = await db.promise().query(insertSql, values);
          processedBatchIds.push(result.insertId);
          console.log(`✅ Inserted new batch "${batchData.batch_number}" with product_type: ${batchData.product_type}`);
        }
      }

      if (processedBatchIds.length > 0) {
        const placeholders = processedBatchIds.map(() => '?').join(',');
        await db.promise().query(
          `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
          [productId, ...processedBatchIds]
        );
        console.log('✅ Deleted old batches');
      }

    } else {
      // ✅ Maintain batch = false → ensure DEFAULT batch exists
      console.log('\n⚙️ Maintain batch = FALSE → Using default batch');

      const [existingDefault] = await db.promise().query(
        'SELECT * FROM batches WHERE product_id = ? AND batch_number = "DEFAULT"',
        [productId]
      );

      // Use opening stock from request
      let openingStock = parseFloat(requestOpeningStock || 0);
      
      const stockIn = 0;
      const stockOut = 0;
      const quantity = openingStock + stockIn - stockOut;

      console.log('📦 Default batch data:', {
        openingStock,
        quantity,
        selling_price: currentPrice,
        mrp: currentMRP,
        purchase_price: currentPurchasePrice,
        product_type: currentProductType
      });

      const batchData = {
        batch_number: 'DEFAULT',
        group_by: data.group_by || existing.group_by || 'Salescatalog',
        mfg_date: null,
        exp_date: null,
        quantity: quantity,
        opening_stock: openingStock,
        stock_in: stockIn,
        stock_out: stockOut,
        cost_price: 0,
        selling_price: currentPrice,
        purchase_price: currentPurchasePrice,
        mrp: currentMRP,
        min_sale_price: parseFloat(data.min_sale_price || 0),
        batch_price: currentPrice,
        barcode: 'DEFAULT-123',
        remark: '',
        product_type: currentProductType, // ADDED: product_type for default batch
        updated_at: new Date()
      };

      if (existingDefault.length > 0) {
        // UPDATE DEFAULT batch with product_type
        const updateSql = `
          UPDATE batches SET 
            quantity = ?, opening_stock = ?, selling_price = ?, purchase_price = ?, 
            mrp = ?, min_sale_price = ?, batch_price = ?, product_type = ?, updated_at = ?
          WHERE product_id = ? AND batch_number = "DEFAULT"
        `;
        const values = [
          batchData.quantity, 
          batchData.opening_stock,
          batchData.selling_price, 
          batchData.purchase_price,
          batchData.mrp, 
          batchData.min_sale_price,
          batchData.batch_price, 
          batchData.product_type, // product_type included
          batchData.updated_at,
          productId
        ];
        await db.promise().query(updateSql, values);
        console.log('🔄 Updated DEFAULT batch with product_type:', batchData.product_type);
      } else {
        // INSERT DEFAULT batch with product_type
        const insertSql = `
          INSERT INTO batches (
            product_id, batch_number, group_by, mfg_date, exp_date, product_type, quantity, opening_stock,
            stock_in, stock_out, cost_price, selling_price, purchase_price, mrp, min_sale_price,
            batch_price, barcode, remark, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
          productId, 
          batchData.batch_number, 
          batchData.group_by,
          batchData.mfg_date, 
          batchData.exp_date, 
          batchData.product_type, // product_type included
          batchData.quantity,
          batchData.opening_stock,
          batchData.stock_in, 
          batchData.stock_out,
          batchData.cost_price, 
          batchData.selling_price, 
          batchData.purchase_price,
          batchData.mrp, 
          batchData.min_sale_price, 
          batchData.batch_price,
          batchData.barcode, 
          batchData.remark,
          new Date(), 
          batchData.updated_at
        ];
        await db.promise().query(insertSql, values);
        console.log('✅ Inserted DEFAULT batch with product_type:', batchData.product_type);
      }
    }

    console.log('\n✅ UPDATE COMPLETED SUCCESSFULLY\n');
    
    // Fetch and return the updated data
    const [updatedProduct] = await db.promise().query(
      'SELECT * FROM products WHERE id = ?',
      [productId]
    );
    
    const [updatedBatches] = await db.promise().query(
      'SELECT * FROM batches WHERE product_id = ?',
      [productId]
    );

    console.log('📊 Verification - Updated data:');
    console.log(`- Product product_type: ${updatedProduct[0]?.product_type}`);
    updatedBatches.forEach(batch => {
      console.log(`- Batch "${batch.batch_number}" product_type: ${batch.product_type}`);
    });

    res.json({ 
      success: true, 
      message: 'Product updated successfully', 
      id: productId,
      product_type: currentProductType,
      product: updatedProduct[0],
      batches: updatedBatches
    });

  } catch (err) {
    console.error('❌ Error updating product:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update product', 
      error: err.message,
      sql: err.sql
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

// For MySQL/PostgreSQL with raw queries
router.get('/sales-catalog-check/:purchaseProductId', async (req, res) => {
  try {
    const { purchaseProductId } = req.params;
    
    // Query to check for existing sales catalog copy
    const query = `
      SELECT id, goods_name, sku, price 
      FROM products 
      WHERE purchase_product_id = ? 
      AND group_by = 'Salescatalog'
      LIMIT 1
    `;
    
    const [results] = await db.query(query, [purchaseProductId]);
    
    const hasSalesCatalogCopy = results.length > 0;
    const salesCatalogProduct = hasSalesCatalogCopy ? results[0] : null;
    
    res.json({
      success: true,
      hasSalesCatalogCopy,
      salesCatalogProductId: salesCatalogProduct?.id || null,
      salesCatalogProductName: salesCatalogProduct?.goods_name || null,
      salesCatalogProductSku: salesCatalogProduct?.sku || null,
      salesCatalogProductPrice: salesCatalogProduct?.price || null
    });
  } catch (error) {
    console.error('Error checking sales catalog:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking sales catalog',
      error: error.message
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
        b.min_sale_price,
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
            min_sale_price: row.min_sale_price,
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
        p.mrp,
        p.unit,
        p.category_id,
        p.gst_rate,
        p.inclusive_gst,
        p.images,
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
      mrp: item.mrp,
      unit: item.unit,
      category_id: item.category_id,
      category: item.category_name,
      gst_rate: item.gst_rate,
      inclusive_gst: item.inclusive_gst,
      images: item.images   // ⭐ added
    }));

    res.json(products);

  } catch (err) {
    console.error('Error fetching products with category:', err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});




module.exports = router;