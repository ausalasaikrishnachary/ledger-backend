const express = require('express');
const router = express.Router();
const db = require('../db');

// Get next sales invoice number
router.get("/next-invoice-number", async (req, res) => {
  try {
    const query = `
      SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 4) AS UNSIGNED)) as maxNumber 
      FROM Voucher 
      WHERE TransactionType = 'Sales' 
      AND InvoiceNumber LIKE 'INV%'
    `;
    
    db.query(query, (err, results) => {
      if (err) {
        console.error('Error fetching next invoice number:', err);
        return res.status(500).send({ error: 'Failed to get next invoice number' });
      }
      
      let nextNumber = 1;
      if (results[0].maxNumber !== null && !isNaN(results[0].maxNumber)) {
        nextNumber = parseInt(results[0].maxNumber) + 1;
      }
      
      const nextInvoiceNumber = `INV${nextNumber.toString().padStart(3, '0')}`;
      
      res.send({ nextInvoiceNumber });
    });
  } catch (error) {
    console.error('Error in next-invoice-number:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
});

// Get next purchase invoice number
// Get next purchase invoice number
router.get("/next-purchase-invoice-number", async (req, res) => {
  try {
    const query = `
      SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 5) AS UNSIGNED)) as maxNumber 
      FROM Voucher 
      WHERE TransactionType = 'Purchase' 
      AND InvoiceNumber LIKE 'PINV%'
    `;
    
    db.query(query, (err, results) => {
      if (err) {
        console.error('Error fetching next purchase invoice number:', err);
        return res.status(500).send({ error: 'Failed to get next purchase invoice number' });
      }
      
      let nextNumber = 1;
      if (results[0].maxNumber !== null && !isNaN(results[0].maxNumber)) {
        nextNumber = parseInt(results[0].maxNumber) + 1;
      }
      
      const nextInvoiceNumber = `PINV${nextNumber.toString().padStart(3, '0')}`;
      
      console.log('Next purchase invoice number calculated:', nextInvoiceNumber);
      res.send({ nextInvoiceNumber });
    });
  } catch (error) {
    console.error('Error in next-purchase-invoice-number:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
});

// Get next product invoice number
// router.get("/next-product-invoice-number", async (req, res) => {
//   try {
//     const query = `
//       SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 5) AS UNSIGNED)) as maxNumber 
//       FROM Voucher 
//       WHERE TransactionType = 'Product' 
//       AND InvoiceNumber LIKE 'PINV%'
//     `;
    
//     db.query(query, (err, results) => {
//       if (err) {
//         console.error('Error fetching next product invoice number:', err);
//         return res.status(500).send({ error: 'Failed to get next product invoice number' });
//       }
      
//       let nextNumber = 1;
//       if (results[0].maxNumber !== null && !isNaN(results[0].maxNumber)) {
//         nextNumber = parseInt(results[0].maxNumber) + 1;
//       }
      
//       const nextInvoiceNumber = `PINV${nextNumber.toString().padStart(3, '0')}`;
      
//       res.send({ nextInvoiceNumber });
//     });
//   } catch (error) {
//     console.error('Error in next-product-invoice-number:', error);
//     res.status(500).send({ error: 'Internal server error' });
//   }
// });

// Helper function for database queries
const queryPromise = (sql, params = [], connection = db) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

// Helper function to process transactions
const processTransaction = async (transactionData, transactionType, connection) => {
  try {
    // Get the next available VoucherID
    let nextVoucherId;
    try {
      const maxIdResult = await queryPromise("SELECT COALESCE(MAX(VoucherID), 0) + 1 as nextId FROM Voucher", [], connection);
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

    // Determine invoice number based on transaction type
    let invoiceNumber;
    let defaultInvoiceNumber;
    
    switch(transactionType) {
      case 'Sales':
        defaultInvoiceNumber = 'INV001';
        invoiceNumber = transactionData.invoiceNumber || defaultInvoiceNumber;
        break;
      case 'Purchase':
        defaultInvoiceNumber = 'PINV001';
        invoiceNumber = transactionData.invoiceNumber || defaultInvoiceNumber;
        break;
      case 'Product':
        defaultInvoiceNumber = 'PINV001';
        invoiceNumber = transactionData.invoiceNumber || defaultInvoiceNumber;
        break;
      default:
        defaultInvoiceNumber = 'INV001';
        invoiceNumber = transactionData.invoiceNumber || defaultInvoiceNumber;
    }

    console.log(`Using ${transactionType} invoice number:`, invoiceNumber);

    // Calculate totals
    const totalQty = transactionData.items.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity) || 0);
    }, 0);

    // Prepare voucher data
    const voucherData = {
      VoucherID: nextVoucherId,
      TransactionType: transactionType,
      VchNo: invoiceNumber,
      InvoiceNumber: invoiceNumber,
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

    console.log(`Inserting ${transactionType} voucher data with VoucherID:`, nextVoucherId, 'Invoice No:', invoiceNumber);

    // Insert into Voucher table
    const voucherResult = await queryPromise("INSERT INTO Voucher SET ?", voucherData, connection);
    const voucherId = voucherResult.insertId || nextVoucherId;
    console.log(`${transactionType} Voucher created with ID:`, voucherId);

    // Process each item and update stock
    for (const [index, item] of transactionData.items.entries()) {
      console.log(`Processing ${transactionType} item ${index + 1}:`, item);

      // Find product by name
      const productResult = await queryPromise(
        "SELECT id, balance_stock, stock_out, stock_in, opening_stock FROM products WHERE goods_name = ?",
        [item.product],
        connection
      );

      if (productResult.length === 0) {
        throw new Error(`Product not found: ${item.product}`);
      }

      const product = productResult[0];
      const productId = product.id;
      const quantity = parseFloat(item.quantity) || 0;

      console.log(`Product found: ID=${productId}, Current balance=${product.balance_stock}, Quantity=${quantity}`);

      let newStockIn, newStockOut, newBalanceStock;

      // Determine stock operation based on transaction type
      if (transactionType === 'Purchase') {
        // Purchase: Increase stock
        const currentStockIn = parseFloat(product.stock_in) || 0;
        const currentBalance = parseFloat(product.balance_stock) || 0;
        newStockIn = currentStockIn + quantity;
        newStockOut = parseFloat(product.stock_out) || 0;
        newBalanceStock = currentBalance + quantity;

        console.log(`Purchase stock calculation: Opening=${product.opening_stock}, StockIn=${currentStockIn} -> ${newStockIn}, Balance=${currentBalance} -> ${newBalanceStock}`);
      } else {
        // Sales or Product: Decrease stock
        const currentStockOut = parseFloat(product.stock_out) || 0;
        const currentBalance = parseFloat(product.balance_stock) || 0;
        
        // Check if sufficient stock is available
        if (currentBalance < quantity) {
          throw new Error(`Insufficient stock for ${item.product}. Available: ${currentBalance}, Required: ${quantity}`);
        }

        newStockIn = parseFloat(product.stock_in) || 0;
        newStockOut = currentStockOut + quantity;
        newBalanceStock = currentBalance - quantity;

        console.log(`${transactionType} stock calculation: Opening=${product.opening_stock}, StockOut=${currentStockOut} -> ${newStockOut}, Balance=${currentBalance} -> ${newBalanceStock}`);
      }

      // Update product stock in products table
      await queryPromise(
        "UPDATE products SET stock_in = ?, stock_out = ?, balance_stock = ? WHERE id = ?",
        [newStockIn, newStockOut, newBalanceStock, productId],
        connection
      );

      console.log(`Updated product ${productId}: stock_in=${newStockIn}, stock_out=${newStockOut}, balance_stock=${newBalanceStock}`);

      // Handle stock table - Create new stock record
      const stockData = {
        product_id: productId,
        price_per_unit: parseFloat(item.price) || 0,
        opening_stock: parseFloat(product.opening_stock) || 0,
        stock_in: transactionType === 'Purchase' ? quantity : 0,
        stock_out: transactionType === 'Purchase' ? 0 : quantity,
        balance_stock: newBalanceStock,
        batch_number: item.batch || null,
        voucher_id: voucherId,
        date: new Date()
      };

      await queryPromise("INSERT INTO stock SET ?", stockData, connection);
      console.log(`Created new ${transactionType} stock record for product ${productId}`);

      // Handle batch operations
      if (item.batch) {
        const batchResult = await queryPromise(
          "SELECT id, quantity FROM batches WHERE product_id = ? AND batch_number = ?",
          [productId, item.batch],
          connection
        );

        if (batchResult.length > 0) {
          // Update existing batch
          const batch = batchResult[0];
          const currentBatchQty = parseFloat(batch.quantity) || 0;
          let newBatchQty;

          if (transactionType === 'Purchase') {
            newBatchQty = currentBatchQty + quantity;
          } else {
            if (currentBatchQty < quantity) {
              throw new Error(`Insufficient batch quantity for ${item.batch}. Available: ${currentBatchQty}, Required: ${quantity}`);
            }
            newBatchQty = currentBatchQty - quantity;
          }

          await queryPromise(
            "UPDATE batches SET quantity = ?, updated_at = ? WHERE id = ?",
            [newBatchQty, new Date(), batch.id],
            connection
          );
          console.log(`Updated batch ${item.batch} for product ${productId}: ${currentBatchQty} -> ${newBatchQty}`);
        } else if (transactionType === 'Purchase') {
          // Create new batch for purchase
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
          
          await queryPromise("INSERT INTO batches SET ?", batchData, connection);
          console.log(`Created new batch ${item.batch} for product ${productId} with quantity=${quantity}`);
        } else {
          console.warn(`Batch ${item.batch} not found for product ${productId}`);
        }
      }
    }

    return {
      voucherId,
      invoiceNumber,
      taxType,
      totalCGST,
      totalSGST,
      totalIGST,
      batchDetails: JSON.parse(batchDetailsJson)
    };

  } catch (error) {
    console.error(`Error in ${transactionType} transaction processing:`, error);
    throw error;
  }
};

// Create Sales Transaction and Update Stock
router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  console.log('Received sales transaction data:', transactionData);
  
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

      processTransaction(transactionData, 'Sales', connection)
        .then((result) => {
          connection.commit((err) => {
            if (err) {
              console.error('Commit error:', err);
              return connection.rollback(() => {
                connection.release();
                res.status(500).send({ error: 'Transaction commit failed', details: err.message });
              });
            }
            connection.release();
            console.log('Sales transaction completed successfully');
            res.send({
              message: "Sales transaction completed successfully",
              voucherId: result.voucherId,
              invoiceNumber: result.invoiceNumber,
              stockUpdated: true,
              taxType: result.taxType,
              gstBreakdown: {
                cgst: result.totalCGST,
                sgst: result.totalSGST,
                igst: result.totalIGST
              },
              batchDetails: result.batchDetails
            });
          });
        })
        .catch((error) => {
          console.error('Sales transaction error:', error);
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
                error: 'Sales transaction failed', 
                details: error.message,
                code: error.code
              });
            }
          });
        });
    });
  });
});

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

      processTransaction(transactionData, 'Purchase', connection)
        .then((result) => {
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
              voucherId: result.voucherId,
              invoiceNumber: result.invoiceNumber,
              stockUpdated: true,
              taxType: result.taxType,
              gstBreakdown: {
                cgst: result.totalCGST,
                sgst: result.totalSGST,
                igst: result.totalIGST
              },
              batchDetails: result.batchDetails
            });
          });
        })
        .catch((error) => {
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
        });
    });
  });
});

