const express = require('express');
const router = express.Router();
const connection = require('../db'); // use existing connection

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
    res.json({ success: true, data: rows });
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
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/salesvisits
 */
router.post('/salesvisits', async (req, res) => {
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
      description
    } = req.body;

    const sql = `
      INSERT INTO sales_visits
      (retailer_id, retailer_name, staff_id, staff_name, visit_type, visit_outcome, sales_amount, transaction_type, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const params = [
      retailer_id,
      retailer_name,
      staff_id,
      staff_name,
      visit_type,
      visit_outcome,
      sales_amount || null,
      transaction_type || null,
      description || null
    ];

    const result = await query(sql, params);
    const inserted = await query('SELECT * FROM sales_visits WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: inserted[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * PUT /api/salesvisits/:id
 */
router.put('/salesvisits/:id', async (req, res) => {
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
      description
    } = req.body;

    const sql = `
      UPDATE sales_visits SET
      retailer_id = ?, retailer_name = ?, staff_id = ?, staff_name = ?,
      visit_type = ?, visit_outcome = ?, sales_amount = ?, transaction_type = ?, description = ?
      WHERE id = ?
    `;
    const params = [
      retailer_id,
      retailer_name,
      staff_id,
      staff_name,
      visit_type,
      visit_outcome,
      sales_amount || null,
      transaction_type || null,
      description || null,
      id
    ];

    await query(sql, params);
    const updated = await query('SELECT * FROM sales_visits WHERE id = ?', [id]);
    res.json({ success: true, data: updated[0] });
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
