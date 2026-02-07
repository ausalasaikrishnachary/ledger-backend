// InventoryRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../../db");

// GET Inventory (category, product name, available quantity)
router.get("/inventory", (req, res) => {
  const query = `
    SELECT 
      c.category_name, 
      p.goods_name AS product_name, 
      COALESCE(SUM(b.quantity), 0) AS available_quantity 
    FROM products p
    LEFT JOIN batches b 
      ON p.id = b.product_id 
    LEFT JOIN categories c 
      ON p.category_id = c.id 
    WHERE p.group_by = 'Salescatalog'
    GROUP BY 
      c.category_name, 
      p.goods_name
    ORDER BY 
      c.category_name ASC, 
      p.goods_name ASC;
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching inventory:", err);
      return res.status(500).json({
        success: false,
        error: "Database query failed",
      });
    }

    res.json({
      success: true,
      data: results,
    });
  });
});

module.exports = router;