// Create Product Transaction and Update Stock
router.post("/product-transaction", (req, res) => {
  const transactionData = req.body;
  console.log('Received product transaction data:', transactionData);
  
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

      processTransaction(transactionData, 'Product', connection)
        .then((result) => {
          connection.commit((err) => {
            if (err) {
              console.error('Commit error:', err);
              return connection.rollback(() => {
                connection.release();
                res.status(500).send({ error: 'Transaction commit failed', details: err.message });
              });
            }
            connection.release();
            console.log('Product transaction completed successfully');
            res.send({
              message: "Product transaction completed successfully",
              voucherId: result.voucherId,
              invoiceNumber: result.invoiceNumber,
              stockUpdated: true,
              taxType: result.taxType,
              gstBreakdown: {
                cgst: result.totalCGST,
                sgst: result.totalSGST,
                igst: result.totalIGST
              },
              batchDetails: result.batchDetails
            });
          });
        })
        .catch((error) => {
          console.error('Product transaction error:', error);
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
                error: 'Product transaction failed', 
                details: error.message,
                code: error.code
              });
            }
          });
        });
    });
  });
});

// Get last sales invoice number
router.get("/last-invoice", (req, res) => {
  const query = "SELECT VchNo FROM Voucher WHERE TransactionType = 'Sales' ORDER BY VoucherID DESC LIMIT 1";
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching last invoice number:', err);
      return res.status(500).send(err);
    }
    
    if (results.length === 0) {
      return res.send({ lastInvoiceNumber: null });
    }
    
    res.send({ lastInvoiceNumber: results[0].VchNo });
  });
});

