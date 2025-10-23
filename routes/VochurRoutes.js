const express = require('express');
const router = express.Router();
const db = require('../db');

// Create Transaction and Update Stock
router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  console.log('Received transaction data:', transactionData);
  
  // Start transaction
  db.getConnection((err, connection) => {
    if (err) {
      console.error('Database connection error:', err);
      return res.status(500).send({ error: 'Database connection failed' });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error('Transaction begin error:', err);
        return res.status(500).send({ error: 'Transaction failed to start' });
      }

      // Helper function for promises
      const queryPromise = (sql, params = []) => {
        return new Promise((resolve, reject) => {
          connection.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });
      };

      const processTransaction = async () => {
        try {
          // First, get the next available VoucherID
          let nextVoucherId;
          try {
            const maxIdResult = await queryPromise("SELECT COALESCE(MAX(VoucherID), 0) + 1 as nextId FROM Voucher");
            nextVoucherId = maxIdResult[0].nextId;
            console.log('Next available VoucherID:', nextVoucherId);
          } catch (maxIdError) {
            console.error('Error getting next VoucherID:', maxIdError);
            nextVoucherId = 1; // Fallback to 1
          }

          // Calculate GST breakdown
          const totalCGST = parseFloat(transactionData.totalCGST) || 0;
          const totalSGST = parseFloat(transactionData.totalSGST) || 0;
          const totalIGST = parseFloat(transactionData.totalIGST) || 0;
          const taxType = transactionData.taxType || "CGST/SGST";

          // Parse batch details from JSON string
          let batchDetailsJson = '[]';
          try {
            if (transactionData.batchDetails) {
              batchDetailsJson = typeof transactionData.batchDetails === 'string' 
                ? transactionData.batchDetails 
                : JSON.stringify(transactionData.batchDetails);
            }
          } catch (error) {
            console.error('Error parsing batch details:', error);
            batchDetailsJson = '[]';
          }

          // 1. Insert into Voucher table with explicit VoucherID and BatchDetails
          const voucherSql = `INSERT INTO Voucher SET ?`;
          
          // Calculate totals safely
          const totalQty = transactionData.items.reduce((sum, item) => {
            return sum + (parseFloat(item.quantity) || 0);
          }, 0);

          // Only include columns that exist in the Voucher table
          const voucherData = {
            VoucherID: nextVoucherId,
            TransactionType: 'Sales',
            VchNo: transactionData.invoiceNumber || 'INV001',
            Date: transactionData.invoiceDate || new Date().toISOString().split('T')[0],
            PaymentTerms: 'Immediate',
            Freight: 0,
            TotalQty: totalQty,
            TotalPacks: transactionData.items.length,
            TotalQty1: totalQty,
            TaxAmount: parseFloat(transactionData.totalGST) || 0,
            Subtotal: parseFloat(transactionData.taxableAmount) || 0,
            BillSundryAmount: 0,
            TotalAmount: parseFloat(transactionData.grandTotal) || 0,
            ChequeNo: null,
            ChequeDate: null,
            BankName: null,
            AccountID: transactionData.selectedSupplierId || null,
            AccountName: transactionData.supplierInfo?.businessName || '',
            PartyID: transactionData.selectedSupplierId || null,
            PartyName: transactionData.supplierInfo?.name || '',
            BasicAmount: parseFloat(transactionData.taxableAmount) || 0,
            ValueOfGoods: parseFloat(transactionData.taxableAmount) || 0,
            EntryDate: new Date(),
            SGSTPercentage: taxType === "CGST/SGST" ? (totalSGST > 0 ? 50 : 0) : 0,
            CGSTPercentage: taxType === "CGST/SGST" ? (totalCGST > 0 ? 50 : 0) : 0,
            IGSTPercentage: taxType === "IGST" ? 100 : 0,
            SGSTAmount: totalSGST,
            CGSTAmount: totalCGST,
            IGSTAmount: totalIGST,
            TaxSystem: 'GST',
            BatchDetails: batchDetailsJson // New column for batch details
          };

          console.log('Inserting voucher data with VoucherID:', nextVoucherId);
          console.log('GST Breakdown - CGST:', totalCGST, 'SGST:', totalSGST, 'IGST:', totalIGST);
          console.log('Batch Details:', batchDetailsJson);

          const voucherResult = await queryPromise(voucherSql, voucherData);
          const voucherId = voucherResult.insertId || nextVoucherId;
          console.log('Voucher created with ID:', voucherId);

          // 2. Process each item and update stock
          for (const [index, item] of transactionData.items.entries()) {
            console.log(`Processing item ${index + 1}:`, item);

            // Find product by name
            const productResult = await queryPromise(
              "SELECT id, balance_stock, stock_out, stock_in, opening_stock FROM products WHERE goods_name = ?",
              [item.product]
            );

            if (productResult.length === 0) {
              throw new Error(`Product not found: ${item.product}`);
            }

            const product = productResult[0];
            const productId = product.id;
            const quantity = parseFloat(item.quantity) || 0;

            console.log(`Product found: ID=${productId}, Current balance=${product.balance_stock}, Quantity to deduct=${quantity}`);

            // Check if sufficient stock is available
            const currentBalance = parseFloat(product.balance_stock) || 0;
            if (currentBalance < quantity) {
              throw new Error(`Insufficient stock for ${item.product}. Available: ${currentBalance}, Required: ${quantity}`);
            }

            // Calculate new stock values
            const currentStockOut = parseFloat(product.stock_out) || 0;
            const newStockOut = currentStockOut + quantity;
            const newBalanceStock = currentBalance - quantity;

            console.log(`Stock calculation: Opening=${product.opening_stock}, StockOut=${currentStockOut} -> ${newStockOut}, Balance=${currentBalance} -> ${newBalanceStock}`);

            // Update product stock in products table
            await queryPromise(
              "UPDATE products SET stock_out = ?, balance_stock = ? WHERE id = ?",
              [newStockOut, newBalanceStock, productId]
            );

            console.log(`Updated product ${productId}: stock_out=${newStockOut}, balance_stock=${newBalanceStock}`);

            // Handle stock table - Create new stock record for this transaction
            // Use only existing columns in stock table
            const stockData = {
              product_id: productId,
              price_per_unit: parseFloat(item.price) || 0,
              opening_stock: parseFloat(product.opening_stock) || 0,
              stock_in: 0,
              stock_out: quantity,
              balance_stock: newBalanceStock,
              date: new Date()
              // Removed batch_number and voucher_id as they don't exist in stock table
            };

            await queryPromise("INSERT INTO stock SET ?", stockData);
            console.log(`Created new stock record for product ${productId} with stock_out=${quantity}`);

            // Update batch quantity if batch is selected
            if (item.batch) {
              const batchResult = await queryPromise(
                "SELECT id, quantity FROM batches WHERE product_id = ? AND batch_number = ?",
                [productId, item.batch]
              );

              if (batchResult.length > 0) {
                const batch = batchResult[0];
                const currentBatchQty = parseFloat(batch.quantity) || 0;
                
                if (currentBatchQty >= quantity) {
                  const newBatchQty = currentBatchQty - quantity;
                  await queryPromise(
                    "UPDATE batches SET quantity = ? WHERE id = ?",
                    [newBatchQty, batch.id]
                  );
                  console.log(`Updated batch ${item.batch} for product ${productId}: ${currentBatchQty} -> ${newBatchQty}`);
                } else {
                  throw new Error(`Insufficient batch quantity for ${item.batch}. Available: ${currentBatchQty}, Required: ${quantity}`);
                }
              } else {
                console.warn(`Batch ${item.batch} not found for product ${productId}`);
              }
            }
          }

          // Commit transaction
          connection.commit((err) => {
            if (err) {
              console.error('Commit error:', err);
              return connection.rollback(() => {
                connection.release();
                res.status(500).send({ error: 'Transaction commit failed', details: err.message });
              });
            }
            connection.release();
            console.log('Transaction completed successfully');
            res.send({
              message: "Transaction completed successfully",
              voucherId: voucherId,
              stockUpdated: true,
              taxType: taxType,
              gstBreakdown: {
                cgst: totalCGST,
                sgst: totalSGST,
                igst: totalIGST
              },
              batchDetails: JSON.parse(batchDetailsJson)
            });
          });

        } catch (error) {
          console.error('Transaction error:', error);
          connection.rollback(() => {
            connection.release();
            
            // Handle specific duplicate key error
            if (error.code === 'ER_DUP_ENTRY') {
              res.status(500).send({ 
                error: 'Database error: Duplicate entry detected. Please contact administrator to fix Voucher table auto-increment.',
                details: 'VoucherID primary key conflict',
                code: 'DUPLICATE_KEY_ERROR'
              });
            } else {
              res.status(500).send({ 
                error: 'Transaction failed', 
                details: error.message,
                code: error.code
              });
            }
          });
        }
      };

      processTransaction();
    });
  });
});

