const express = require('express');
const router = express.Router();
const db = require('./../../db'); // Adjust path as per your project structure

// ledger-backend/routes/Inventory/inventoryRoutes.js


router.post('/products', (req, res) => {
  const data = req.body;

<<<<<<< HEAD
  // Calculate balance_stock from opening_stock and quantity
  const openingStock = parseFloat(data.opening_stock) || 0;
  const quantity = parseFloat(data.quantity) || 0;
  data.balance_stock = (openingStock + quantity).toString();
  
  // Set default values for stock_in and stock_out
  data.stock_in = "0";
  data.stock_out = "0";
=======
  try {
    data.balance_stock = parseFloat(data.opening_stock) || 0;
    data.created_at = new Date();
    const { batches, ...productData } = data;
>>>>>>> 69cf85c84885d59d0810a90e9fddc0e233572e6b

    // Insert product
    const columns = Object.keys(productData).join(', ');
    const placeholders = Object.keys(productData).map(() => '?').join(', ');
    const values = Object.values(productData);

<<<<<<< HEAD
  const productSql = "INSERT INTO products SET ?";

  db.query(productSql, productData, (err, result) => {
    if (err) return res.status(500).send(err);

    const productId = result.insertId;

    // If maintain_batch is true, insert batch records
    if (data.maintain_batch && batches && batches.length > 0) {
      const batchSql = `
        INSERT INTO batches 
        (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode) 
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
        batch.batchPrice,
        batch.barcode || null
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
        balance_stock: data.balance_stock,
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
router.put("/products/:id", (req, res) => {
  const data = req.body;
  const productId = req.params.id;

  // Calculate balance_stock from opening_stock and quantity
  const openingStock = parseFloat(data.opening_stock) || 0;
  const quantity = parseFloat(data.quantity) || 0;
  data.balance_stock = (openingStock + quantity).toString();
  
  // Set default values for stock_in and stock_out
  data.stock_in = "0";
  data.stock_out = "0";

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
              (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode) 
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
              batch.batchPrice || 0,
              batch.barcode || null
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
            SET price_per_unit = ?, opening_stock = ?, stock_in = ?, stock_out = ?, balance_stock = ?
            WHERE product_id = ? AND date = ?
          `;

          connection.query(stockUpdateSql, [
            data.price,
            data.opening_stock,
            data.stock_in || "0",
            data.stock_out || "0",
            data.balance_stock,
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
            balance_stock: data.balance_stock,
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
=======
    const productSql = `INSERT INTO products (${columns}) VALUES (${placeholders})`;
    db.query(productSql, values, (err, productInsert) => {
>>>>>>> 69cf85c84885d59d0810a90e9fddc0e233572e6b
      if (err) {
        console.error('Error inserting product:', err);
        return res.status(500).json({ success: false, message: 'Failed to create product', error: err.message });
      }

      const productId = productInsert.insertId;

      // Handle batches
      if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
        // Get the last batch number (global sequence)
        db.query('SELECT batch_number FROM batches ORDER BY CAST(batch_number AS UNSIGNED) DESC LIMIT 1', (err, lastBatchRow) => {
          if (err) {
            console.error('Error fetching last batch number:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch batch number', error: err.message });
          }

          let lastBatchNumber = 0;
          if (lastBatchRow.length > 0) {
            lastBatchNumber = parseInt(lastBatchRow[0].batch_number) || 0;
          }

          const batchValues = [];
          let barcodeChecksRemaining = batches.length;

<<<<<<< HEAD
  db.query(query, [productId], (err, results) => {
    if (err) {
      console.error("Error fetching batches:", err);
      return res.status(500).json({ error: "Failed to fetch batches" });
    }
    res.json(results);
  });
});

module.exports = router;
=======
          // Check and generate unique barcodes
          batches.forEach((batch, index) => {
            let barcode = batch.barcode;
            const timestamp = Date.now();
            if (!barcode) {
              barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
            }

            // Verify barcode uniqueness
            db.query('SELECT COUNT(*) as count FROM batches WHERE barcode = ?', [barcode], (err, barcodeCheck) => {
              if (err) {
                console.error('Error checking barcode:', err);
                return res.status(500).json({ success: false, message: 'Failed to check barcode', error: err.message });
              }

              if (barcodeCheck[0].count > 0) {
                // Generate new barcode if it exists
                barcode = `B${timestamp}${index}${Math.random().toString(36).substr(2, 5)}`;
              }

              const batchNumber = String(lastBatchNumber + index + 1).padStart(5, '0');
              batchValues.push([
                productId,
                batchNumber,
                batch.mfgDate || null,
                batch.expDate || null,
                parseFloat(batch.quantity) || 0,
                parseFloat(batch.costPrice) || 0,
                parseFloat(batch.sellingPrice) || 0,
                parseFloat(batch.purchasePrice) || 0,
                parseFloat(batch.mrp) || 0,
                parseFloat(batch.batchPrice) || 0,
                barcode,
                new Date()
              ]);

              barcodeChecksRemaining--;
              if (barcodeChecksRemaining === 0) {
                // Insert batches after all barcodes are verified
                const batchSql = `
                  INSERT INTO batches 
                  (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode, created_at)
                  VALUES ?
                `;
                db.query(batchSql, [batchValues], (err) => {
                  if (err) {
                    console.error('Error inserting batches:', err);
                    return res.status(500).json({ success: false, message: 'Failed to create batches', error: err.message });
                  }
                  res.status(201).json({ success: true, product_id: productId, batch_count: batches.length });
                });
              }
            });
          });
        });
      } else {
        res.status(201).json({ success: true, product_id: productId, batch_count: 0 });
      }
    });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ success: false, message: 'Failed to create product', error: err.message });
  }
});

