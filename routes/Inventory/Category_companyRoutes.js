const express = require('express');
const router = express.Router();
const db = require('./../../db');

// ---------- CATEGORY CRUD ----------

// Get All Categories with current active discount info
router.get("/categories", (req, res) => {
  const sql = `
    SELECT c.*, 
           (SELECT discount_value 
            FROM categories_discount_history 
            WHERE category_id = c.id 
            AND start_date <= CURDATE() 
            AND end_date >= CURDATE() 
            ORDER BY created_at DESC 
            LIMIT 1) as current_discount_from_history
    FROM categories c
    ORDER BY c.created_at DESC
  `;
  
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching categories:", err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});


// Get Single Category by ID
router.get("/categories/:id", (req, res) => {
  const id = req.params.id;
  const sql = `
    SELECT c.*, 
           (SELECT discount_value 
            FROM categories_discount_history 
            WHERE category_id = c.id 
            AND start_date <= CURDATE() 
            AND end_date >= CURDATE() 
            ORDER BY created_at DESC 
            LIMIT 1) as current_discount_from_history
    FROM categories c
    WHERE c.id = ?
  `;
  
  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error("Error fetching category:", err);
      return res.status(500).send(err);
    }
    if (results.length === 0) {
      return res.status(404).send({ message: "Category not found" });
    }
    res.send(results[0]);
  });
});

// Create Category with discount_end_date
router.post("/categories", (req, res) => {
  const { category_name, discount, discount_end_date } = req.body;
  
  const categoryData = {
    category_name,
    discount: discount || 0,
    discount_end_date: discount_end_date || null
  };
  
  const sql = "INSERT INTO categories SET ?";
  db.query(sql, categoryData, (err, result) => {
    if (err) {
      console.error("Error creating category:", err);
      return res.status(500).send(err);
    }
    res.send({ id: result.insertId, ...categoryData });
  });
});

// Update Category with discount_end_date
router.put("/categories/:id", (req, res) => {
  const { category_name, discount, discount_end_date } = req.body;
  const id = req.params.id;
  
  const categoryData = {
    category_name,
    discount: discount || 0,
    discount_end_date: discount_end_date || null
  };
  
  const sql = "UPDATE categories SET ? WHERE id = ?";
  db.query(sql, [categoryData, id], (err, result) => {
    if (err) {
      console.error("Error updating category:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Category not found" });
    }
    res.send({ id, ...categoryData });
  });
});

// Delete Category
router.delete("/categories/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM categories WHERE id = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting category:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Category not found" });
    }
    res.send({ message: "Category deleted successfully." });
  });
});

// ---------- CATEGORY DISCOUNT HISTORY CRUD ----------

// Create Discount History Entry
router.post("/categories/:id/discount-history", (req, res) => {
  const categoryId = req.params.id;
  const { discount_value, start_date, end_date } = req.body;
  
  const historyData = {
    category_id: categoryId,
    discount_value,
    start_date,
    end_date
  };
  
  const sql = "INSERT INTO categories_discount_history SET ?";
  db.query(sql, historyData, (err, result) => {
    if (err) {
      console.error("Error creating discount history:", err);
      return res.status(500).send(err);
    }
    
    const historyId = result.insertId;
    
    // Check if this is the current active discount and update category if needed
    const today = new Date().toISOString().split('T')[0];
    if (start_date <= today && end_date >= today) {
      // Update the category table with current discount and end date
      const updateCategorySql = "UPDATE categories SET discount = ?, discount_end_date = ? WHERE id = ?";
      db.query(updateCategorySql, [discount_value, end_date, categoryId], (err, result) => {
        if (err) {
          console.error("Error updating category discount:", err);
          // Still return success for history creation even if category update fails
        }
        res.send({ id: historyId, ...historyData });
      });
    } else {
      res.send({ id: historyId, ...historyData });
    }
  });
});

