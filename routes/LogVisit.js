const express = require('express');
const router = express.Router();
const connection = require('../db'); // use existing connection



const multer = require('multer');
const path = require('path');

const fs = require("fs");

const uploadDir = path.join(__dirname, "../uploads/visits");

// Create folder if not exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `image-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = upload;


// Helper: query with promise
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

/**
 * GET /api/retailers
 */
router.get('/retailers', async (req, res) => {
  try {
    const sql = `
      SELECT 
        id AS retailer_id, 
        name AS retailer_name,
        staffid AS staff_id,
        assigned_staff AS staff_name
      FROM accounts
      WHERE assigned_staff IS NOT NULL
      ORDER BY name;
    `;
    const rows = await query(sql);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching retailers:", err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});



/**
 * GET /api/salesvisits
 */
router.get('/salesvisits', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM sales_visits ORDER BY created_at DESC');
const data = rows.map(v => ({
  ...v,
  image_url: v.image_filename
    ? `${req.protocol}://${req.get("host")}/uploads/visits/${v.image_filename}`
    : null
}));

res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/salesvisits/:id
 */
router.get('/salesvisits/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await query('SELECT * FROM sales_visits WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
const data = rows.map(v => ({
  ...v,
  image_url: v.image_filename
    ? `${req.protocol}://${req.get("host")}/uploads/visits/${v.image_filename}`
    : null
}));

res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// routes/location.js or inside your routes file
router.get('/reverse-geocode', async (req, res) => {
  const { lat, lon } = req.query;

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'SalesApp/1.0 (support@yourdomain.com)'
        }
      }
    );

    const data = await response.json();

    if (data && data.display_name) {
      return res.json({
        success: true,
        address: data.display_name
      });
    }

    res.json({ success: false });
  } catch (err) {
    console.error("Reverse geocode error:", err);
    res.status(500).json({ success: false });
  }
});


/**
 * POST /api/salesvisits
 */
router.post('/salesvisits', upload.single('image'), async (req, res) => {
  try {
    // Debug logs (remove later if needed)
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const {
      retailer_id,
      retailer_name,
      staff_id,
      staff_name,
      visit_type,
      visit_outcome,
      sales_amount,
      transaction_type,
      description,
      location
    } = req.body;

    // ✅ Validate required fields
    if (!retailer_id || !staff_id || !visit_type || !visit_outcome) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields"
      });
    }

    // ✅ Handle sales amount safely
    const amount =
      sales_amount !== undefined && sales_amount !== null && sales_amount !== ""
        ? Number(sales_amount)
        : null;

    if (amount !== null && isNaN(amount)) {
      return res.status(400).json({
        success: false,
        error: "Invalid sales amount"
      });
    }

    // ✅ Handle image safely
    const image_filename = req.file ? req.file.filename : null;

    const sql = `
      INSERT INTO sales_visits (
        retailer_id,
        retailer_name,
        staff_id,
        staff_name,
        visit_type,
        visit_outcome,
        sales_amount,
        transaction_type,
        description,
        location,
        image_filename,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const params = [
      retailer_id,
      retailer_name || null,
      staff_id,
      staff_name || null,
      visit_type,
      visit_outcome,
      amount,
      transaction_type || null,
      description || null,
      location || null,
      image_filename
    ];

    const result = await query(sql, params);

    const [inserted] = await query(
      'SELECT * FROM sales_visits WHERE id = ?',
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      data: inserted
    });

  } catch (err) {
    console.error("SALES VISIT ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.put('/salesvisits/:id', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  try {
    const {
      retailer_id,
      retailer_name,
      staff_id,
      staff_name,
      visit_type,
      visit_outcome,
      sales_amount,
      transaction_type,
      description,
      location  
    } = req.body;

    let imageUpdate = '';
    let params = [];
    
    if (req.file) {
      imageUpdate = ', image_filename = ?';
      params = [
        retailer_id,
        retailer_name,
        staff_id,
        staff_name,
        visit_type,
        visit_outcome,
        sales_amount || null,
        transaction_type || null,
        description || null,
        location || null,      // Add location
        req.file.filename,     // Add new image filename
        id
      ];
    } else {
      params = [
        retailer_id,
        retailer_name,
        staff_id,
        staff_name,
        visit_type,
        visit_outcome,
        sales_amount || null,
        transaction_type || null,
        description || null,
        location || null,      // Add location
        id
      ];
    }

    const sql = `
      UPDATE sales_visits SET
      retailer_id = ?, retailer_name = ?, staff_id = ?, staff_name = ?,
      visit_type = ?, visit_outcome = ?, sales_amount = ?, 
      transaction_type = ?, description = ?, location = ?${imageUpdate}
      WHERE id = ?
    `;

    await query(sql, params);
    const updated = await query('SELECT * FROM sales_visits WHERE id = ?', [id]);
const visit = updated[0];

res.json({
  success: true,
  data: {
    ...visit,
    image_url: visit.image_filename
      ? `${req.protocol}://${req.get("host")}/uploads/visits/${visit.image_filename}`
      : null
  }
});
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
/**
 * DELETE /api/salesvisits/:id
 */
router.delete('/salesvisits/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await query('DELETE FROM sales_visits WHERE id = ?', [id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