// Get transaction with batch details
router.get("/transactions/:id", (req, res) => {
  const query = "SELECT *, JSON_UNQUOTE(BatchDetails) as batch_details FROM Voucher WHERE VoucherID = ?";
  
  db.query(query, [req.params.id], (err, results) => {
    if (err) {
      console.error('Error fetching transaction:', err);
      return res.status(500).send(err);
    }
    
    if (results.length === 0) {
      return res.send({});
    }
    
    const transaction = results[0];
    
    // Parse batch details from JSON string
    try {
      if (transaction.batch_details) {
        transaction.batch_details = JSON.parse(transaction.batch_details);
      } else {
        transaction.batch_details = [];
      }
    } catch (error) {
      console.error('Error parsing batch details:', error);
      transaction.batch_details = [];
    }
    
    res.send(transaction);
  });
});

// Get all transactions with batch details
router.get("/transactions", (req, res) => {
  const query = "SELECT *, JSON_UNQUOTE(BatchDetails) as batch_details FROM Voucher ORDER BY VoucherID DESC";
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching transactions:', err);
      return res.status(500).send(err);
    }
    
    // Parse batch details for each transaction
    results.forEach(transaction => {
      try {
        if (transaction.batch_details) {
          transaction.batch_details = JSON.parse(transaction.batch_details);
        } else {
          transaction.batch_details = [];
        }
      } catch (error) {
        console.error('Error parsing batch details for transaction:', transaction.VoucherID, error);
        transaction.batch_details = [];
      }
    });
    
    res.send(results);
  });
});

