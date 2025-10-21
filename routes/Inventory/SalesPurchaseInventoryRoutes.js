// const express = require('express');
// const router = express.Router();
// const db = require('./../../db');

// // Create Inventory Transaction
// router.post("/inventory-transactions", (req, res) => {
//   const transactionData = req.body;
  
//   const sql = `
//     INSERT INTO InventoryProducts SET ?
//   `;

//   db.query(sql, transactionData, (err, result) => {
//     if (err) {
//       console.error("Error creating inventory transaction:", err);
//       return res.status(500).json({ 
//         error: "Failed to create inventory transaction",
//         details: err.message 
//       });
//     }
    
//     res.status(201).json({
//       message: "Inventory transaction created successfully",
//       transactionId: result.insertId,
//       ...transactionData
//     });
//   });
// });

// // Get All Inventory Transactions
// router.get("/inventory-transactions", (req, res) => {
//   const { page = 1, limit = 50, transactionType, startDate, endDate } = req.query;
//   const offset = (page - 1) * limit;

//   let baseQuery = "SELECT * FROM InventoryProducts WHERE 1=1";
//   let countQuery = "SELECT COUNT(*) as total FROM InventoryProducts WHERE 1=1";
//   const params = [];
//   const countParams = [];

//   if (transactionType) {
//     baseQuery += " AND TransactionType = ?";
//     countQuery += " AND TransactionType = ?";
//     params.push(transactionType);
//     countParams.push(transactionType);
//   }

//   if (startDate) {
//     baseQuery += " AND Date >= ?";
//     countQuery += " AND Date >= ?";
//     params.push(startDate);
//     countParams.push(startDate);
//   }

//   if (endDate) {
//     baseQuery += " AND Date <= ?";
//     countQuery += " AND Date <= ?";
//     params.push(endDate);
//     countParams.push(endDate);
//   }

//   baseQuery += " ORDER BY Date DESC, VoucherID DESC LIMIT ? OFFSET ?";
//   params.push(parseInt(limit), parseInt(offset));

//   // Get total count
//   db.query(countQuery, countParams, (countErr, countResults) => {
//     if (countErr) {
//       console.error("Error counting transactions:", countErr);
//       return res.status(500).json({ error: "Failed to count transactions" });
//     }

//     // Get transactions
//     db.query(baseQuery, params, (err, results) => {
//       if (err) {
//         console.error("Error fetching inventory transactions:", err);
//         return res.status(500).json({ error: "Failed to fetch inventory transactions" });
//       }

//       res.json({
//         transactions: results,
//         total: countResults[0].total,
//         page: parseInt(page),
//         limit: parseInt(limit),
//         totalPages: Math.ceil(countResults[0].total / limit)
//       });
//     });
//   });
// });

// // Get Single Inventory Transaction
// router.get("/inventory-transactions/:id", (req, res) => {
//   const transactionId = req.params.id;
  
//   const sql = "SELECT * FROM InventoryProducts WHERE TransactionID = ?";
  
//   db.query(sql, [transactionId], (err, results) => {
//     if (err) {
//       console.error("Error fetching inventory transaction:", err);
//       return res.status(500).json({ error: "Failed to fetch inventory transaction" });
//     }
    
//     if (results.length === 0) {
//       return res.status(404).json({ error: "Inventory transaction not found" });
//     }
    
//     res.json(results[0]);
//   });
// });

// // Update Inventory Transaction
// router.put("/inventory-transactions/:id", (req, res) => {
//   const transactionId = req.params.id;
//   const transactionData = req.body;
  
//   const sql = "UPDATE InventoryProducts SET ? WHERE TransactionID = ?";
  
//   db.query(sql, [transactionData, transactionId], (err, result) => {
//     if (err) {
//       console.error("Error updating inventory transaction:", err);
//       return res.status(500).json({ 
//         error: "Failed to update inventory transaction",
//         details: err.message 
//       });
//     }
    
//     if (result.affectedRows === 0) {
//       return res.status(404).json({ error: "Inventory transaction not found" });
//     }
    
//     res.json({
//       message: "Inventory transaction updated successfully",
//       transactionId: transactionId,
//       ...transactionData
//     });
//   });
// });

// // Delete Inventory Transaction
// router.delete("/inventory-transactions/:id", (req, res) => {
//   const transactionId = req.params.id;
  
//   const sql = "DELETE FROM InventoryProducts WHERE TransactionID = ?";
  
//   db.query(sql, [transactionId], (err, result) => {
//     if (err) {
//       console.error("Error deleting inventory transaction:", err);
//       return res.status(500).json({ error: "Failed to delete inventory transaction" });
//     }
    
//     if (result.affectedRows === 0) {
//       return res.status(404).json({ error: "Inventory transaction not found" });
//     }
    
//     res.json({ message: "Inventory transaction deleted successfully" });
//   });
// });

// // Get Transaction Summary
// router.get("/inventory-summary", (req, res) => {
//   const { startDate, endDate } = req.query;
  
//   let query = `
//     SELECT 
//       TransactionType,
//       COUNT(*) as transactionCount,
//       SUM(TotalAmount) as totalAmount,
//       SUM(Qty) as totalQuantity,
//       SUM(TaxAmount) as totalTax
//     FROM InventoryProducts 
//     WHERE 1=1
//   `;
  
//   const params = [];
  
//   if (startDate) {
//     query += " AND Date >= ?";
//     params.push(startDate);
//   }
  
//   if (endDate) {
//     query += " AND Date <= ?";
//     params.push(endDate);
//   }
  
//   query += " GROUP BY TransactionType";
  
//   db.query(query, params, (err, results) => {
//     if (err) {
//       console.error("Error fetching inventory summary:", err);
//       return res.status(500).json({ error: "Failed to fetch inventory summary" });
//     }
    
//     res.json(results);
//   });
// });

// // Get Items for Autocomplete
// router.get("/inventory-items", (req, res) => {
//   const query = `
//     SELECT 
//       DISTINCT ItemID,
//       ItemName,
//       ItemCompanyName,
//       PackName
//     FROM InventoryProducts 
//     WHERE ItemID IS NOT NULL 
//     ORDER BY ItemName
//   `;
  
//   db.query(query, (err, results) => {
//     if (err) {
//       console.error("Error fetching inventory items:", err);
//       return res.status(500).json({ error: "Failed to fetch inventory items" });
//     }
    
//     res.json(results);
//   });
// });

// // Get Parties for Autocomplete
// router.get("/inventory-parties", (req, res) => {
//   const query = `
//     SELECT 
//       DISTINCT PartyID,
//       PartyName,
//       ContactNo1,
//       GSTIN
//     FROM InventoryProducts 
//     WHERE PartyID IS NOT NULL 
//     ORDER BY PartyName
//   `;
  
//   db.query(query, (err, results) => {
//     if (err) {
//       console.error("Error fetching inventory parties:", err);
//       return res.status(500).json({ error: "Failed to fetch inventory parties" });
//     }
    
//     res.json(results);
//   });
// });

// module.exports = router;