const express = require('express');
const router = express.Router();
const db = require('./../../db'); // Adjust path as per your project structure

// ledger-backend/routes/Inventory/inventoryRoutes.js


router.post('/products', (req, res) => {
  const data = req.body;

  try {
    data.balance_stock = parseFloat(data.opening_stock) || 0;
    data.created_at = new Date();
    const { batches, ...productData } = data;

    // Insert product
    const columns = Object.keys(productData).join(', ');
    const placeholders = Object.keys(productData).map(() => '?').join(', ');
    const values = Object.values(productData);

    const productSql = `INSERT INTO products (${columns}) VALUES (${placeholders})`;
    db.query(productSql, values, (err, productInsert) => {
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