// Get last purchase invoice number
// Get last purchase invoice number
router.get("/last-purchase-invoice", (req, res) => {
  const query = `
    SELECT InvoiceNumber 
    FROM Voucher 
    WHERE TransactionType = 'Purchase' 
    AND InvoiceNumber LIKE 'PINV%'
    ORDER BY VoucherID DESC 
    LIMIT 1`;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching last purchase invoice number:', err);
      return res.status(500).send(err);
    }
    
    if (results.length === 0) {
      return res.send({ lastInvoiceNumber: null });
    }
    
    console.log('Last purchase invoice found:', results[0].InvoiceNumber);
    res.send({ lastInvoiceNumber: results[0].InvoiceNumber });
  });
});

// Get last product invoice number
// router.get("/last-product-invoice", (req, res) => {
//   const query = "SELECT VchNo FROM Voucher WHERE TransactionType = 'Product' ORDER BY VoucherID DESC LIMIT 1";
  
//   db.query(query, (err, results) => {
//     if (err) {
//       console.error('Error fetching last product invoice number:', err);
//       return res.status(500).send(err);
//     }
    
//     if (results.length === 0) {
//       return res.send({ lastInvoiceNumber: null });
//     }
    
//     res.send({ lastInvoiceNumber: results[0].VchNo });
//   });
// });

