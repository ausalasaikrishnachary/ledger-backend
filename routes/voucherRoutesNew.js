const express = require('express');
const router = express.Router();
const db = require('../db');

// Get next sales invoice number
router.get("/next-invoice-number", async (req, res) => {
  try {
    const query = `
      SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 4) AS UNSIGNED)) as maxNumber 
      FROM voucher 
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

// Helper function for database queries
const queryPromise = (sql, params = [], connection = db) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

// Store PDF data for invoice
router.post("/transactions/:id/pdf", async (req, res) => {
  const voucherId = req.params.id;
  const { pdfData, fileName } = req.body;
  
  console.log('Storing PDF for voucher:', voucherId);
  
  if (!pdfData || !fileName) {
    return res.status(400).json({
      success: false,
      message: 'PDF data and file name are required'
    });
  }

  try {
    const updateQuery = `
      UPDATE voucher 
      SET pdf_data = ?, pdf_file_name = ?, pdf_created_at = NOW() 
      WHERE VoucherID = ?
    `;
    
    db.query(updateQuery, [pdfData, fileName, voucherId], (err, results) => {
      if (err) {
        console.error('Error storing PDF:', err);
        return res.status(500).json({
          success: false,
          message: 'Failed to store PDF',
          error: err.message
        });
      }
      
      if (results.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Voucher not found'
        });
      }
      
      console.log('PDF stored successfully for voucher:', voucherId);
      res.json({
        success: true,
        message: 'PDF stored successfully',
        voucherId: voucherId,
        fileName: fileName
      });
    });
  } catch (error) {
    console.error('Error in PDF storage:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Get PDF data for invoice
router.get("/transactions/:id/pdf", (req, res) => {
  const voucherId = req.params.id;
  
  const query = `
    SELECT pdf_data, pdf_file_name, pdf_created_at 
    FROM voucher 
    WHERE VoucherID = ? AND pdf_data IS NOT NULL
  `;
  
  db.query(query, [voucherId], (err, results) => {
    if (err) {
      console.error('Error fetching PDF:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch PDF',
        error: err.message
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'PDF not found for this invoice'
      });
    }
    
    const pdfInfo = results[0];
    res.json({
      success: true,
      pdfData: pdfInfo.pdf_data,
      fileName: pdfInfo.pdf_file_name,
      createdAt: pdfInfo.pdf_created_at
    });
  });
});

// Download PDF endpoint
router.get("/transactions/:id/download-pdf", (req, res) => {
  const voucherId = req.params.id;
  
  console.log('Downloading PDF for voucher:', voucherId);
  
  const query = `
    SELECT pdf_data, pdf_file_name 
    FROM voucher 
    WHERE VoucherID = ? AND pdf_data IS NOT NULL
  `;
  
  db.query(query, [voucherId], (err, results) => {
    if (err) {
      console.error('Error fetching PDF for download:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch PDF'
      });
    }
    
    if (results.length === 0) {
      console.log('PDF not found for voucher:', voucherId);
      return res.status(404).json({
        success: false,
        message: 'PDF not found for this invoice'
      });
    }
    
    const pdfInfo = results[0];
    console.log('PDF found:', pdfInfo.pdf_file_name);
    
    try {
      // Extract base64 data (remove data URL prefix if present)
      let base64Data = pdfInfo.pdf_data;
      if (base64Data.startsWith('data:application/pdf;base64,')) {
        base64Data = base64Data.replace('data:application/pdf;base64,', '');
      }
      
      // Convert base64 to buffer
      const pdfBuffer = Buffer.from(base64Data, 'base64');
      
      // Set headers for file download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfInfo.pdf_file_name}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Cache-Control', 'no-cache');
      
      console.log('Sending PDF buffer, size:', pdfBuffer.length);
      
      // Send the PDF buffer
      res.send(pdfBuffer);
      
    } catch (error) {
      console.error('Error processing PDF data:', error);
      res.status(500).json({
        success: false,
        message: 'Error processing PDF data'
      });
    }
  });
});

// Delete invoice
router.delete("/transactions/:id", async (req, res) => {
  const voucherId = req.params.id;
  
  console.log('Deleting transaction with VoucherID:', voucherId);

  db.getConnection((err, connection) => {
    if (err) {
      console.error('Database connection error:', err);
      return res.status(500).send({ error: 'Database connection failed' });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error('Transaction begin error:', err);
        return res.status(500).send({ error: 'Transaction failed to start' });
      }

      try {
        // First, get the transaction data to reverse stock changes
        const voucherResult = await queryPromise(
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
        );

        if (voucherResult.length === 0) {
          throw new Error('Transaction not found');
        }

        const voucherData = voucherResult[0];
        console.log('Transaction to delete:', voucherData);

        // Parse batch details to get items and quantities
        let batchDetails = [];
        try {
          if (voucherData.BatchDetails) {
            batchDetails = typeof voucherData.BatchDetails === 'string' 
              ? JSON.parse(voucherData.BatchDetails) 
              : voucherData.BatchDetails;
          }
        } catch (error) {
          console.error('Error parsing batch details:', error);
        }

        // Reverse stock changes for each item
        for (const item of batchDetails) {
          const productResult = await queryPromise(
            "SELECT id, balance_stock, stock_out, stock_in FROM products WHERE goods_name = ?",
            [item.product],
            connection
          );

          if (productResult.length > 0) {
            const product = productResult[0];
            const quantity = parseFloat(item.quantity) || 0;
            
            // Reverse the stock operation based on transaction type
            if (voucherData.TransactionType === 'Sales') {
              // For sales, add back the stock that was deducted
              const currentStockOut = parseFloat(product.stock_out) || 0;
              const currentBalance = parseFloat(product.balance_stock) || 0;
              
              const newStockOut = Math.max(0, currentStockOut - quantity);
              const newBalanceStock = currentBalance + quantity;

              await queryPromise(
                "UPDATE products SET stock_out = ?, balance_stock = ? WHERE id = ?",
                [newStockOut, newBalanceStock, product.id],
                connection
              );

              console.log(`Reversed sales stock for ${item.product}: ${currentBalance} -> ${newBalanceStock}`);

              // Reverse batch changes for sales
              if (item.batch) {
                const batchResult = await queryPromise(
                  "SELECT id, quantity FROM batches WHERE product_id = ? AND batch_number = ?",
                  [product.id, item.batch],
                  connection
                );

                if (batchResult.length > 0) {
                  const batch = batchResult[0];
                  const currentBatchQty = parseFloat(batch.quantity) || 0;
                  const newBatchQty = currentBatchQty + quantity;

                  await queryPromise(
                    "UPDATE batches SET quantity = ?, updated_at = ? WHERE id = ?",
                    [newBatchQty, new Date(), batch.id],
                    connection
                  );

                  console.log(`Reversed batch for ${item.batch}: ${currentBatchQty} -> ${newBatchQty}`);
                }
              }
            }
          }
        }

        // Delete associated stock records - DELETE SEPARATE BATCH ENTRIES
        await queryPromise(
          "DELETE FROM stock WHERE voucher_id = ?",
          [voucherId],
          connection
        );

        // Delete ledger entry if exists
        await queryPromise(
          "DELETE FROM ledger WHERE voucherID = ?",
          [voucherId],
          connection
        );

        // Finally, delete the voucher record
        await queryPromise(
          "DELETE FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
        );

        // Commit the transaction
        connection.commit((commitErr) => {
          if (commitErr) {
            console.error('Commit error:', commitErr);
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({ error: 'Transaction commit failed', details: commitErr.message });
            });
          }
          connection.release();
          console.log('Transaction deleted successfully');
          res.send({
            success: true,
            message: "Invoice deleted successfully",
            voucherId: voucherId,
            stockReverted: true
          });
        });

      } catch (error) {
        console.error('Error deleting transaction:', error);
        connection.rollback(() => {
          connection.release();
          res.status(500).send({ 
            error: 'Failed to delete invoice', 
            details: error.message 
          });
        });
      }
    });
  });
});

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
    FROM voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id
    WHERE v.VoucherID = ?
  `;
    
  db.query(query, [req.params.id], (err, results) => {
    if (err) {
      console.error('Error fetching transaction:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: err.message
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = results[0];
    
    // Parse batch details from JSON string with better error handling
    try {
      if (transaction.batch_details) {
        if (typeof transaction.batch_details === 'string') {
          transaction.batch_details = JSON.parse(transaction.batch_details);
        }
      } else {
        transaction.batch_details = [];
      }
    } catch (error) {
      console.error('Error parsing batch details:', error);
      transaction.batch_details = [];
    }
    
    res.json({
      success: true,
      data: transaction
    });
  });
});

// Get all transactions with batch details
router.get("/transactions", (req, res) => {
  const query = "SELECT *, JSON_UNQUOTE(BatchDetails) as batch_details FROM voucher ORDER BY VoucherID DESC";
  
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
          // Extract data from your current structure
          const voucherID = result.voucherId || result.insertId;
          const date = transactionData.invoiceDate || new Date();
          const transactionType = transactionData.type || 'Sales';
          const accountID = transactionData.selectedSupplierId;
          const accountName = transactionData.supplierInfo?.name || 'Unknown Supplier';
          const amount = transactionData.grandTotal || '0.00';
          const paidAmount = transactionData.paid_amount || 0;

          console.log('Ledger data prepared:', {
            voucherID, date, transactionType, accountID, accountName, amount, paidAmount
          });

          // Validate voucherID - it should not be 0 or null
          if (!voucherID || voucherID === 0) {
            throw new Error(`Invalid voucher ID: ${voucherID}`);
          }

          // Validate required fields
          if (!accountID || isNaN(parseFloat(amount))) {
            throw new Error(`Missing required fields for ledger: voucherID=${voucherID}, accountID=${accountID}, amount=${amount}`);
          }

          // First, get the latest balance for the account
          const getBalanceQuery = `
            SELECT balance_amount 
            FROM ledger 
            WHERE AccountID = ? 
            ORDER BY created_at DESC, id DESC 
            LIMIT 1
          `;
          
          connection.query(getBalanceQuery, [accountID], (balanceErr, balanceResults) => {
            if (balanceErr) {
              console.error('Error fetching balance:', balanceErr);
              return connection.rollback(() => {
                connection.release();
                res.status(500).send({ error: 'Failed to fetch account balance', details: balanceErr.message });
              });
            }

            let previousBalance = 0;
            if (balanceResults.length > 0) {
              previousBalance = parseFloat(balanceResults[0].balance_amount) || 0;
            }

            const currentAmount = parseFloat(amount);
            const currentPaidAmount = parseFloat(paidAmount);
            
            // Calculate new balance correctly: previous balance + sales amount (debit)
            const newBalanceAfterSales = previousBalance + currentAmount;
            
            // Calculate final balance after payment (if any)
            const finalBalance = newBalanceAfterSales - currentPaidAmount;

            console.log(`Balance calculation: ${previousBalance} + ${currentAmount} - ${currentPaidAmount} = ${finalBalance}`);

            // Insert sales transaction into ledger (Debit)
            const salesLedgerQuery = `
              INSERT INTO ledger (
                voucherID, date, trantype, AccountID, AccountName, 
                Amount, balance_amount, DC, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const salesLedgerValues = [
              voucherID,
              date,
              transactionType,
              accountID,
              accountName,
              currentAmount,
              newBalanceAfterSales, // Balance after sales transaction
              'D', // Debit for sales transaction
              new Date()
            ];

            console.log('Executing sales ledger insert with values:', salesLedgerValues);

            connection.query(salesLedgerQuery, salesLedgerValues, (salesLedgerErr, salesLedgerResults) => {
              if (salesLedgerErr) {
                console.error('Sales ledger insert error:', salesLedgerErr);
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).send({ error: 'Failed to insert sales ledger entry', details: salesLedgerErr.message });
                });
              }

              // If there's a paid amount, insert a separate receipt entry (Credit)
              if (currentPaidAmount > 0) {
                const receiptLedgerQuery = `
                  INSERT INTO ledger (
                    voucherID, date, trantype, AccountID, AccountName, 
                    Amount, balance_amount, DC, created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const receiptLedgerValues = [
                  voucherID,
                  date,
                  'Receipt',
                  accountID,
                  accountName,
                  currentPaidAmount,
                  finalBalance, // Final balance after payment
                  'C', // Credit for receipt/payment
                  new Date()
                ];

                console.log('Executing receipt ledger insert with values:', receiptLedgerValues);

                connection.query(receiptLedgerQuery, receiptLedgerValues, (receiptLedgerErr, receiptLedgerResults) => {
                  if (receiptLedgerErr) {
                    console.error('Receipt ledger insert error:', receiptLedgerErr);
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).send({ error: 'Failed to insert receipt ledger entry', details: receiptLedgerErr.message });
                    });
                  }

                  commitTransaction(salesLedgerResults, receiptLedgerResults, finalBalance);
                });
              } else {
                commitTransaction(salesLedgerResults, null, newBalanceAfterSales);
              }

              function commitTransaction(salesEntry, receiptEntry, finalBalanceValue) {
                connection.commit((commitErr) => {
                  if (commitErr) {
                    console.error('Commit error:', commitErr);
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).send({ error: 'Transaction commit failed', details: commitErr.message });
                    });
                  }
                  connection.release();
                  console.log('Sales transaction and ledger entries completed successfully');
                  res.send({
                    message: "Sales transaction completed successfully",
                    voucherId: voucherID,
                    invoiceNumber: transactionData.invoiceNumber,
                    stockUpdated: true,
                    taxType: transactionData.taxType,
                    gstBreakdown: {
                      cgst: transactionData.totalCGST,
                      sgst: transactionData.totalSGST,
                      igst: transactionData.totalIGST
                    },
                    batchDetails: transactionData.batchDetails,
                    ledgerEntries: {
                      salesEntry: {
                        id: salesEntry.insertId,
                        amount: currentAmount,
                        type: 'Debit'
                      },
                      receiptEntry: currentPaidAmount > 0 ? {
                        id: receiptEntry.insertId,
                        amount: currentPaidAmount,
                        type: 'Credit'
                      } : null,
                      newBalance: finalBalanceValue
                    }
                  });
                });
              }
            });
          });
        })
        .catch((error) => {
          console.error('Sales transaction error:', error);
          connection.rollback(() => {
            connection.release();
            
            if (error.code === 'ER_BAD_FIELD_ERROR') {
              console.error('Database field error - checking table structure');
              connection.query("SHOW COLUMNS FROM voucher", (structErr, structResults) => {
                if (structErr) {
                  console.error('Error checking voucher structure:', structErr);
                } else {
                  console.log('Voucher table structure:', structResults);
                }
              });
            }
            
            res.status(500).send({ 
              error: 'Sales transaction failed', 
              details: error.message,
              code: error.code
            });
          });
        });
    });
  });
});

