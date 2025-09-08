const express = require('express');
const router = express.Router();
const db = require('./../../db');

// Create Product
router.post("/products", (req, res) => {
  const data = req.body;

  // Set balance_stock equal to opening_stock
  data.balance_stock = data.opening_stock;

  // Extract batches separately
  const { batches, ...productData } = data;

  const productSql = "INSERT INTO products SET ?";

  db.query(productSql, productData, (err, result) => {
    if (err) return res.status(500).send(err);

    const productId = result.insertId;

    // If maintain_batch is true, insert batch records
    if (data.maintain_batch && batches && batches.length > 0) {
      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price) 
        VALUES ?
      `;

      const batchValues = batches.map(batch => [
        productId,
        batch.batchNumber,
        batch.mfgDate,
        batch.expDate,
        batch.quantity,
        batch.costPrice,
        batch.sellingPrice,
        batch.purchasePrice,
        batch.mrp,
        batch.batchPrice
      ]);

      db.query(batchSql, [batchValues], (batchErr) => {
        if (batchErr) return res.status(500).send(batchErr);
        createStockRecord();
      });
    } else {
      createStockRecord();
    }

    function createStockRecord() {
      const stockData = {
        product_id: productId,
        price_per_unit: data.price,
        opening_stock: data.opening_stock,
        stock_in: data.stock_in || "0",
        stock_out: data.stock_out || "0",
        balance_stock: data.opening_stock,
        date: new Date()
      };

      const stockSql = "INSERT INTO stock SET ?";
      db.query(stockSql, stockData, (stockErr, stockResult) => {
        if (stockErr) return res.status(500).send(stockErr);
        res.send({
          product_id: productId,
          stock_id: stockResult.insertId,
          batch_count: batches ? batches.length : 0,
          ...productData
        });
      });
    }
  });
});

// Get All Products
router.get("/products", (req, res) => {
  db.query("SELECT * FROM products", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Get Single Product
router.get("/products/:id", (req, res) => {
  db.query("SELECT * FROM products WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results[0]);
  });
});

// Update Product
// router.put("/products/:id", (req, res) => {
//   const data = req.body;
//   db.query("UPDATE products SET ? WHERE id = ?", [data, req.params.id], (err, result) => {
//     if (err) return res.status(500).send(err);
//     res.send({ id: req.params.id, ...data });
//   });
// });

// Delete Product
router.delete("/products/:id", (req, res) => {
  const productId = req.params.id;

  // 1️⃣ Delete dependent rows in stock table
  db.query("DELETE FROM stock WHERE product_id = ?", [productId], (err, stockResult) => {
    if (err) {
      console.error("Error deleting stock rows:", err);
      return res.status(500).send({ message: "Failed to delete related stock", error: err });
    }

    // 2️⃣ Delete dependent rows in batches table
    db.query("DELETE FROM batches WHERE product_id = ?", [productId], (err, batchResult) => {
      if (err) {
        console.error("Error deleting batch rows:", err);
        return res.status(500).send({ message: "Failed to delete related batches", error: err });
      }

      // 3️⃣ Delete the product itself
      db.query("DELETE FROM products WHERE id = ?", [productId], (err, productResult) => {
        if (err) {
          console.error("Error deleting product:", err);
          return res.status(500).send({ message: "Failed to delete product", error: err });
        }

        res.send({ message: "Product and related records deleted successfully!" });
      });
    });
  });
});

// GET batches for a specific product
router.get("/products/:id/batches", (req, res) => {
  const productId = req.params.id;

  const query = `
    SELECT * FROM batches 
    WHERE product_id = ? 
    ORDER BY created_at DESC
  `;

  db.query(query, [productId], (err, results) => {
    if (err) {
      console.error("Error fetching batches:", err);
      return res.status(500).json({ error: "Failed to fetch batches" });
    }
    res.json(results);
  });
});


router.put("/products/:id", (req, res) => {
  const data = req.body;
  const productId = req.params.id;

  // Extract batches separately
  const { batches, ...productData } = data;

  // Get a connection from the pool
  db.getConnection((err, connection) => {
    if (err) return res.status(500).send(err);

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        return res.status(500).send(err);
      }

      // 1. Update the product
      const productSql = "UPDATE products SET ? WHERE id = ?";
      connection.query(productSql, [productData, productId], (err) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).send(err);
          });
        }

        // 2. Handle batches
        if (data.maintain_batch && batches && batches.length > 0) {
          const deleteSql = "DELETE FROM batches WHERE product_id = ?";
          connection.query(deleteSql, [productId], (deleteErr) => {
            if (deleteErr) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).send(deleteErr);
              });
            }

            const batchSql = `
              INSERT INTO batches 
              (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price) 
              VALUES ?
            `;

            const batchValues = batches.map(batch => [
              productId,
              batch.batchNumber,
              batch.mfgDate || null,
              batch.expDate || null,
              batch.quantity || 0,
              batch.costPrice || 0,
              batch.sellingPrice || 0,
              batch.purchasePrice || 0,
              batch.mrp || 0,
              batch.batchPrice || 0
            ]);

            connection.query(batchSql, [batchValues], (batchErr) => {
              if (batchErr) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).send(batchErr);
                });
              }
              updateStockRecord(connection);
            });
          });
        } else if (!data.maintain_batch) {
          // If maintain_batch is disabled, delete all batches
          const deleteSql = "DELETE FROM batches WHERE product_id = ?";
          connection.query(deleteSql, [productId], (deleteErr) => {
            if (deleteErr) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).send(deleteErr);
              });
            }
            updateStockRecord(connection);
          });
        } else {
          // No batch updates needed
          updateStockRecord(connection);
        }
      });
    });

    // === Helper function to update stock ===
    function updateStockRecord(connection) {
      const stockSelectSql = "SELECT * FROM stock WHERE product_id = ? ORDER BY date DESC LIMIT 1";
      connection.query(stockSelectSql, [productId], (stockSelectErr, stockResults) => {
        if (stockSelectErr) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).send(stockSelectErr);
          });
        }

        if (stockResults.length > 0) {
          // Update existing stock record
          const stockUpdateSql = `
            UPDATE stock 
            SET price_per_unit = ?, opening_stock = ?, balance_stock = ?
            WHERE product_id = ? AND date = ?
          `;

          connection.query(stockUpdateSql, [
            data.price,
            data.opening_stock,
            data.opening_stock, // reset balance_stock to opening_stock
            productId,
            stockResults[0].date
          ], (stockUpdateErr) => {
            if (stockUpdateErr) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).send(stockUpdateErr);
              });
            }
            commitTransaction(connection);
          });
        } else {
          // Insert a new stock record
          const stockData = {
            product_id: productId,
            price_per_unit: data.price,
            opening_stock: data.opening_stock,
            stock_in: data.stock_in || "0",
            stock_out: data.stock_out || "0",
            balance_stock: data.opening_stock,
            date: new Date()
          };

          const stockInsertSql = "INSERT INTO stock SET ?";
          connection.query(stockInsertSql, stockData, (stockInsertErr) => {
            if (stockInsertErr) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).send(stockInsertErr);
              });
            }
            commitTransaction(connection);
          });
        }
      });
    }

    // === Commit & Release ===
    function commitTransaction(connection) {
      connection.commit((commitErr) => {
        if (commitErr) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).send(commitErr);
          });
        }
        connection.release();
        res.send({
          id: productId,
          ...productData,
          batch_count: batches ? batches.length : 0,
        });
      });
    }
  });
});


module.exports = router;