// Get stock history for a product
router.get("/stock-history/:productId", (req, res) => {
  const productId = req.params.productId;
  
  const query = `
    SELECT s.*, p.goods_name 
    FROM stock s 
    JOIN products p ON s.product_id = p.id 
    WHERE s.product_id = ? 
    ORDER BY s.date DESC, s.id DESC
  `;

  db.query(query, [productId], (err, results) => {
    if (err) {
      console.error('Error fetching stock history:', err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Get current stock status for all products
router.get("/stock-status", (req, res) => {
  const query = `
    SELECT 
      id,
      goods_name,
      opening_stock,
      stock_in,
      stock_out,
      balance_stock,
      (opening_stock + stock_in - stock_out) as calculated_balance
    FROM products 
    ORDER BY goods_name
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching stock status:', err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.send({ status: "OK", message: "Transaction service is running" });
});

// Check Voucher table status
router.get("/voucher-status", (req, res) => {
  const queries = [
    "SHOW COLUMNS FROM Voucher LIKE 'VoucherID'",
    "SHOW COLUMNS FROM Voucher LIKE 'BatchDetails'",
    "SELECT MAX(VoucherID) as maxId FROM Voucher",
    "SHOW TABLE STATUS LIKE 'Voucher'"
  ];

  db.query(queries.join(';'), (err, results) => {
    if (err) {
      console.error('Error checking voucher status:', err);
      return res.status(500).send(err);
    }
    
    res.send({
      voucherIdColumn: results[0][0],
      batchDetailsColumn: results[1][0],
      maxId: results[2][0],
      tableStatus: results[3][0]
    });
  });
});

// Check Stock table structure
router.get("/stock-structure", (req, res) => {
  const query = "SHOW COLUMNS FROM stock";
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error checking stock structure:', err);
      return res.status(500).send(err);
    }
    
    res.send(results);
  });
});



// Create Purchase Transaction and Update Stock
// Create Purchase Transaction and Update Stock
router.post("/purchase-transaction", (req, res) => {
  const transactionData = req.body;
  console.log('Received purchase transaction data:', transactionData);
  
  db.getConnection((err, connection) => {
    if (err) {
      console.error('Database connection error:', err);
      return res.status(500).send({ error: 'Database connection failed' });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error('Transaction begin error:', err);
        return res.status(500).send({ error: 'Transaction failed to start' });
      }

      const queryPromise = (sql, params = []) => {
        return new Promise((resolve, reject) => {
          connection.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });
      };

      const processPurchaseTransaction = async () => {
        try {
          // Get the next available VoucherID
          let nextVoucherId;
          try {
            const maxIdResult = await queryPromise("SELECT COALESCE(MAX(VoucherID), 0) + 1 as nextId FROM Voucher");
            nextVoucherId = maxIdResult[0].nextId;
            console.log('Next available VoucherID:', nextVoucherId);
          } catch (maxIdError) {
            console.error('Error getting next VoucherID:', maxIdError);
            nextVoucherId = 1;
          }

          // Calculate GST breakdown
          const totalCGST = parseFloat(transactionData.totalCGST) || 0;
          const totalSGST = parseFloat(transactionData.totalSGST) || 0;
          const totalIGST = parseFloat(transactionData.totalIGST) || 0;
          const taxType = transactionData.taxType || "CGST/SGST";

          // Parse batch details from JSON string
          let batchDetailsJson = '[]';
          try {
            if (transactionData.batchDetails) {
              batchDetailsJson = typeof transactionData.batchDetails === 'string' 
                ? transactionData.batchDetails 
                : JSON.stringify(transactionData.batchDetails);
            }
          } catch (error) {
            console.error('Error parsing batch details:', error);
            batchDetailsJson = '[]';
          }

          // 1. Insert into Voucher table for purchase
          const voucherSql = `INSERT INTO Voucher SET ?`;
          
          const totalQty = transactionData.items.reduce((sum, item) => {
            return sum + (parseFloat(item.quantity) || 0);
          }, 0);

          const voucherData = {
            VoucherID: nextVoucherId,
            TransactionType: 'Purchase',
            VchNo: transactionData.invoiceNumber || 'PUR001',
            Date: transactionData.invoiceDate || new Date().toISOString().split('T')[0],
            PaymentTerms: 'Immediate',
            Freight: 0,
            TotalQty: totalQty,
            TotalPacks: transactionData.items.length,
            TotalQty1: totalQty,
            TaxAmount: parseFloat(transactionData.totalGST) || 0,
            Subtotal: parseFloat(transactionData.taxableAmount) || 0,
            BillSundryAmount: 0,
            TotalAmount: parseFloat(transactionData.grandTotal) || 0,
            ChequeNo: null,
            ChequeDate: null,
            BankName: null,
            AccountID: transactionData.selectedSupplierId || null,
            AccountName: transactionData.supplierInfo?.businessName || '',
            PartyID: transactionData.selectedSupplierId || null,
            PartyName: transactionData.supplierInfo?.name || '',
            BasicAmount: parseFloat(transactionData.taxableAmount) || 0,
            ValueOfGoods: parseFloat(transactionData.taxableAmount) || 0,
            EntryDate: new Date(),
            SGSTPercentage: taxType === "CGST/SGST" ? (totalSGST > 0 ? 50 : 0) : 0,
            CGSTPercentage: taxType === "CGST/SGST" ? (totalCGST > 0 ? 50 : 0) : 0,
            IGSTPercentage: taxType === "IGST" ? 100 : 0,
            SGSTAmount: totalSGST,
            CGSTAmount: totalCGST,
            IGSTAmount: totalIGST,
            TaxSystem: 'GST',
            BatchDetails: batchDetailsJson
          };

          console.log('Inserting purchase voucher data with VoucherID:', nextVoucherId);

          const voucherResult = await queryPromise(voucherSql, voucherData);
          const voucherId = voucherResult.insertId || nextVoucherId;
          console.log('Purchase Voucher created with ID:', voucherId);

          // 2. Process each item and update stock for purchase
          for (const [index, item] of transactionData.items.entries()) {
            console.log(`Processing purchase item ${index + 1}:`, item);

            // Find product by name
            const productResult = await queryPromise(
              "SELECT id, balance_stock, stock_out, stock_in, opening_stock FROM products WHERE goods_name = ?",
              [item.product]
            );

            if (productResult.length === 0) {
              throw new Error(`Product not found: ${item.product}`);
            }

            const product = productResult[0];
            const productId = product.id;
            const quantity = parseFloat(item.quantity) || 0;

            console.log(`Product found: ID=${productId}, Current balance=${product.balance_stock}, Quantity to add=${quantity}`);

            // Calculate new stock values for purchase (INCREASE stock)
            const currentStockIn = parseFloat(product.stock_in) || 0;
            const currentBalance = parseFloat(product.balance_stock) || 0;
            const newStockIn = currentStockIn + quantity;
            const newBalanceStock = currentBalance + quantity; // INCREASE balance stock

            console.log(`Purchase stock calculation: Opening=${product.opening_stock}, StockIn=${currentStockIn} -> ${newStockIn}, Balance=${currentBalance} -> ${newBalanceStock}`);

            // Update product stock in products table
            await queryPromise(
              "UPDATE products SET stock_in = ?, balance_stock = ? WHERE id = ?",
              [newStockIn, newBalanceStock, productId]
            );

            console.log(`Updated product ${productId}: stock_in=${newStockIn}, balance_stock=${newBalanceStock}`);

            // Handle stock table - Create new stock record for this purchase transaction
            // FIXED: Remove transaction_type column as it doesn't exist in stock table
            const stockData = {
              product_id: productId,
              price_per_unit: parseFloat(item.price) || 0,
              opening_stock: parseFloat(product.opening_stock) || 0,
              stock_in: quantity, // This is purchase, so stock_in increases
              stock_out: 0,
              balance_stock: newBalanceStock,
              date: new Date(),
              voucher_id: voucherId // Add voucher_id if needed
            };

            await queryPromise("INSERT INTO stock SET ?", stockData);
            console.log(`Created new purchase stock record for product ${productId} with stock_in=${quantity}`);

            // Handle batch - Create or update batch for purchase
            if (item.batch) {
              // Check if batch already exists
              const batchResult = await queryPromise(
                "SELECT id, quantity FROM batches WHERE product_id = ? AND batch_number = ?",
                [productId, item.batch]
              );

              if (batchResult.length > 0) {
                // Update existing batch
                const batch = batchResult[0];
                const currentBatchQty = parseFloat(batch.quantity) || 0;
                const newBatchQty = currentBatchQty + quantity; // INCREASE batch quantity
                
                await queryPromise(
                  "UPDATE batches SET quantity = ?, updated_at = ? WHERE id = ?",
                  [newBatchQty, new Date(), batch.id]
                );
                console.log(`Updated batch ${item.batch} for product ${productId}: ${currentBatchQty} -> ${newBatchQty}`);
              } else {
                // Create new batch
                const batchData = {
                  product_id: productId,
                  batch_number: item.batch,
                  quantity: quantity,
                  manufacturing_date: new Date(),
                  expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
                  purchase_price: parseFloat(item.price) || 0,
                  created_at: new Date(),
                  updated_at: new Date()
                };
                
                await queryPromise("INSERT INTO batches SET ?", batchData);
                console.log(`Created new batch ${item.batch} for product ${productId} with quantity=${quantity}`);
              }
            }
          }

          // Commit transaction
          connection.commit((err) => {
            if (err) {
              console.error('Commit error:', err);
              return connection.rollback(() => {
                connection.release();
                res.status(500).send({ error: 'Transaction commit failed', details: err.message });
              });
            }
            connection.release();
            console.log('Purchase transaction completed successfully');
            res.send({
              message: "Purchase transaction completed successfully",
              voucherId: voucherId,
              stockUpdated: true,
              taxType: taxType,
              gstBreakdown: {
                cgst: totalCGST,
                sgst: totalSGST,
                igst: totalIGST
              },
              batchDetails: JSON.parse(batchDetailsJson)
            });
          });

        } catch (error) {
          console.error('Purchase transaction error:', error);
          connection.rollback(() => {
            connection.release();
            
            if (error.code === 'ER_DUP_ENTRY') {
              res.status(500).send({ 
                error: 'Database error: Duplicate entry detected.',
                details: 'VoucherID primary key conflict',
                code: 'DUPLICATE_KEY_ERROR'
              });
            } else {
              res.status(500).send({ 
                error: 'Purchase transaction failed', 
                details: error.message,
                code: error.code
              });
            }
          });
        }
      };

      processPurchaseTransaction();
    });
  });
});

// Get purchase transactions
router.get("/purchase-transactions", (req, res) => {
  db.query("SELECT * FROM Voucher WHERE TransactionType = 'Purchase' ORDER BY VoucherID DESC", (err, results) => {
    if (err) {
      console.error('Error fetching purchase transactions:', err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Get single purchase transaction
router.get("/purchase-transactions/:id", (req, res) => {
  db.query("SELECT * FROM Voucher WHERE VoucherID = ? AND TransactionType = 'Purchase'", [req.params.id], (err, results) => {
    if (err) {
      console.error('Error fetching purchase transaction:', err);
      return res.status(500).send(err);
    }
    res.send(results[0] || {});
  });
});

// Get stock status with purchase history
router.get("/purchase-stock-status", (req, res) => {
  const query = `
    SELECT 
      p.id,
      p.goods_name,
      p.opening_stock,
      p.stock_in,
      p.stock_out,
      p.balance_stock,
      (p.opening_stock + p.stock_in - p.stock_out) as calculated_balance,
      COUNT(DISTINCT b.id) as batch_count
    FROM products p
    LEFT JOIN batches b ON p.id = b.product_id
    GROUP BY p.id
    ORDER BY p.goods_name
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching purchase stock status:', err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});


module.exports = router;







