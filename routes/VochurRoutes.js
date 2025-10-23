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

          // 1. Insert into Voucher table with explicit VoucherID
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
            TaxSystem: 'GST'
          };

          console.log('Inserting voucher data with VoucherID:', nextVoucherId);
          console.log('GST Breakdown - CGST:', totalCGST, 'SGST:', totalSGST, 'IGST:', totalIGST);

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
            const stockData = {
              product_id: productId,
              price_per_unit: parseFloat(item.price) || 0,
              opening_stock: parseFloat(product.opening_stock) || 0,
              stock_in: 0,
              stock_out: quantity,
              balance_stock: newBalanceStock,
              date: new Date()
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
              }
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

// Get all transactions
router.get("/transactions", (req, res) => {
  db.query("SELECT * FROM Voucher ORDER BY VoucherID DESC", (err, results) => {
    if (err) {
      console.error('Error fetching transactions:', err);
      return res.status(500).send(err);
    }
    res.send(results);
  });
});

// Get single transaction
router.get("/transactions/:id", (req, res) => {
  db.query("SELECT * FROM Voucher WHERE VoucherID = ?", [req.params.id], (err, results) => {
    if (err) {
      console.error('Error fetching transaction:', err);
      return res.status(500).send(err);
    }
    res.send(results[0] || {});
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
    "SELECT MAX(VoucherID) as maxId FROM Voucher",
    "SHOW TABLE STATUS LIKE 'Voucher'"
  ];

  db.query(queries.join(';'), (err, results) => {
    if (err) {
      console.error('Error checking voucher status:', err);
      return res.status(500).send(err);
    }
    
    res.send({
      columnInfo: results[0][0],
      maxId: results[1][0],
      tableStatus: results[2][0]
    });
  });
});

module.exports = router;