// Helper function to process transactions - FIXED PRODUCTS TABLE BALANCE CALCULATION
const processTransaction = async (transactionData, transactionType, connection) => {
  try {
    // Get the next available VoucherID
    let nextVoucherId;
    try {
      const maxIdResult = await queryPromise("SELECT COALESCE(MAX(VoucherID), 0) + 1 as nextId FROM voucher", [], connection);
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

    // Parse batch details
    let batchDetails = [];
    let batchDetailsJson = '[]';
    
    try {
      if (transactionData.batchDetails) {
        batchDetails = Array.isArray(transactionData.batchDetails) 
          ? transactionData.batchDetails 
          : JSON.parse(transactionData.batchDetails || '[]');
        
        // Ensure all batch details have proper numeric values
        batchDetails = batchDetails.map(item => ({
          product: item.product || '',
          product_id: item.product_id || null,
          description: item.description || '',
          batch: item.batch || '',
          batch_id: item.batch_id || null,
          quantity: parseFloat(item.quantity) || 0,
          price: parseFloat(item.price) || 0,
          discount: parseFloat(item.discount) || 0,
          gst: parseFloat(item.gst) || 0,
          cgst: parseFloat(item.cgst) || 0,
          sgst: parseFloat(item.sgst) || 0,
          igst: parseFloat(item.igst) || 0,
          cess: parseFloat(item.cess) || 0,
          total: parseFloat(item.total) || 0,
          batchDetails: item.batchDetails || null
        }));
        
        batchDetailsJson = JSON.stringify(batchDetails);
        console.log('Processed batch details:', batchDetails);
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

    // Calculate totals from batchDetails
    const totalQty = batchDetails.reduce((sum, item) => {
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
      TotalPacks: batchDetails.length,
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
    const voucherResult = await queryPromise("INSERT INTO voucher SET ?", voucherData, connection);
    const voucherId = voucherResult.insertId || nextVoucherId;
    console.log(`${transactionType} Voucher created with ID:`, voucherId);

    // Process each item from batchDetails
    for (const [index, item] of batchDetails.entries()) {
      console.log(`Processing ${transactionType} item ${index + 1}:`, item);

      // Validate quantity
      const quantity = parseFloat(item.quantity) || 0;
      if (quantity <= 0) {
        console.warn(`Skipping item with invalid quantity: ${item.product} - ${quantity}`);
        continue;
      }

      // Find product by name
      const productResult = await queryPromise(
        "SELECT id, balance_stock, stock_out, stock_in, opening_stock, maintain_batch FROM products WHERE goods_name = ?",
        [item.product],
        connection
      );

      if (productResult.length === 0) {
        throw new Error(`Product not found: ${item.product}`);
      }

      const product = productResult[0];
      const productId = product.id;
      const maintainBatch = product.maintain_batch;

      console.log(`Product found: ID=${productId}, Current balance=${product.balance_stock}, Maintain Batch=${maintainBatch}, Quantity=${quantity}`);

      // ========== FIXED: CORRECT PRODUCTS TABLE CALCULATION ==========
      let newStockIn, newStockOut, newBalanceStock;

      // Get current values from products table
      const currentOpeningStock = parseFloat(product.opening_stock) || 0;
      const currentStockIn = parseFloat(product.stock_in) || 0;
      const currentStockOut = parseFloat(product.stock_out) || 0;
      const currentBalance = parseFloat(product.balance_stock) || 0;

      // Determine stock operation based on transaction type
      if (transactionType === 'Purchase') {
        // Purchase: Increase stock
        newStockIn = currentStockIn + quantity;
        newStockOut = currentStockOut; // No change to stock_out for purchases
        newBalanceStock = currentOpeningStock + newStockIn - newStockOut;

        console.log(`Purchase stock calculation: Opening=${currentOpeningStock}, StockIn=${currentStockIn} -> ${newStockIn}, StockOut=${newStockOut}, Balance=${currentBalance} -> ${newBalanceStock}`);
      } else {
        // Sales: Decrease stock
        // Check if sufficient stock is available
        if (currentBalance < quantity) {
          throw new Error(`Insufficient stock for ${item.product}. Available: ${currentBalance}, Required: ${quantity}`);
        }

        newStockIn = currentStockIn; // No change to stock_in for sales
        newStockOut = currentStockOut + quantity;
        newBalanceStock = currentOpeningStock + newStockIn - newStockOut;

        console.log(`Sales stock calculation: Opening=${currentOpeningStock}, StockIn=${newStockIn}, StockOut=${currentStockOut} -> ${newStockOut}, Balance=${currentBalance} -> ${newBalanceStock}`);
      }

      // Update product stock in products table with CORRECT calculation
      await queryPromise(
        "UPDATE products SET stock_in = ?, stock_out = ?, balance_stock = ? WHERE id = ?",
        [newStockIn, newStockOut, newBalanceStock, productId],
        connection
      );

      console.log(`✅ Updated product ${productId}: opening_stock=${currentOpeningStock}, stock_in=${newStockIn}, stock_out=${newStockOut}, balance_stock=${newBalanceStock}`);

      // Handle batch operations and stock table insertion
      if (maintainBatch && item.batch) {
        // ========== FIXED: BATCH PRODUCT STOCK LOGIC ==========
        const batchResult = await queryPromise(
          "SELECT id, quantity FROM batches WHERE product_id = ? AND batch_number = ?",
          [productId, item.batch],
          connection
        );

        if (batchResult.length > 0) {
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

          // ========== FIXED: CONSTANT OPENING STOCK FOR BATCHES ==========
          // Get the ORIGINAL opening stock from the FIRST stock record for this batch
          const originalStockResult = await queryPromise(
            "SELECT opening_stock FROM stock WHERE product_id = ? AND batch_number = ? ORDER BY date ASC, id ASC LIMIT 1",
            [productId, item.batch],
            connection
          );

          let openingStockForStockTable;
          if (originalStockResult.length > 0) {
            // Use the ORIGINAL opening stock (constant value)
            openingStockForStockTable = parseFloat(originalStockResult[0].opening_stock) || 0;
          } else {
            // If no previous record, use current batch quantity as opening stock
            openingStockForStockTable = currentBatchQty + quantity; // Add back the quantity we're about to deduct
          }

          const stockIn = transactionType === 'Purchase' ? quantity : 0;
          const stockOut = transactionType === 'Purchase' ? 0 : quantity;
          
          // Calculate cumulative stock_out for this batch
          const cumulativeStockOutResult = await queryPromise(
            "SELECT COALESCE(SUM(stock_out), 0) as total_stock_out FROM stock WHERE product_id = ? AND batch_number = ?",
            [productId, item.batch],
            connection
          );
          
          const cumulativeStockOut = parseFloat(cumulativeStockOutResult[0].total_stock_out) || 0;
          const totalStockOutForThisEntry = cumulativeStockOut + stockOut;
          
          // Balance stock = Opening stock - Cumulative stock_out
          const balanceStockForStockTable = openingStockForStockTable - totalStockOutForThisEntry;

          const stockData = {
            product_id: productId,
            price_per_unit: parseFloat(item.price) || 0,
            opening_stock: openingStockForStockTable, // CONSTANT opening stock
            stock_in: stockIn,
            stock_out: stockOut,
            balance_stock: balanceStockForStockTable, // Opening stock - cumulative stock_out
            batch_number: item.batch,
            voucher_id: voucherId,
            date: new Date()
          };

          await queryPromise("INSERT INTO stock SET ?", stockData, connection);
          console.log(`Created stock record for batch product ${productId}, batch ${item.batch}`);
          console.log(`Stock calculation: Opening=${openingStockForStockTable}, StockIn=${stockIn}, StockOut=${stockOut}, CumulativeStockOut=${totalStockOutForThisEntry}, Balance=${balanceStockForStockTable}`);

        } else if (transactionType === 'Purchase') {
          // Create new batch for purchase
          const batchData = {
            product_id: productId,
            batch_number: item.batch,
            quantity: quantity,
            manufacturing_date: new Date(),
            expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            purchase_price: parseFloat(item.price) || 0,
            created_at: new Date(),
            updated_at: new Date()
          };
          
          await queryPromise("INSERT INTO batches SET ?", batchData, connection);
          console.log(`Created new batch ${item.batch} for product ${productId} with quantity=${quantity}`);

          // Stock table entry for new batch purchase
          const stockData = {
            product_id: productId,
            price_per_unit: parseFloat(item.price) || 0,
            opening_stock: quantity, // Opening stock = initial quantity
            stock_in: quantity,
            stock_out: 0,
            balance_stock: quantity, // Balance = opening stock (since no stock_out yet)
            batch_number: item.batch,
            voucher_id: voucherId,
            date: new Date()
          };

          await queryPromise("INSERT INTO stock SET ?", stockData, connection);
        } else {
          console.warn(`Batch ${item.batch} not found for product ${productId}`);
        }
      } else {
        // ========== FIXED: NON-BATCH PRODUCT STOCK LOGIC ==========
        // For non-batch products, use the CONSTANT opening_stock from products table
        const openingStockForNonBatch = parseFloat(product.opening_stock) || 0;
        
        const stockIn = transactionType === 'Purchase' ? quantity : 0;
        const stockOut = transactionType === 'Purchase' ? 0 : quantity;
        
        // Calculate cumulative stock_out for this product
        const cumulativeStockOutResult = await queryPromise(
          "SELECT COALESCE(SUM(stock_out), 0) as total_stock_out FROM stock WHERE product_id = ? AND batch_number = '-'",
          [productId],
          connection
        );
        
        const cumulativeStockOut = parseFloat(cumulativeStockOutResult[0].total_stock_out) || 0;
        const totalStockOutForThisEntry = cumulativeStockOut + stockOut;
        
        // Balance stock = Opening stock - Cumulative stock_out
        const balanceStockForNonBatch = openingStockForNonBatch - totalStockOutForThisEntry;

        const stockData = {
          product_id: productId,
          price_per_unit: parseFloat(item.price) || 0,
          opening_stock: openingStockForNonBatch, // CONSTANT opening stock from products table
          stock_in: stockIn,
          stock_out: stockOut,
          balance_stock: balanceStockForNonBatch, // Opening stock - cumulative stock_out
          batch_number: '-',
          voucher_id: voucherId,
          date: new Date()
        };

        await queryPromise("INSERT INTO stock SET ?", stockData, connection);
        console.log(`Created stock record for non-batch product ${productId}`);
        console.log(`Stock calculation: Opening=${openingStockForNonBatch}, StockIn=${stockIn}, StockOut=${stockOut}, CumulativeStockOut=${totalStockOutForThisEntry}, Balance=${balanceStockForNonBatch}`);
      }
    }

    return {
      voucherId,
      invoiceNumber,
      taxType,
      totalCGST,
      totalSGST,
      totalIGST,
      batchDetails: batchDetails
    };

  } catch (error) {
    console.error(`Error in ${transactionType} transaction processing:`, error);
    throw error;
  }
};

// Get all vouchers for invoice number
router.get('/invoices/:invoiceNumber', async (req, res) => {
  let connection;
  try {
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    const { invoiceNumber } = req.params;
    
    const query = `
      SELECT 
        VoucherID,
        TransactionType,
        VchNo,
        InvoiceNumber,
        Date,
        PaymentTerms,
        Freight,
        TotalQty,
        TotalPacks,
        TotalQty1,
        TaxAmount,
        Subtotal,
        BillSundryAmount,
        TotalAmount,
        ChequeNo,
        ChequeDate,
        BankName,
        AccountID,
        AccountName,
        PartyID,
        PartyName,
        BasicAmount,
        ValueOfGoods,
        EntryDate,
        SGSTPercentage,
        CGSTPercentage,
        IGSTPercentage,
        SGSTAmount,
        CGSTAmount,
        IGSTAmount,
        TaxSystem,
        BatchDetails,
        paid_amount,
        balance_amount,
        receipt_number,
        status,
        paid_date,
        pdf_data,
        pdf_file_name,
        pdf_created_at,
        created_at
      FROM voucher 
      WHERE InvoiceNumber = ?
      ORDER BY 
        CASE WHEN TransactionType = 'Sales' THEN 1 ELSE 2 END,
        created_at ASC
    `;
    
    const results = await new Promise((resolve, reject) => {
      connection.execute(query, [invoiceNumber], (error, results) => {
        if (error) reject(error);
        else resolve(results);
      });
    });
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }
    
    // Separate sales and receipt entries
    const salesEntry = results.find(item => item.TransactionType === 'Sales');
    const receiptEntries = results.filter(item => item.TransactionType === 'Receipt');
    
    res.json({
      success: true,
      data: {
        sales: salesEntry,
        receipts: receiptEntries,
        allEntries: results
      }
    });
    
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Get last invoice number
router.get("/last-invoice", (req, res) => {
  const query = "SELECT VchNo FROM voucher WHERE TransactionType = 'Sales' ORDER BY VoucherID DESC LIMIT 1";
  
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

// Update transaction endpoint - COMPLETELY FIXED VERSION
// Update transaction endpoint - FIXED VERSION with proper batch opening stock
router.put("/transactions/:id", async (req, res) => {
  const voucherId = req.params.id;
  const updateData = req.body;
  
  console.log('Updating transaction:', voucherId, updateData);
  
  db.getConnection((err, connection) => {
    if (err) {
      console.error('Database connection error:', err);
      return res.status(500).send({ error: 'Database connection failed' });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error('Transaction begin error:', err);
        return res.status(500).send({ error: 'Transaction failed to start' });
      }

      try {
        // First, get the original transaction data to reverse stock changes
        const originalVoucherResult = await queryPromise(
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
        );

        if (originalVoucherResult.length === 0) {
          throw new Error('Transaction not found');
        }

        const originalVoucherData = originalVoucherResult[0];
        
        // Parse original batch details to reverse stock
        let originalBatchDetails = [];
        try {
          if (originalVoucherData.BatchDetails) {
            originalBatchDetails = typeof originalVoucherData.BatchDetails === 'string' 
              ? JSON.parse(originalVoucherData.BatchDetails) 
              : originalVoucherData.BatchDetails;
          }
        } catch (error) {
          console.error('Error parsing original batch details:', error);
        }

        // Reverse original stock changes
        console.log('Reversing original stock changes...');
        for (const item of originalBatchDetails) {
          const productResult = await queryPromise(
            "SELECT id, balance_stock, stock_out, stock_in FROM products WHERE goods_name = ?",
            [item.product],
            connection
          );

          if (productResult.length > 0) {
            const product = productResult[0];
            const quantity = parseFloat(item.quantity) || 0;
            
            // Reverse the stock operation (add back stock for sales)
            if (originalVoucherData.TransactionType === 'Sales') {
              const currentStockOut = parseFloat(product.stock_out) || 0;
              const currentBalance = parseFloat(product.balance_stock) || 0;
              
              const newStockOut = Math.max(0, currentStockOut - quantity);
              const newBalanceStock = currentBalance + quantity;

              await queryPromise(
                "UPDATE products SET stock_out = ?, balance_stock = ? WHERE id = ?",
                [newStockOut, newBalanceStock, product.id],
                connection
              );

              console.log(`Reversed original stock for ${item.product}: ${currentBalance} -> ${newBalanceStock}`);

              // Reverse batch changes
              if (item.batch) {
                const batchResult = await queryPromise(
                  "SELECT id, quantity FROM batches WHERE product_id = ? AND batch_number = ?",
                  [product.id, item.batch],
                  connection
                );

                if (batchResult.length > 0) {
                  const batch = batchResult[0];
                  const currentBatchQty = parseFloat(batch.quantity) || 0;
                  const newBatchQty = currentBatchQty + quantity;

                  await queryPromise(
                    "UPDATE batches SET quantity = ?, updated_at = ? WHERE id = ?",
                    [newBatchQty, new Date(), batch.id],
                    connection
                  );

                  console.log(`Reversed original batch for ${item.batch}: ${currentBatchQty} -> ${newBatchQty}`);
                }
              }
            }
          }
        }

        // Delete original stock records
        await queryPromise(
          "DELETE FROM stock WHERE voucher_id = ?",
          [voucherId],
          connection
        );

        // Parse new batch details from update data
        let newBatchDetails = [];
        let newBatchDetailsJson = '[]';
        
        try {
          if (updateData.batchDetails) {
            newBatchDetails = Array.isArray(updateData.batchDetails) 
              ? updateData.batchDetails 
              : JSON.parse(updateData.batchDetails || '[]');
            
            newBatchDetails = newBatchDetails.map(item => ({
              product: item.product || '',
              product_id: item.product_id || null,
              description: item.description || '',
              batch: item.batch || '',
              batch_id: item.batch_id || null,
              quantity: parseFloat(item.quantity) || 0,
              price: parseFloat(item.price) || 0,
              discount: parseFloat(item.discount) || 0,
              gst: parseFloat(item.gst) || 0,
              cgst: parseFloat(item.cgst) || 0,
              sgst: parseFloat(item.sgst) || 0,
              igst: parseFloat(item.igst) || 0,
              cess: parseFloat(item.cess) || 0,
              total: parseFloat(item.total) || 0,
              batchDetails: item.batchDetails || null
            }));
            
            newBatchDetailsJson = JSON.stringify(newBatchDetails);
          }
        } catch (error) {
          console.error('Error parsing new batch details:', error);
          newBatchDetailsJson = '[]';
        }

        // Calculate totals from new batch details
        const totalQty = newBatchDetails.reduce((sum, item) => {
          return sum + (parseFloat(item.quantity) || 0);
        }, 0);

        // Update voucher record with new data - REMOVED updated_at column
        const updateQuery = `
          UPDATE voucher 
          SET 
            InvoiceNumber = ?,
            Date = ?,
            PartyName = ?,
            BasicAmount = ?,
            TaxAmount = ?,
            TotalAmount = ?,
            TotalQty = ?,
            BatchDetails = ?
          WHERE VoucherID = ?
        `;
        
        const updateValues = [
          updateData.invoiceNumber || originalVoucherData.InvoiceNumber,
          updateData.invoiceDate || originalVoucherData.Date,
          updateData.supplierInfo?.name || originalVoucherData.PartyName,
          parseFloat(updateData.taxableAmount) || parseFloat(originalVoucherData.BasicAmount) || 0,
          parseFloat(updateData.totalGST) || parseFloat(originalVoucherData.TaxAmount) || 0,
          parseFloat(updateData.grandTotal) || parseFloat(originalVoucherData.TotalAmount) || 0,
          totalQty,
          newBatchDetailsJson,
          voucherId
        ];
        
        await queryPromise(updateQuery, updateValues, connection);

        // Apply new stock changes
        console.log('Applying new stock changes...');
        for (const item of newBatchDetails) {
          const productResult = await queryPromise(
            "SELECT id, balance_stock, stock_out, stock_in FROM products WHERE goods_name = ?",
            [item.product],
            connection
          );

          if (productResult.length > 0) {
            const product = productResult[0];
            const quantity = parseFloat(item.quantity) || 0;

            // For sales, deduct stock
            if (originalVoucherData.TransactionType === 'Sales') {
              const currentStockOut = parseFloat(product.stock_out) || 0;
              const currentBalance = parseFloat(product.balance_stock) || 0;
              
              // Check if sufficient stock is available
              if (currentBalance < quantity) {
                throw new Error(`Insufficient stock for ${item.product}. Available: ${currentBalance}, Required: ${quantity}`);
              }

              const newStockOut = currentStockOut + quantity;
              const newBalanceStock = currentBalance - quantity;

              await queryPromise(
                "UPDATE products SET stock_out = ?, balance_stock = ? WHERE id = ?",
                [newStockOut, newBalanceStock, product.id],
                connection
              );

              console.log(`Applied new stock for ${item.product}: ${currentBalance} -> ${newBalanceStock}`);

              // FIXED: Get batch quantity for opening stock
              let batchOpeningStock = 0;
              if (item.batch) {
                const batchResult = await queryPromise(
                  "SELECT quantity FROM batches WHERE product_id = ? AND batch_number = ?",
                  [product.id, item.batch],
                  connection
                );
                
                if (batchResult.length > 0) {
                  batchOpeningStock = parseFloat(batchResult[0].quantity) || 0;
                }
              }

              // Calculate correct balance stock using the formula: opening_stock + stock_in - stock_out
              const stockIn = 0; // For sales, stock_in is always 0
              const stockOut = quantity;
              const calculatedBalanceStock = batchOpeningStock + stockIn - stockOut;

              // Create new stock record for each batch with proper opening stock
              const stockData = {
                product_id: product.id,
                price_per_unit: parseFloat(item.price) || 0,
                opening_stock: batchOpeningStock, // Use actual batch quantity
                stock_in: stockIn,
                stock_out: stockOut,
                balance_stock: calculatedBalanceStock, // Use calculated balance
                batch_number: item.batch || null,
                voucher_id: voucherId,
                date: new Date()
              };

              await queryPromise("INSERT INTO stock SET ?", stockData, connection);
              console.log(`Created new stock record for product ${product.id}, batch ${item.batch} with opening stock: ${batchOpeningStock}`);

              // Update batch quantities
              if (item.batch) {
                const batchResult = await queryPromise(
                  "SELECT id, quantity FROM batches WHERE product_id = ? AND batch_number = ?",
                  [product.id, item.batch],
                  connection
                );

                if (batchResult.length > 0) {
                  const batch = batchResult[0];
                  const currentBatchQty = parseFloat(batch.quantity) || 0;
                  
                  if (currentBatchQty < quantity) {
                    throw new Error(`Insufficient batch quantity for ${item.batch}. Available: ${currentBatchQty}, Required: ${quantity}`);
                  }
                  
                  const newBatchQty = currentBatchQty - quantity;

                  await queryPromise(
                    "UPDATE batches SET quantity = ?, updated_at = ? WHERE id = ?",
                    [newBatchQty, new Date(), batch.id],
                    connection
                  );

                  console.log(`Updated batch ${item.batch} for product ${product.id}: ${currentBatchQty} -> ${newBatchQty}`);
                }
              }
            }
          }
        }

        // Update ledger entry if amount changed
        const originalAmount = parseFloat(originalVoucherData.TotalAmount) || 0;
        const newAmount = parseFloat(updateData.grandTotal) || parseFloat(originalVoucherData.TotalAmount) || 0;
        
        if (originalAmount !== newAmount) {
          await queryPromise(
            "UPDATE ledger SET Amount = ?, balance_amount = balance_amount - ? + ? WHERE voucherID = ?",
            [newAmount, originalAmount, newAmount, voucherId],
            connection
          );
          console.log(`Updated ledger entry for voucher ${voucherId}: ${originalAmount} -> ${newAmount}`);
        }

        // Commit the transaction
        connection.commit((commitErr) => {
          if (commitErr) {
            console.error('Commit error:', commitErr);
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({ error: 'Transaction commit failed', details: commitErr.message });
            });
          }
          connection.release();
          console.log('Transaction updated successfully');
          res.json({
            success: true,
            message: 'Transaction updated successfully',
            voucherId: voucherId,
            stockUpdated: true
          });
        });

      } catch (error) {
        console.error('Error updating transaction:', error);
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            success: false,
            message: 'Failed to update transaction',
            error: error.message
          });
        });
      }
    });
  });
});



 router.get("/ledger", (req, res) => {
  const query = `
    SELECT 
      id,
      voucherID,
      date,
      trantype,
      AccountID,
      AccountName,
      Amount,
      balance_amount,
      DC,
      created_at
    FROM ledger
    ORDER BY AccountID, id DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching ledger data:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }

    res.status(200).json(results);

  })

})


module.exports = router;