// Get Discount History for a Category
router.get("/categories/:id/discount-history", (req, res) => {
  const categoryId = req.params.id;
  const sql = `
    SELECT * FROM categories_discount_history 
    WHERE category_id = ? 
    ORDER BY start_date DESC, created_at DESC
  `;
  
  db.query(sql, [categoryId], (err, results) => {
    if (err) {
      console.error("Error fetching discount history:", err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Update Discount History Entry
router.put("/categories/:categoryId/discount-history/:historyId", (req, res) => {
  const { categoryId, historyId } = req.params;
  const { discount_value, start_date, end_date } = req.body;
  
  const historyData = {
    discount_value,
    start_date,
    end_date
  };
  
  const historySql = "UPDATE categories_discount_history SET ? WHERE id = ? AND category_id = ?";
  db.query(historySql, [historyData, historyId, categoryId], (err, result) => {
    if (err) {
      console.error("Error updating discount history:", err);
      return res.status(500).send(err);
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Discount history entry not found" });
    }
    
    // Check if this is the current active discount and update category if needed
    const today = new Date().toISOString().split('T')[0];
    if (start_date <= today && end_date >= today) {
      // Update the category table
      const updateCategorySql = "UPDATE categories SET discount = ?, discount_end_date = ? WHERE id = ?";
      db.query(updateCategorySql, [discount_value, end_date, categoryId], (err, result) => {
        if (err) {
          console.error("Error updating category discount:", err);
          // Still return success for history update even if category update fails
        }
        res.send({ id: historyId, ...historyData });
      });
    } else {
      res.send({ id: historyId, ...historyData });
    }
  });
});

// Delete Discount History Entry
router.delete("/categories/:categoryId/discount-history/:historyId", (req, res) => {
  const { categoryId, historyId } = req.params;
  
  const sql = "DELETE FROM categories_discount_history WHERE id = ? AND category_id = ?";
  db.query(sql, [historyId, categoryId], (err, result) => {
    if (err) {
      console.error("Error deleting discount history:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Discount history entry not found" });
    }
    res.send({ message: "Discount history entry deleted successfully." });
  });
});

// Sync current discount from history to category
router.post("/categories/:id/sync-discount", (req, res) => {
  const categoryId = req.params.id;
  
  const syncSql = `
    UPDATE categories c
    SET c.discount = COALESCE((
      SELECT discount_value 
      FROM categories_discount_history 
      WHERE category_id = c.id 
      AND start_date <= CURDATE() 
      AND end_date >= CURDATE() 
      ORDER BY created_at DESC 
      LIMIT 1
    ), 0),
    c.discount_end_date = (
      SELECT end_date 
      FROM categories_discount_history 
      WHERE category_id = c.id 
      AND start_date <= CURDATE() 
      AND end_date >= CURDATE() 
      ORDER BY created_at DESC 
      LIMIT 1
    )
    WHERE c.id = ?
  `;
  
  db.query(syncSql, [categoryId], (err, result) => {
    if (err) {
      console.error("Error syncing discount:", err);
      return res.status(500).send(err);
    }
    res.send({ message: "Discount synced successfully", affectedRows: result.affectedRows });
  });
});

// ---------- COMPANY CRUD ----------

// Create Company
router.post("/companies", (req, res) => {
  const data = req.body;
  const sql = "INSERT INTO companies SET ?";
  db.query(sql, data, (err, result) => {
    if (err) {
      console.error("Error creating company:", err);
      return res.status(500).send(err);
    }
    res.send({ id: result.insertId, ...data });
  });
});

// Get All Companies
router.get("/companies", (req, res) => {
  const sql = "SELECT * FROM companies";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching companies:", err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Update Company
router.put("/companies/:id", (req, res) => {
  const data = req.body;
  const id = req.params.id;
  const sql = "UPDATE companies SET ? WHERE id = ?";
  db.query(sql, [data, id], (err, result) => {
    if (err) {
      console.error("Error updating company:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Company not found" });
    }
    res.send({ id, ...data });
  });
});

// Delete Company
router.delete("/companies/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM companies WHERE id = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting company:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Company not found" });
    }
    res.send({ message: "Company deleted successfully." });
  });
});

// ---------- UNITS CRUD ----------

// Create Unit
router.post("/units", (req, res) => {
  const data = req.body;
  const sql = "INSERT INTO units SET ?";
  db.query(sql, data, (err, result) => {
    if (err) {
      console.error("Error creating unit:", err);
      return res.status(500).send(err);
    }
    res.send({ id: result.insertId, ...data });
  });
});

// Get All Units
router.get("/units", (req, res) => {
  const sql = "SELECT id, name FROM units";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching units:", err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Update Unit
router.put("/units/:id", (req, res) => {
  const data = req.body;
  const id = req.params.id;
  const sql = "UPDATE units SET ? WHERE id = ?";
  db.query(sql, [data, id], (err, result) => {
    if (err) {
      console.error("Error updating unit:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Unit not found" });
    }
    res.send({ id, ...data });
  });
});

// Delete Unit
router.delete("/units/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM units WHERE id = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting unit:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Unit not found" });
    }
    res.send({ message: "Unit deleted successfully." });
  });
});

module.exports = router;