const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer
const storage = multer.diskStorage({
  destination: 'uploads/flashsales/',
  filename: (req, file, cb) => {
    cb(null, 'flashsale-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// GET ALL FLASH SALES (filtered by offer = 'Flash Sales')
router.get("/flashoffer", (req, res) => {
  const sql = `SELECT * FROM offers WHERE offer = 'Flash Sales' ORDER BY created_at DESC`;
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching flash sales:", err);
      return res.status(500).json({ success: false, message: "DB Error" });
    }

    const flashSales = results.map((sale) => ({
      id: sale.id,
      title: sale.title,
      description: sale.description,
      flashSaleType: sale.offer_type,
      status: sale.status,
      valid_from: sale.valid_from,
      valid_until: sale.valid_until,
      start_time: sale.start_time,
      end_time: sale.end_time,
      buy_quantity: sale.buy_quantity,
      get_quantity: sale.get_quantity,
      discount_percentage: sale.discount_percentage,
      purchase_limit: sale.purchase_limit,
      terms_conditions: sale.terms_conditions,
      // ADD THESE FIELDS:
      product_id: sale.product_id,
      product_name: sale.product_name,
      category_id: sale.category_id,
      category_name: sale.category_name,
      // End of added fields
      image_url: sale.image_url,
      created_at: sale.created_at,
      offer: sale.offer
    }));

    console.log("Flash sales response:", flashSales); // Debug log
    res.json({ success: true, data: flashSales });
  });
});

// GET SINGLE FLASH SALE
router.get("/flashoffer/:id", (req, res) => {
  const sql = `SELECT * FROM offers WHERE id = ? AND offer = 'Flash Sales'`;
  db.query(sql, [req.params.id], (err, results) => {
    if (err) {
      console.error("Error fetching flash sale:", err);
      return res.status(500).json({ success: false, message: "DB Error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "Flash sale not found" });
    }

    const sale = results[0];
    const flashSale = {
      id: sale.id,
      title: sale.title,
      description: sale.description,
      flashSaleType: sale.offer_type,
      status: sale.status,
      valid_from: sale.valid_from,
      valid_until: sale.valid_until,
      start_time: sale.start_time,
      end_time: sale.end_time,
      buy_quantity: sale.buy_quantity,
      get_quantity: sale.get_quantity,
      discount_percentage: sale.discount_percentage,
      purchase_limit: sale.purchase_limit,
      terms_conditions: sale.terms_conditions,
      // ADD THESE FIELDS:
      product_id: sale.product_id,
      product_name: sale.product_name,
      category_id: sale.category_id,
      category_name: sale.category_name,
      // End of added fields
      image_url: sale.image_url,
      created_at: sale.created_at,
      offer: sale.offer
    };

    console.log("Single flash sale response:", flashSale); // Debug log
    res.json({ success: true, data: flashSale });
  });
});

// CREATE FLASH SALE
router.post("/create-flashsale", upload.single("image"), (req, res) => {
  console.log("Create Flash Sale Request Body:", req.body);

  const {
    title,
    description,
    discount_percentage,
    minimum_amount,
    valid_from,
    valid_until,
    offer_type,
    status,
    category_id,
    category_name,
    product_id,
    product_name,
    purchase_limit,
    buy_quantity,
    get_quantity,
    terms_conditions,
    start_time,
    end_time
  } = req.body;

  const image_url = req.file ? `/uploads/flashsales/${req.file.filename}` : null;

  // ✅ Static value for 'offer'
  const offer = "Flash Sales";

  const sql = `
    INSERT INTO offers
    (title, description, discount_percentage, minimum_amount,
     valid_from, valid_until, image_url, offer_type, status,
     category_id, category_name, product_id, product_name, purchase_limit,
     buy_quantity, get_quantity, terms_conditions, 
     start_time, end_time, offer, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  const values = [
    title,
    description,
    discount_percentage || 0,
    minimum_amount || 0,
    valid_from,
    valid_until,
    image_url,
    offer_type,
    status || 'active',
    category_id,
    category_name,
    product_id,
    product_name,
    purchase_limit || 1,
    buy_quantity || 1,
    get_quantity || 1,
    terms_conditions || '',
    start_time || '00:00',
    end_time || '23:59',
    offer // ✅ Static "Flash Sales" value
  ];

  console.log("SQL Values:", values);

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Insert Offer Error:", err);
      return res.status(500).json({ success: false, message: "DB Error" });
    }

    res.status(201).json({
      success: true,
      message: "Flash Sale Created",
      id: result.insertId
    });
  });
});

// UPDATE FLASH SALE
router.put('/update-flashsale/:id', upload.single('image'), (req, res) => {
  console.log("🔄 UPDATE FLASH SALE REQUEST");
  console.log("ID:", req.params.id);
  console.log("Body:", req.body);
  console.log("File:", req.file);
  console.log("=============================");
  
  const flashSaleId = req.params.id;

  db.query('SELECT * FROM offers WHERE id = ? AND offer = "Flash Sales"', [flashSaleId], (err, rows) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ success: false, message: 'DB Error' });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flash sale not found' });
    }

    const existing = rows[0];
    console.log("Existing record:", existing);
    
    const {
      title, description, discount_percentage, valid_from, valid_until,
      offer_type, status, category_id, category_name, product_id,
      product_name, purchase_limit, removeImage,
      buy_quantity, get_quantity, terms_conditions, 
      start_time, end_time, expiry_threshold
    } = req.body;

    console.log("Parsed body fields:");
    console.log("product_id:", product_id);
    console.log("product_name:", product_name);
    console.log("buy_quantity:", buy_quantity);
    console.log("get_quantity:", get_quantity);

    let image_url = existing.image_url;
    
    // Handle image removal
    if (removeImage === 'true' && image_url) {
      const imgPath = path.join(__dirname, '..', image_url);
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
        console.log("Removed existing image:", imgPath);
      }
      image_url = null;
    }
    
    // Handle new image upload
    if (req.file) {
      if (image_url) {
        const oldPath = path.join(__dirname, '..', image_url);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
          console.log("Replaced old image:", oldPath);
        }
      }
      image_url = `/uploads/flashsales/${req.file.filename}`;
      console.log("New image path:", image_url);
    }

    const updateData = {
      title: title || existing.title,
      description: description || existing.description,
      discount_percentage: discount_percentage || existing.discount_percentage,
      valid_from: valid_from || existing.valid_from,
      valid_until: valid_until || existing.valid_until,
      offer_type: offer_type || existing.offer_type,
      status: status || existing.status,
      category_id: category_id || existing.category_id,
      category_name: category_name || existing.category_name,
      product_id: product_id || existing.product_id,
      product_name: product_name || existing.product_name,
      purchase_limit: purchase_limit || existing.purchase_limit,
      buy_quantity: buy_quantity || existing.buy_quantity,
      get_quantity: get_quantity || existing.get_quantity,
      terms_conditions: terms_conditions || existing.terms_conditions,
      start_time: start_time || existing.start_time,
      end_time: end_time || existing.end_time,
      image_url: image_url,
      updated_at: new Date()
    };

    console.log("Final update data:", updateData);

    db.query('UPDATE offers SET ? WHERE id = ? AND offer = "Flash Sales"', [updateData, flashSaleId], (err, result) => {
      if (err) {
        console.error("Update Error:", err);
        return res.status(500).json({ success: false, message: 'Failed to update flash sale' });
      }
      
      console.log("Update successful, affected rows:", result.affectedRows);
      
      res.json({ 
        success: true, 
        message: 'Flash sale updated successfully',
        data: { 
          id: flashSaleId, 
          ...updateData 
        } 
      });
    });
  });
});

// DELETE FLASH SALE
router.delete('/flashoffer/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if flash sale exists
    const [flashSales] = await db.promise().query(
      'SELECT image_url FROM offers WHERE id = ? AND offer = "Flash Sales"',
      [id]
    );

    if (flashSales.length === 0) {
      return res.status(404).json({ success: false, message: 'Flash sale not found' });
    }

    // Delete associated image
    if (flashSales[0].image_url) {
      const imagePath = path.join(__dirname, '../..', flashSales[0].image_url);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    await db.promise().query(
      'DELETE FROM offers WHERE id = ? AND offer = "Flash Sales"',
      [id]
    );

    res.json({ success: true, message: 'Flash sale deleted successfully' });
  } catch (error) {
    console.error('Error deleting flash sale:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// TOGGLE FLASH SALE STATUS
router.patch('/flashoffer/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    // First, get the flash sale to know the product_id
    const [flashSales] = await db.promise().query(
      'SELECT product_id FROM offers WHERE id = ? AND offer = "Flash Sales"',
      [id]
    );

    if (flashSales.length === 0) {
      return res.status(404).json({ success: false, message: 'Flash sale not found' });
    }

    const productId = flashSales[0].product_id;

    // Start a transaction to ensure both updates succeed or fail together
    const connection = await db.promise().getConnection();
    await connection.beginTransaction();

    try {
      // Update the offers table
      const [offerResult] = await connection.query(
        'UPDATE offers SET status = ? WHERE id = ? AND offer = "Flash Sales"',
        [status, id]
      );

      if (offerResult.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ success: false, message: 'Flash sale not found in offers table' });
      }

      // Update the batches table where product_id matches
      if (productId) {
        const [batchResult] = await connection.query(
          'UPDATE batches SET flash_sale_status = ? WHERE product_id = ?',
          [status, productId]
        );

        console.log(`Updated ${batchResult.affectedRows} batches for product_id ${productId} to status ${status}`);
      } else {
        console.log('No product_id found in flash sale, skipping batch update');
      }

      // Commit the transaction
      await connection.commit();
      connection.release();

      res.json({ 
        success: true, 
        message: `Flash sale ${status === 'active' ? 'activated' : 'deactivated'} successfully`,
        details: {
          offerUpdated: true,
          batchesUpdated: productId ? true : false,
          productId: productId
        }
      });

    } catch (error) {
      // Rollback if any error occurs
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (error) {
    console.error('Error updating flash sale status:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;