router.put('/products/:id', (req, res) => {
  const productId = req.params.id;
  const data = req.body;
  const { batches, ...productData } = data;

  try {
    if (Object.keys(productData).length > 0) {
      const updateFields = Object.keys(productData).map(k => `${k} = ?`).join(', ');
      const updateValues = Object.values(productData);
      const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
      db.query(updateSql, [...updateValues, productId], (err) => {
        if (err) {
          console.error('Error updating product:', err);
          return res.status(500).json({ success: false, message: 'Failed to update product', error: err.message });
        }
        handleBatches();
      });
    } else {
      handleBatches();
    }

    function handleBatches() {
      if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
        // Get existing batches
        db.query('SELECT id, batch_number FROM batches WHERE product_id = ?', [productId], (err, existingBatches) => {
          if (err) {
            console.error('Error fetching existing batches:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch batches', error: err.message });
          }

          const existingMap = new Map(existingBatches.map(b => [b.id, b.batch_number]));

          // Get last batch number
          db.query('SELECT batch_number FROM batches ORDER BY CAST(batch_number AS UNSIGNED) DESC LIMIT 1', (err, lastBatchRow) => {
            if (err) {
              console.error('Error fetching last batch number:', err);
              return res.status(500).json({ success: false, message: 'Failed to fetch batch number', error: err.message });
            }

            let lastBatchNumber = 0;
            if (lastBatchRow.length > 0) {
              lastBatchNumber = parseInt(lastBatchRow[0].batch_number) || 0;
            }

            let newBatchCounter = 0;
            const insertBatches = [];
            const updateBatches = [];
            let barcodeChecksRemaining = batches.length;

            batches.forEach((batch, idx) => {
              let barcode = batch.barcode;
              const timestamp = Date.now();
              if (!barcode) {
                barcode = `B${timestamp}${idx}${Math.random().toString(36).substr(2, 5)}`;
              }

              // Verify barcode uniqueness
              db.query('SELECT COUNT(*) as count FROM batches WHERE barcode = ? AND id != ?', [barcode, batch.id || 0], (err, barcodeCheck) => {
                if (err) {
                  console.error('Error checking barcode:', err);
                  return res.status(500).json({ success: false, message: 'Failed to check barcode', error: err.message });
                }

                if (barcodeCheck[0].count > 0) {
                  barcode = `B${timestamp}${idx}${Math.random().toString(36).substr(2, 5)}`;
                }

                const bData = [
                  batch.mfgDate || batch.mfg_date || null,
                  batch.expDate || batch.exp_date || null,
                  parseFloat(batch.quantity) || 0,
                  parseFloat(batch.costPrice || batch.cost_price) || 0,
                  parseFloat(batch.sellingPrice || batch.selling_price) || 0,
                  parseFloat(batch.purchasePrice || batch.purchase_price) || 0,
                  parseFloat(batch.mrp) || 0,
                  parseFloat(batch.batchPrice || batch.batch_price) || 0,
                  barcode
                ];

                if (batch.id && existingMap.has(batch.id)) {
                  const existingBatchNumber = existingMap.get(batch.id);
                  updateBatches.push({ id: batch.id, data: [existingBatchNumber, ...bData] });
                } else {
                  newBatchCounter++;
                  const batchNumber = String(lastBatchNumber + newBatchCounter).padStart(5, '0');
                  insertBatches.push([productId, batchNumber, ...bData]);
                }

                barcodeChecksRemaining--;
                if (barcodeChecksRemaining === 0) {
                  // Update existing batches
                  let updatesRemaining = updateBatches.length;
                  if (updatesRemaining === 0) {
                    insertNewBatches();
                  } else {
                    updateBatches.forEach(b => {
                      db.query(
                        `UPDATE batches SET 
                         batch_number=?, mfg_date=?, exp_date=?, quantity=?, cost_price=?, selling_price=?, purchase_price=?, mrp=?, batch_price=?, barcode=? 
                         WHERE id=?`,
                        [...b.data, b.id],
                        (err) => {
                          if (err) {
                            console.error('Error updating batch:', err);
                            return res.status(500).json({ success: false, message: 'Failed to update batch', error: err.message });
                          }
                          updatesRemaining--;
                          if (updatesRemaining === 0) {
                            insertNewBatches();
                          }
                        }
                      );
                    });
                  }
                }
              });
            });

            function insertNewBatches() {
              if (insertBatches.length > 0) {
                db.query(
                  `INSERT INTO batches 
                   (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode) 
                   VALUES ?`,
                  [insertBatches],
                  (err) => {
                    if (err) {
                      console.error('Error inserting batches:', err);
                      return res.status(500).json({ success: false, message: 'Failed to insert batches', error: err.message });
                    }
                    deleteRemovedBatches();
                  }
                );
              } else {
                deleteRemovedBatches();
              }
            }

            function deleteRemovedBatches() {
              const updatedBatchIds = batches.map(b => b.id).filter(id => id);
              if (updatedBatchIds.length > 0) {
                const placeholders = updatedBatchIds.map(() => '?').join(',');
                db.query(
                  `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
                  [productId, ...updatedBatchIds],
                  (err) => {
                    if (err) {
                      console.error('Error deleting batches:', err);
                      return res.status(500).json({ success: false, message: 'Failed to delete batches', error: err.message });
                    }
                    res.json({ success: true, message: 'Product updated successfully', id: productId });
                  }
                );
              } else if (batches.length === 0) {
                db.query('DELETE FROM batches WHERE product_id = ?', [productId], (err) => {
                  if (err) {
                    console.error('Error deleting batches:', err);
                    return res.status(500).json({ success: false, message: 'Failed to delete batches', error: err.message });
                  }
                  res.json({ success: true, message: 'Product updated successfully', id: productId });
                });
              } else {
                res.json({ success: true, message: 'Product updated successfully', id: productId });
              }
            }
          });
        });
      } else if (!data.maintain_batch) {
        db.query('DELETE FROM batches WHERE product_id = ?', [productId], (err) => {
          if (err) {
            console.error('Error deleting batches:', err);
            return res.status(500).json({ success: false, message: 'Failed to delete batches', error: err.message });
          }
          res.json({ success: true, message: 'Product updated successfully', id: productId });
        });
      } else {
        res.json({ success: true, message: 'Product updated successfully', id: productId });
      }
    }
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ success: false, message: 'Failed to update product', error: err.message });
  }
});

router.get('/batches/check-barcode/:barcode', (req, res) => {
  const barcode = req.params.barcode;
  db.query('SELECT COUNT(*) as count FROM batches WHERE barcode = ?', [barcode], (err, result) => {
    if (err) {
      console.error('Error checking barcode:', err);
      return res.status(500).json({ success: false, message: 'Failed to check barcode', error: err.message });
    }
    res.json({ available: result[0].count === 0 });
  });
});



// router.put("/products/:id", async (req, res) => {
//   const productId = req.params.id;
//   const data = req.body;
//   const { batches, ...productData } = data;

//   try {
//     if (Object.keys(productData).length > 0) {
//       const updateFields = Object.keys(productData).map(k => `${k} = ?`).join(', ');
//       const updateValues = Object.values(productData);
//       const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
//       await db.promise().query(updateSql, [...updateValues, productId]);
//     }

//     if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
//       const [existingBatches] = await db.promise().query("SELECT id, batch_number FROM batches WHERE product_id = ?", [productId]);
//       const existingMap = new Map(existingBatches.map(b => [b.id, b.batch_number]));

//       const [lastBatchRow] = await db.promise().query(
//         "SELECT batch_number FROM batches ORDER BY CAST(batch_number AS UNSIGNED) DESC LIMIT 1"
//       );
      
//       let lastBatchNumber = 0;
//       if (lastBatchRow.length > 0) {
//         lastBatchNumber = parseInt(lastBatchRow[0].batch_number) || 0;
//       }

//       let newBatchCounter = 0;
//       const insertBatches = [];
//       const updateBatches = [];

//       await Promise.all(batches.map(async (batch, idx) => {
//         let barcode = batch.barcode;
//         let isUnique = false;

//         while (!isUnique) {
//           if (!barcode) {
//             const timestamp = Date.now();
//             barcode = `B${timestamp}${idx}${Math.random().toString(36).substr(2,5)}`;
//           }

//           const [barcodeCheck] = await db.promise().query(
//             "SELECT COUNT(*) as count FROM batches WHERE barcode = ? AND id != ?",
//             [barcode, batch.id || 0]
//           );

//           if (barcodeCheck[0].count === 0) {
//             isUnique = true;
//           } else {
//             barcode = null;
//           }
//         }

//         const bData = [
//           batch.mfgDate || batch.mfg_date || null,
//           batch.expDate || batch.exp_date || null,
//           parseFloat(batch.quantity) || 0,
//           parseFloat(batch.costPrice || batch.cost_price) || 0,
//           parseFloat(batch.sellingPrice || batch.selling_price) || 0,
//           parseFloat(batch.purchasePrice || batch.purchase_price) || 0,
//           parseFloat(batch.mrp) || 0,
//           parseFloat(batch.batchPrice || batch.batch_price) || 0,
//           barcode
//         ];

//         if (batch.id && existingMap.has(batch.id)) {
//           const existingBatchNumber = existingMap.get(batch.id);
//           updateBatches.push({ 
//             id: batch.id, 
//             data: [existingBatchNumber, ...bData] 
//           });
//         } else {
//           newBatchCounter++;
//           const batchNumber = String(lastBatchNumber + newBatchCounter).padStart(5, "0");
//           insertBatches.push([productId, batchNumber, ...bData]);
//         }
//       }));

//       for (const b of updateBatches) {
//         await db.promise().query(
//           `UPDATE batches SET 
//            batch_number=?, mfg_date=?, exp_date=?, quantity=?, cost_price=?, selling_price=?, purchase_price=?, mrp=?, batch_price=?, barcode=? 
//            WHERE id=?`,
//           [...b.data, b.id]
//         );
//       }

//       if (insertBatches.length > 0) {
//         await db.promise().query(
//           `INSERT INTO batches 
//            (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode) 
//            VALUES ?`,
//           [insertBatches]
//         );
//       }

//       const updatedBatchIds = batches.map(b => b.id).filter(id => id);
//       if (updatedBatchIds.length > 0) {
//         const placeholders = updatedBatchIds.map(() => '?').join(',');
//         await db.promise().query(
//           `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
//           [productId, ...updatedBatchIds]
//         );
//       } else if (batches.length === 0) {
//         await db.promise().query("DELETE FROM batches WHERE product_id = ?", [productId]);
//       }
//     } else if (!data.maintain_batch) {
//       await db.promise().query("DELETE FROM batches WHERE product_id = ?", [productId]);
//     }

//     res.json({ success: true, message: "Product updated successfully", id: productId });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: "Failed to update product", error: err.message });
//   }
// });

// router.get("/batches/check-barcode/:barcode", async (req, res) => {
//   const barcode = req.params.barcode;
//   try {
//     const [result] = await db.promise().query(
//       "SELECT COUNT(*) as count FROM batches WHERE barcode = ?",
//       [barcode]
//     );
//     res.json({ available: result[0].count === 0 });
//   } catch (err) {
//     console.error("Error checking barcode:", err);
//     res.status(500).json({ success: false, message: "Failed to check barcode", error: err.message });
//   }
// });

// ------------------------- GET ALL PRODUCTS -------------------------
router.get("/products", async (req, res) => {
  try {
    const [results] = await db.promise().query("SELECT * FROM products");
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});



// ------------------------- GET SINGLE PRODUCT -------------------------
router.get("/products/:id", async (req, res) => {
  try {
    const [results] = await db.promise().query("SELECT * FROM products WHERE id = ?", [req.params.id]);
    res.json(results[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch product" });
  }
});

// ------------------------- DELETE PRODUCT -------------------------
router.delete("/products/:id", async (req, res) => {
  const productId = req.params.id;
  try {
    await db.promise().query("DELETE FROM stock WHERE product_id = ?", [productId]);
    await db.promise().query("DELETE FROM batches WHERE product_id = ?", [productId]);
    await db.promise().query("DELETE FROM products WHERE id = ?", [productId]);
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete product" });
  }
});

// ------------------------- GET PRODUCT BATCHES -------------------------
router.get("/products/:id/batches", async (req, res) => {
  try {
    const [results] = await db.promise().query(
      "SELECT * FROM batches WHERE product_id = ? ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch batches" });
  }
});

// ------------------------- UPDATE PRODUCT -------------------------
router.put("/products/:id", async (req, res) => {
  const productId = req.params.id;
  const data = req.body;
  const { batches, ...productData } = data;

  try {
    if (Object.keys(productData).length > 0) {
      const updateFields = Object.keys(productData).map(k => `${k} = ?`).join(', ');
      const updateValues = Object.values(productData);
      const updateSql = `UPDATE products SET ${updateFields} WHERE id = ?`;
      await db.promise().query(updateSql, [...updateValues, productId]);
    }

    // Handle batches if maintain_batch is true
    if (data.maintain_batch && Array.isArray(batches) && batches.length > 0) {
      // Get existing batches for this product to preserve their batch numbers
      const [existingBatches] = await db.promise().query("SELECT id, batch_number FROM batches WHERE product_id = ?", [productId]);
      const existingMap = new Map(existingBatches.map(b => [b.id, b.batch_number]));

      // Get the LAST batch number from ALL batches for NEW batches (global sequence)
      const [lastBatchRow] = await db.promise().query(
        "SELECT batch_number FROM batches ORDER BY CAST(batch_number AS UNSIGNED) DESC LIMIT 1"
      );
      
      let lastBatchNumber = 0;
      if (lastBatchRow.length > 0) {
        lastBatchNumber = parseInt(lastBatchRow[0].batch_number) || 0;
      }

      let newBatchCounter = 0;

      const insertBatches = [];
      const updateBatches = [];

      batches.forEach((batch, idx) => {
        const timestamp = Date.now();
        const barcode = batch.barcode || `B${timestamp}${idx}${Math.random().toString(36).substr(2,5)}`;

        const bData = [
          batch.mfgDate || batch.mfg_date || null,
          batch.expDate || batch.exp_date || null,
          parseFloat(batch.quantity) || 0,
          parseFloat(batch.costPrice || batch.cost_price) || 0,
          parseFloat(batch.sellingPrice || batch.selling_price) || 0,
          parseFloat(batch.purchasePrice || batch.purchase_price) || 0,
          parseFloat(batch.mrp) || 0,
          parseFloat(batch.batchPrice || batch.batch_price) || 0,
          barcode
        ];

        // If batch has an ID and exists in DB, preserve its batch number
        if (batch.id && existingMap.has(batch.id)) {
          const existingBatchNumber = existingMap.get(batch.id);
          updateBatches.push({ 
            id: batch.id, 
            data: [existingBatchNumber, ...bData] 
          });
        } else {
          // For new batches, assign global sequential numbers
          newBatchCounter++;
          const batchNumber = String(lastBatchNumber + newBatchCounter).padStart(5, "0");
          insertBatches.push([productId, batchNumber, ...bData]);
        }
      });

      // Update existing batches
      for (const b of updateBatches) {
        await db.promise().query(
          `UPDATE batches SET 
           batch_number=?, mfg_date=?, exp_date=?, quantity=?, cost_price=?, selling_price=?, purchase_price=?, mrp=?, batch_price=?, barcode=? 
           WHERE id=?`,
          [...b.data, b.id]
        );
      }

      // Insert new batches
      if (insertBatches.length > 0) {
        await db.promise().query(
          `INSERT INTO batches 
           (product_id, batch_number, mfg_date, exp_date, quantity, cost_price, selling_price, purchase_price, mrp, batch_price, barcode) 
           VALUES ?`,
          [insertBatches]
        );
      }

      // Delete removed batches
      const updatedBatchIds = batches.map(b => b.id).filter(id => id);
      if (updatedBatchIds.length > 0) {
        const placeholders = updatedBatchIds.map(() => '?').join(',');
        await db.promise().query(
          `DELETE FROM batches WHERE product_id = ? AND id NOT IN (${placeholders})`,
          [productId, ...updatedBatchIds]
        );
      } else if (batches.length === 0) {
        // If no batches left, delete all for this product
        await db.promise().query("DELETE FROM batches WHERE product_id = ?", [productId]);
      }
    } else if (!data.maintain_batch) {
      await db.promise().query("DELETE FROM batches WHERE product_id = ?", [productId]);
    }

    res.json({ success: true, message: "Product updated successfully", id: productId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update product", error: err.message });
  }
});

module.exports = router;
>>>>>>> 69cf85c84885d59d0810a90e9fddc0e233572e6b