// Get transaction with batch details
router.get("/transactions/:id", (req, res) => {
  const query = `
    SELECT 
      v.*, 
      JSON_UNQUOTE(BatchDetails) as batch_details,
      a.billing_address_line1,
      a.billing_address_line2,
      a.billing_city,
      a.billing_pin_code,
      a.billing_state,
      a.shipping_address_line1,
      a.shipping_address_line2,
      a.shipping_city,
      a.shipping_pin_code,
      a.shipping_state,
      a.gstin
    FROM Voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id
    WHERE v.VoucherID = ?
  `;
  
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

// Get stock history for a product with batch and voucher details
router.get("/stock-history/:productId", (req, res) => {
  const productId = req.params.productId;
  
  const query = `
    SELECT s.*, p.goods_name, v.VchNo as invoice_number, v.TransactionType
    FROM stock s 
    JOIN products p ON s.product_id = p.id 
    LEFT JOIN Voucher v ON s.voucher_id = v.VoucherID
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

// Get product transactions
router.get("/product-transactions", (req, res) => {
  db.query("SELECT * FROM Voucher WHERE TransactionType = 'Product' ORDER BY VoucherID DESC", (err, results) => {
    if (err) {
      console.error('Error fetching product transactions:', err);
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

// Get single product transaction
router.get("/product-transactions/:id", (req, res) => {
  db.query("SELECT * FROM Voucher WHERE VoucherID = ? AND TransactionType = 'Product'", [req.params.id], (err, results) => {
    if (err) {
      console.error('Error fetching product transaction:', err);
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

module.exports = router;