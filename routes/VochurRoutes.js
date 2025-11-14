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
// const queryPromise = (sql, params = [], connection = db) => {
//   return new Promise((resolve, reject) => {
//     connection.query(sql, params, (err, results) => {
//       if (err) reject(err);
//       else resolve(results);
//     });
//   });
// };

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

// Helper function to wrap connection.query in a promise
function queryPromise(sql, params, connection) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

// DELETE invoice / transaction
// router.delete("/transactions/:id", async (req, res) => {
//   const voucherId = req.params.id;

//   console.log("Deleting transaction with VoucherID:", voucherId);

//   db.getConnection((err, connection) => {
//     if (err) {
//       console.error("Database connection error:", err);
//       return res.status(500).send({ error: "Database connection failed" });
//     }

//     connection.beginTransaction(async (err) => {
//       if (err) {
//         connection.release();
//         console.error("Transaction begin error:", err);
//         return res.status(500).send({ error: "Transaction failed to start" });
//       }

//       try {
//         // 1️⃣ Get voucher
//         const voucherResult = await queryPromise(
//           "SELECT * FROM voucher WHERE VoucherID = ?",
//           [voucherId],
//           connection
//         );

//         if (voucherResult.length === 0) {
//           throw new Error("Transaction not found");
//         }

//         const voucherData = voucherResult[0];

//         // 2️⃣ Parse batch details
//         let batchDetails = [];
//         if (voucherData.BatchDetails) {
//           batchDetails =
//             typeof voucherData.BatchDetails === "string"
//               ? JSON.parse(voucherData.BatchDetails)
//               : voucherData.BatchDetails;
//         }

//         // 3️⃣ Reverse batch stock for Sales transactions
//         if (voucherData.TransactionType === "Sales") {
//           for (const item of batchDetails) {
//             if (!item.product_id || !item.batch) continue;

//             // Get batch record
//             const batchResult = await queryPromise(
//               "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
//               [item.product_id, item.batch],
//               connection
//             );

//             if (batchResult.length > 0) {
//               const batch = batchResult[0];
//               const qty = parseFloat(item.quantity) || 0;

//               // Reverse stock_out
//               const newStockOut = (parseFloat(batch.stock_out) || 0) - qty;

//               // Recalculate quantity using proper formula
//               const batchOpening = parseFloat(batch.opening_stock) || 0;
//               const batchIn = parseFloat(batch.stock_in) || 0;
//               const newQuantity = batchOpening + batchIn - newStockOut;

//               await queryPromise(
//                 "UPDATE batches SET quantity = ?, stock_out = ?, updated_at = NOW() WHERE id = ?",
//                 [newQuantity, newStockOut, batch.id],
//                 connection
//               );

//               console.log(
//                 `Reversed batch ${item.batch} for product ${item.product_id}: quantity -> ${newQuantity}, stock_out -> ${newStockOut}`
//               );
//             }
//           }
//         }

//         // 4️⃣ Delete stock records for this voucher
//         // await queryPromise("DELETE FROM stock WHERE voucher_id = ?", [voucherId], connection);

//         // 6️⃣ Delete voucher
//         await queryPromise("DELETE FROM voucher WHERE VoucherID = ?", [voucherId], connection);

//         // 7️⃣ Commit transaction
//         connection.commit((commitErr) => {
//           if (commitErr) {
//             console.error("Commit error:", commitErr);
//             return connection.rollback(() => {
//               connection.release();
//               res
//                 .status(500)
//                 .send({ error: "Transaction commit failed", details: commitErr.message });
//             });
//           }

//           connection.release();
//           console.log("Transaction deleted successfully");
//           res.send({
//             success: true,
//             message: "Invoice deleted successfully",
//             voucherId: voucherId,
//             stockReverted: true,
//           });
//         });
//       } catch (error) {
//         console.error("Error deleting transaction:", error);
//         connection.rollback(() => {
//           connection.release();
//           res.status(500).send({
//             error: "Failed to delete invoice",
//             details: error.message,
//           });
//         });
//       }
//     });
//   });
// });


// ✅ Delete transaction + related voucher details
router.delete("/transactions/:id", async (req, res) => {
  const voucherId = req.params.id;

  console.log("Deleting transaction with VoucherID:", voucherId);

  db.getConnection((err, connection) => {
    if (err) {
      console.error("Database connection error:", err);
      return res.status(500).send({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error("Transaction begin error:", err);
        return res.status(500).send({ error: "Transaction failed to start" });
      }

      try {
        // 1️⃣ Get voucher
        const voucherResult = await queryPromise(
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
        );

        if (voucherResult.length === 0) {
          throw new Error("Transaction not found");
        }

        const voucherData = voucherResult[0];

        // 2️⃣ Get batch details from voucherdetails table instead of voucher table
        const batchDetails = await queryPromise(
          "SELECT * FROM voucherdetails WHERE voucher_id = ?",
          [voucherId],
          connection
        );

        // 3️⃣ Reverse batch stock if Sales transaction
        if (voucherData.TransactionType === "Sales" && batchDetails.length > 0) {
          for (const item of batchDetails) {
            if (!item.product_id || !item.batch) continue;

            // Get batch record
            const batchResult = await queryPromise(
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch],
              connection
            );

            if (batchResult.length > 0) {
              const batch = batchResult[0];
              const qty = parseFloat(item.quantity) || 0;

              // Reverse stock_out
              const newStockOut = (parseFloat(batch.stock_out) || 0) - qty;

              // Recalculate available quantity
              const batchOpening = parseFloat(batch.opening_stock) || 0;
              const batchIn = parseFloat(batch.stock_in) || 0;
              const newQuantity = batchOpening + batchIn - newStockOut;

              await queryPromise(
                "UPDATE batches SET quantity = ?, stock_out = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockOut, batch.id],
                connection
              );

              console.log(
                `Reversed batch ${item.batch} for product ${item.product_id}: quantity -> ${newQuantity}, stock_out -> ${newStockOut}`
              );
            }
          }
        }

        // 4️⃣ Delete related voucher details
        await queryPromise("DELETE FROM voucherdetails WHERE voucher_id = ?", [voucherId], connection);

        // 5️⃣ Delete voucher itself
        await queryPromise("DELETE FROM voucher WHERE VoucherID = ?", [voucherId], connection);

        // 6️⃣ Commit transaction
        connection.commit((commitErr) => {
          if (commitErr) {
            console.error("Commit error:", commitErr);
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({
                error: "Transaction commit failed",
                details: commitErr.message,
              });
            });
          }

          connection.release();
          console.log("Transaction and related details deleted successfully");
          res.send({
            success: true,
            message: "Invoice and related batch details deleted successfully",
            voucherId,
            stockReverted: true,
          });
        });
      } catch (error) {
        console.error("Error deleting transaction:", error);
        connection.rollback(() => {
          connection.release();
          res.status(500).send({
            error: "Failed to delete invoice",
            details: error.message,
          });
        });
      }
    });
  });
});



// Get transaction with batch details
// router.get("/transactions/:id", (req, res) => {
//   const query = `
//     SELECT 
//       v.*, 
//       JSON_UNQUOTE(BatchDetails) as batch_details,
//       a.billing_address_line1,
//       a.billing_address_line2,
//       a.billing_city,
//       a.billing_pin_code,
//       a.billing_state,
//       a.shipping_address_line1,
//       a.shipping_address_line2,
//       a.shipping_city,
//       a.shipping_pin_code,
//       a.shipping_state,
//       a.gstin
//     FROM voucher v
//     LEFT JOIN accounts a ON v.PartyID = a.id
//     WHERE v.VoucherID = ?
//   `;
    
//   db.query(query, [req.params.id], (err, results) => {
//     if (err) {
//       console.error('Error fetching transaction:', err);
//       return res.status(500).json({
//         success: false,
//         message: 'Database error',
//         error: err.message
//       });
//     }
    
//     if (results.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Transaction not found'
//       });
//     }
    
//     const transaction = results[0];
    
//     // Parse batch details from JSON string with better error handling
//     try {
//       if (transaction.batch_details) {
//         if (typeof transaction.batch_details === 'string') {
//           transaction.batch_details = JSON.parse(transaction.batch_details);
//         }
//       } else {
//         transaction.batch_details = [];
//       }
//     } catch (error) {
//       console.error('Error parsing batch details:', error);
//       transaction.batch_details = [];
//     }
    
//     res.json({
//       success: true,
//       data: transaction
//     });
//   });
// });

// ✅ Get transaction with batch details by voucherid (from voucherdetails table)
router.get("/transactions/:id", (req, res) => {
  const voucherId = req.params.id;

  // 1️⃣ Fetch voucher + account info
  const voucherQuery = `
    SELECT 
      v.*, 
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

  db.query(voucherQuery, [voucherId], (err, voucherResults) => {
    if (err) {
      console.error("Error fetching voucher:", err);
      return res.status(500).json({
        success: false,
        message: "Database error fetching voucher",
        error: err.message,
      });
    }

    if (voucherResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Voucher not found",
      });
    }

    const transaction = voucherResults[0];

    // 2️⃣ Fetch batch details from voucherdetails table
    const detailsQuery = `
      SELECT 
        product, 
        product_id, 
        batch, 
        quantity, 
        price, 
        discount, 
        gst, 
        cgst, 
        sgst, 
        igst, 
        cess, 
        total
      FROM voucherdetails
      WHERE voucher_id = ?
    `;

    db.query(detailsQuery, [voucherId], (detailsErr, detailsResults) => {
      if (detailsErr) {
        console.error("Error fetching batch details:", detailsErr);
        return res.status(500).json({
          success: false,
          message: "Database error fetching batch details",
          error: detailsErr.message,
        });
      }

      // Attach batch details to transaction
      transaction.batch_details = detailsResults || [];

      res.json({
        success: true,
        data: transaction,
      });
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
// router.post("/transaction", (req, res) => {
//   const transactionData = req.body;
//   console.log('Received sales transaction data:', transactionData);
  
//   db.getConnection((err, connection) => {
//     if (err) {
//       console.error('Database connection error:', err);
//       return res.status(500).send({ error: 'Database connection failed' });
//     }

//     connection.beginTransaction((err) => {
//       if (err) {
//         connection.release();
//         console.error('Transaction begin error:', err);
//         return res.status(500).send({ error: 'Transaction failed to start' });
//       }

//       processTransaction(transactionData, 'Sales', connection)
//         .then((result) => {
//           // Extract data from your current structure
//           const voucherID = result.voucherId || result.insertId;
//           const date = transactionData.invoiceDate || new Date();
//           const transactionType = transactionData.type || 'Sales';
//           const accountID = transactionData.selectedSupplierId;
//           const accountName = transactionData.supplierInfo?.name || 'Unknown Supplier';
//           const amount = transactionData.grandTotal || '0.00';
//           const paidAmount = transactionData.paid_amount || 0;

//           console.log('Ledger data prepared:', {
//             voucherID, date, transactionType, accountID, accountName, amount, paidAmount
//           });

//           // Validate voucherID - it should not be 0 or null
//           if (!voucherID || voucherID === 0) {
//             throw new Error(`Invalid voucher ID: ${voucherID}`);
//           }

//           // Validate required fields
//           if (!accountID || isNaN(parseFloat(amount))) {
//             throw new Error(`Missing required fields for ledger: voucherID=${voucherID}, accountID=${accountID}, amount=${amount}`);
//           }

//           // First, get the latest balance for the account
//           const getBalanceQuery = `
//             SELECT balance_amount 
//             FROM ledger 
//             WHERE AccountID = ? 
//             ORDER BY created_at DESC, id DESC 
//             LIMIT 1
//           `;
          
//           connection.query(getBalanceQuery, [accountID], (balanceErr, balanceResults) => {
//             if (balanceErr) {
//               console.error('Error fetching balance:', balanceErr);
//               return connection.rollback(() => {
//                 connection.release();
//                 res.status(500).send({ error: 'Failed to fetch account balance', details: balanceErr.message });
//               });
//             }

//             let previousBalance = 0;
//             if (balanceResults.length > 0) {
//               previousBalance = parseFloat(balanceResults[0].balance_amount) || 0;
//             }

//             const currentAmount = parseFloat(amount);
//             const currentPaidAmount = parseFloat(paidAmount);
            
//             // Calculate new balance correctly: previous balance + sales amount (debit)
//             const newBalanceAfterSales = previousBalance + currentAmount;
            
//             // Calculate final balance after payment (if any)
//             const finalBalance = newBalanceAfterSales - currentPaidAmount;

//             console.log(`Balance calculation: ${previousBalance} + ${currentAmount} - ${currentPaidAmount} = ${finalBalance}`);

//             // Insert sales transaction into ledger (Debit)
//             const salesLedgerQuery = `
//               INSERT INTO ledger (
//                 voucherID, date, trantype, AccountID, AccountName, 
//                 Amount, balance_amount, DC, created_at
//               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//             `;

//             const salesLedgerValues = [
//               voucherID,
//               date,
//               transactionType,
//               accountID,
//               accountName,
//               currentAmount,
//               newBalanceAfterSales, // Balance after sales transaction
//               'D', // Debit for sales transaction
//               new Date()
//             ];

//             console.log('Executing sales ledger insert with values:', salesLedgerValues);

//             connection.query(salesLedgerQuery, salesLedgerValues, (salesLedgerErr, salesLedgerResults) => {
//               if (salesLedgerErr) {
//                 console.error('Sales ledger insert error:', salesLedgerErr);
//                 return connection.rollback(() => {
//                   connection.release();
//                   res.status(500).send({ error: 'Failed to insert sales ledger entry', details: salesLedgerErr.message });
//                 });
//               }

//               // If there's a paid amount, insert a separate receipt entry (Credit)
//               if (currentPaidAmount > 0) {
//                 const receiptLedgerQuery = `
//                   INSERT INTO ledger (
//                     voucherID, date, trantype, AccountID, AccountName, 
//                     Amount, balance_amount, DC, created_at
//                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//                 `;

//                 const receiptLedgerValues = [
//                   voucherID,
//                   date,
//                   'Receipt',
//                   accountID,
//                   accountName,
//                   currentPaidAmount,
//                   finalBalance, // Final balance after payment
//                   'C', // Credit for receipt/payment
//                   new Date()
//                 ];

//                 console.log('Executing receipt ledger insert with values:', receiptLedgerValues);

//                 connection.query(receiptLedgerQuery, receiptLedgerValues, (receiptLedgerErr, receiptLedgerResults) => {
//                   if (receiptLedgerErr) {
//                     console.error('Receipt ledger insert error:', receiptLedgerErr);
//                     return connection.rollback(() => {
//                       connection.release();
//                       res.status(500).send({ error: 'Failed to insert receipt ledger entry', details: receiptLedgerErr.message });
//                     });
//                   }

//                   commitTransaction(salesLedgerResults, receiptLedgerResults, finalBalance);
//                 });
//               } else {
//                 commitTransaction(salesLedgerResults, null, newBalanceAfterSales);
//               }

//               function commitTransaction(salesEntry, receiptEntry, finalBalanceValue) {
//                 connection.commit((commitErr) => {
//                   if (commitErr) {
//                     console.error('Commit error:', commitErr);
//                     return connection.rollback(() => {
//                       connection.release();
//                       res.status(500).send({ error: 'Transaction commit failed', details: commitErr.message });
//                     });
//                   }
//                   connection.release();
//                   console.log('Sales transaction and ledger entries completed successfully');
//                   res.send({
//                     message: "Sales transaction completed successfully",
//                     voucherId: voucherID,
//                     invoiceNumber: transactionData.invoiceNumber,
//                     stockUpdated: true,
//                     taxType: transactionData.taxType,
//                     gstBreakdown: {
//                       cgst: transactionData.totalCGST,
//                       sgst: transactionData.totalSGST,
//                       igst: transactionData.totalIGST
//                     },
//                     batchDetails: transactionData.batchDetails,
//                     ledgerEntries: {
//                       salesEntry: {
//                         id: salesEntry.insertId,
//                         amount: currentAmount,
//                         type: 'Debit'
//                       },
//                       receiptEntry: currentPaidAmount > 0 ? {
//                         id: receiptEntry.insertId,
//                         amount: currentPaidAmount,
//                         type: 'Credit'
//                       } : null,
//                       newBalance: finalBalanceValue
//                     }
//                   });
//                 });
//               }
//             });
//           });
//         })
//         .catch((error) => {
//           console.error('Sales transaction error:', error);
//           connection.rollback(() => {
//             connection.release();
            
//             if (error.code === 'ER_BAD_FIELD_ERROR') {
//               console.error('Database field error - checking table structure');
//               connection.query("SHOW COLUMNS FROM voucher", (structErr, structResults) => {
//                 if (structErr) {
//                   console.error('Error checking voucher structure:', structErr);
//                 } else {
//                   console.log('Voucher table structure:', structResults);
//                 }
//               });
//             }
            
//             res.status(500).send({ 
//               error: 'Sales transaction failed', 
//               details: error.message,
//               code: error.code
//             });
//           });
//         });
//     });
//   });
// });

// POST /transaction - create sales transaction and update batch stock
// router.post("/transaction", (req, res) => {
//   const transactionData = req.body;
//   console.log("Received sales transaction data:", transactionData);

//   db.getConnection((err, connection) => {
//     if (err) {
//       console.error("Database connection error:", err);
//       return res.status(500).send({ error: "Database connection failed" });
//     }

//     connection.beginTransaction(async (err) => {
//       if (err) {
//         connection.release();
//         console.error("Transaction begin error:", err);
//         return res.status(500).send({ error: "Transaction failed to start" });
//       }

//       try {
//         const result = await processTransaction(transactionData, "Sales", connection);

//         // Commit transaction
//         connection.commit((commitErr) => {
//           if (commitErr) {
//             console.error("Commit error:", commitErr);
//             return connection.rollback(() => {
//               connection.release();
//               res.status(500).send({
//                 error: "Transaction commit failed",
//                 details: commitErr.message,
//               });
//             });
//           }

//           connection.release();
//           res.send({
//             message: "Sales transaction completed and batch stock updated successfully",
//             voucherId: result.voucherId,
//             invoiceNumber: result.invoiceNumber,
//             batchDetails: result.batchDetails,
//           });
//         });
//       } catch (error) {
//         console.error("Sales transaction error:", error);
//         connection.rollback(() => {
//           connection.release();
//           res.status(500).send({
//             error: "Sales transaction failed",
//             details: error.message,
//           });
//         });
//       }
//     });
//   });
// });

// const processTransaction = async (transactionData, transactionType, connection) => {
//   // 1️⃣ Get next VoucherID
//   const maxIdResult = await queryPromise(
//     "SELECT COALESCE(MAX(VoucherID), 0) + 1 AS nextId FROM voucher",
//     [],
//     connection
//   );
//   const nextVoucherId = maxIdResult[0].nextId;
//   console.log("Next available VoucherID:", nextVoucherId);

//   // 2️⃣ Parse batch details
//   const batchDetails = (Array.isArray(transactionData.batchDetails)
//     ? transactionData.batchDetails
//     : JSON.parse(transactionData.batchDetails || "[]")
//   ).map((item) => ({
//     product: item.product || "",
//     product_id: item.product_id || null,
//     batch: item.batch || "",
//     quantity: parseFloat(item.quantity) || 0,
//     price: parseFloat(item.price) || 0,
//     discount: parseFloat(item.discount) || 0,
//     gst: parseFloat(item.gst) || 0,
//     cgst: parseFloat(item.cgst) || 0,
//     sgst: parseFloat(item.sgst) || 0,
//     igst: parseFloat(item.igst) || 0,
//     cess: parseFloat(item.cess) || 0,
//     total: parseFloat(item.total) || 0,
//   }));

//   // 3️⃣ Insert voucher
//   const totalQty = batchDetails.reduce((sum, item) => sum + item.quantity, 0);
//   const invoiceNumber = transactionData.invoiceNumber || "INV001";

// const voucherData = {
//   VoucherID: nextVoucherId,
//   TransactionType: transactionType,
//   VchNo: invoiceNumber,
//   InvoiceNumber: invoiceNumber,
//   Date: transactionData.invoiceDate || new Date().toISOString().split("T")[0],
//   PaymentTerms: 'Immediate',
//   Freight: 0,
//   TotalQty: totalQty,
//   TotalPacks: batchDetails.length,
//   TotalQty1: totalQty,
//   TaxAmount: parseFloat(transactionData.totalGST) || 0,
//   Subtotal: parseFloat(transactionData.taxableAmount) || 0,
//   BillSundryAmount: 0,
//   TotalAmount: parseFloat(transactionData.grandTotal) || 0,
//   paid_amount: parseFloat(transactionData.grandTotal) || 0,
//   AccountID: transactionData.selectedSupplierId || null,
//   AccountName: transactionData.supplierInfo?.businessName || '',
//   PartyID: transactionData.selectedSupplierId || null,
//   PartyName: transactionData.supplierInfo?.name || '',
//   BasicAmount: parseFloat(transactionData.taxableAmount) || 0,
//   ValueOfGoods: parseFloat(transactionData.taxableAmount) || 0,
//   EntryDate: new Date(),
//   SGSTPercentage: transactionData.taxType === "CGST/SGST" && parseFloat(transactionData.totalSGST) > 0 ? 50 : 0,
//   CGSTPercentage: transactionData.taxType === "CGST/SGST" && parseFloat(transactionData.totalCGST) > 0 ? 50 : 0,
//   IGSTPercentage: transactionData.taxType === "IGST" ? 100 : 0,
//   SGSTAmount: parseFloat(transactionData.totalSGST) || 0,
//   CGSTAmount: parseFloat(transactionData.totalCGST) || 0,
//   IGSTAmount: parseFloat(transactionData.totalIGST) || 0,
//   TaxSystem: 'GST',
//   product_id: batchDetails.length > 0 ? batchDetails[0].product_id : null,
//   batch_id: batchDetails.length > 0 ? batchDetails[0].batch : null,
//   DC: "D",
//   BatchDetails: JSON.stringify(batchDetails),
// };

//   const voucherResult = await queryPromise("INSERT INTO voucher SET ?", voucherData, connection);
//   const voucherId = voucherResult.insertId || nextVoucherId;

//   // 4️⃣ Update batches safely
//   for (const item of batchDetails) {
//     if (!item.batch || !item.product_id) {
//       throw new Error(`Invalid batch data: ${JSON.stringify(item)}`);
//     }

//     const quantity = item.quantity;
//     if (quantity <= 0) continue;

//     // Update batch quantity and stock_out atomically
//     const updateQuery = `
//       UPDATE batches
//       SET quantity = quantity - ?,
//           stock_out = stock_out + ?,
//           updated_at = NOW()
//       WHERE product_id = ? AND batch_number = ? AND quantity >= ?
//     `;
//     const updateResult = await queryPromise(updateQuery, [
//       quantity,
//       quantity,
//       item.product_id,
//       item.batch,
//       quantity,
//     ], connection);

//     if (updateResult.affectedRows === 0) {
//       throw new Error(`Insufficient quantity in batch ${item.batch} for product_id ${item.product_id}`);
//     }

//     console.log(`Batch ${item.batch} updated: sold=${quantity}`);
//   }

//   return { voucherId, invoiceNumber, batchDetails };
// };


router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  console.log("Received sales transaction data:", transactionData);

  db.getConnection((err, connection) => {
    if (err) {
      console.error("Database connection error:", err);
      return res.status(500).send({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error("Transaction begin error:", err);
        return res.status(500).send({ error: "Transaction failed to start" });
      }

      try {
        // 🧾 Step 1: Create voucher + update batches
        const result = await processTransaction(transactionData, "Sales", connection);
        const { voucherId, invoiceNumber, batchDetails } = result;

        // 🧱 Step 2: Insert each batch detail into voucherdetails table
        const insertDetailQuery = `
          INSERT INTO voucherdetails (
            voucher_id, product, product_id, batch, quantity, price, discount,
            gst, cgst, sgst, igst, cess, total, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        for (const item of batchDetails) {
          await queryPromise(insertDetailQuery, [
            voucherId,
            item.product,
            item.product_id,
            item.batch,
            item.quantity,
            item.price,
            item.discount,
            item.gst,
            item.cgst,
            item.sgst,
            item.igst,
            item.cess,
            item.total,
          ], connection);
        }

        // ✅ Step 3: Commit everything
        connection.commit((commitErr) => {
          if (commitErr) {
            console.error("Commit error:", commitErr);
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({
                error: "Transaction commit failed",
                details: commitErr.message,
              });
            });
          }

          connection.release();
          res.send({
            success: true,
            message: "Sales transaction completed successfully and voucher details stored",
            voucherId,
            invoiceNumber,
            batchDetails,
          });
        });
      } catch (error) {
        console.error("Sales transaction error:", error);
        connection.rollback(() => {
          connection.release();
          res.status(500).send({
            error: "Sales transaction failed",
            details: error.message,
          });
        });
      }
    });
  });
});


// =========================
// 🔧 processTransaction()
// =========================
const processTransaction = async (transactionData, transactionType, connection) => {
  // 1️⃣ Get next VoucherID
  const maxIdResult = await queryPromise(
    "SELECT COALESCE(MAX(VoucherID), 0) + 1 AS nextId FROM voucher",
    [],
    connection
  );
  const nextVoucherId = maxIdResult[0].nextId;
  console.log("Next available VoucherID:", nextVoucherId);

  // 2️⃣ Parse batch details
  const batchDetails = (Array.isArray(transactionData.batchDetails)
    ? transactionData.batchDetails
    : JSON.parse(transactionData.batchDetails || "[]")
  ).map((item) => ({
    product: item.product || "",
    product_id: item.product_id || null,
    batch: item.batch || "",
    quantity: parseFloat(item.quantity) || 0,
    price: parseFloat(item.price) || 0,
    discount: parseFloat(item.discount) || 0,
    gst: parseFloat(item.gst) || 0,
    cgst: parseFloat(item.cgst) || 0,
    sgst: parseFloat(item.sgst) || 0,
    igst: parseFloat(item.igst) || 0,
    cess: parseFloat(item.cess) || 0,
    total: parseFloat(item.total) || 0,
  }));

  // 3️⃣ Prepare voucher data
  const totalQty = batchDetails.reduce((sum, item) => sum + item.quantity, 0);
  const invoiceNumber = transactionData.invoiceNumber || "INV001";

  const voucherData = {
    VoucherID: nextVoucherId,
    TransactionType: transactionType,
    VchNo: invoiceNumber,
    InvoiceNumber: invoiceNumber,
    Date: transactionData.invoiceDate || new Date().toISOString().split("T")[0],
    PaymentTerms: "Immediate",
    Freight: 0,
    TotalQty: totalQty,
    TotalPacks: batchDetails.length,
    TotalQty1: totalQty,
    TaxAmount: parseFloat(transactionData.totalGST) || 0,
    Subtotal: parseFloat(transactionData.taxableAmount) || 0,
    BillSundryAmount: 0,
    TotalAmount: parseFloat(transactionData.grandTotal) || 0,
    paid_amount: parseFloat(transactionData.grandTotal) || 0,
    AccountID: transactionData.selectedSupplierId || null,
    AccountName: transactionData.supplierInfo?.businessName || "",
    PartyID: transactionData.selectedSupplierId || null,
    PartyName: transactionData.supplierInfo?.name || "",
    BasicAmount: parseFloat(transactionData.taxableAmount) || 0,
    ValueOfGoods: parseFloat(transactionData.taxableAmount) || 0,
    EntryDate: new Date(),
    SGSTPercentage:
      transactionData.taxType === "CGST/SGST" &&
      parseFloat(transactionData.totalSGST) > 0
        ? 50
        : 0,
    CGSTPercentage:
      transactionData.taxType === "CGST/SGST" &&
      parseFloat(transactionData.totalCGST) > 0
        ? 50
        : 0,
    IGSTPercentage: transactionData.taxType === "IGST" ? 100 : 0,
    SGSTAmount: parseFloat(transactionData.totalSGST) || 0,
    CGSTAmount: parseFloat(transactionData.totalCGST) || 0,
    IGSTAmount: parseFloat(transactionData.totalIGST) || 0,
    TaxSystem: "GST",
    product_id: batchDetails.length > 0 ? batchDetails[0].product_id : null,
    batch_id: batchDetails.length > 0 ? batchDetails[0].batch : null,
    DC: "D",
    BatchDetails: JSON.stringify(batchDetails),
  };

  // 4️⃣ Insert voucher
  const voucherResult = await queryPromise("INSERT INTO voucher SET ?", voucherData, connection);
  const voucherId = voucherResult.insertId || nextVoucherId;

  // 5️⃣ Update batches
  for (const item of batchDetails) {
    if (!item.batch || !item.product_id) {
      throw new Error(`Invalid batch data: ${JSON.stringify(item)}`);
    }

    const quantity = item.quantity;
    if (quantity <= 0) continue;

    const updateQuery = `
      UPDATE batches
      SET quantity = quantity - ?,
          stock_out = stock_out + ?,
          updated_at = NOW()
      WHERE product_id = ? AND batch_number = ? AND quantity >= ?
    `;

    const updateResult = await queryPromise(updateQuery, [
      quantity,
      quantity,
      item.product_id,
      item.batch,
      quantity,
    ], connection);

    if (updateResult.affectedRows === 0) {
      throw new Error(
        `Insufficient quantity in batch ${item.batch} for product_id ${item.product_id}`
      );
    }

    console.log(`Batch ${item.batch} updated: sold=${quantity}`);
  }

  return { voucherId, invoiceNumber, batchDetails };
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

router.put("/transactions/:id", async (req, res) => {
  const voucherId = req.params.id;
  const updateData = req.body;

  db.getConnection((err, connection) => {
    if (err) return res.status(500).send({ error: 'Database connection failed' });

    connection.beginTransaction(async (err) => {
      if (err) return res.status(500).send({ error: 'Transaction failed to start' });

      try {
        // 1️⃣ Get original voucher
        const originalVoucher = await queryPromise(
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
        );
        if (originalVoucher.length === 0) throw new Error('Transaction not found');

        let originalBatchDetails = [];
        try {
          originalBatchDetails = originalVoucher[0].BatchDetails
            ? JSON.parse(originalVoucher[0].BatchDetails)
            : [];
        } catch (err) { originalBatchDetails = []; }

        // 2️⃣ Reverse old stock in batches
        for (const item of originalBatchDetails) {
          if (!item.batch || !item.product_id) continue;
          const batchResult = await queryPromise(
            "SELECT id, quantity, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch],
            connection
          );

          if (batchResult.length > 0) {
            const batch = batchResult[0];
            const qty = parseFloat(item.quantity) || 0;
            await queryPromise(
              "UPDATE batches SET quantity = quantity + ?, stock_out = stock_out - ? WHERE id = ?",
              [qty, qty, batch.id],
              connection
            );
          }
        }

        // 🔴 NEW: Delete existing voucherdetails records for this voucher_id
        await queryPromise(
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId],
          connection
        );

        // 3️⃣ Update voucher record
        let newBatchDetails = [];
        if (updateData.batchDetails) {
          newBatchDetails = Array.isArray(updateData.batchDetails)
            ? updateData.batchDetails
            : JSON.parse(updateData.batchDetails || '[]');
        }

        const totalQty = newBatchDetails.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);

        await queryPromise(
          `UPDATE voucher 
            SET InvoiceNumber = ?, Date = ?, PartyName = ?, BasicAmount = ?, TaxAmount = ?, TotalAmount = ?, TotalQty = ?, BatchDetails = ?
            WHERE VoucherID = ?`,
          [
            updateData.invoiceNumber || originalVoucher[0].InvoiceNumber,
            updateData.invoiceDate || originalVoucher[0].Date,
            updateData.supplierInfo?.name || originalVoucher[0].PartyName,
            parseFloat(updateData.taxableAmount) || parseFloat(originalVoucher[0].BasicAmount) || 0,
            parseFloat(updateData.totalGST) || parseFloat(originalVoucher[0].TaxAmount) || 0,
            parseFloat(updateData.grandTotal) || parseFloat(originalVoucher[0].TotalAmount) || 0,
            totalQty,
            JSON.stringify(newBatchDetails),
            voucherId
          ],
          connection
        );

        // 🔴 NEW: Insert new voucherdetails records
        if (newBatchDetails && newBatchDetails.length > 0) {
          for (const item of newBatchDetails) {
            await queryPromise(
              `INSERT INTO voucherdetails 
                (voucher_id, product, product_id, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                voucherId,
                item.product || '',
                item.product_id || '',
                item.batch || '',
                parseFloat(item.quantity) || 0,
                parseFloat(item.price) || 0,
                parseFloat(item.discount) || 0,
                parseFloat(item.gst) || 0,
                parseFloat(item.cgst) || 0,
                parseFloat(item.sgst) || 0,
                parseFloat(item.igst) || 0,
                parseFloat(item.cess) || 0,
                parseFloat(item.total) || 0
              ],
              connection
            );
          }
        }

        // 4️⃣ Apply new stock changes in batches
        for (const item of newBatchDetails) {
          if (!item.batch || !item.product_id) continue;
          const batchResult = await queryPromise(
            "SELECT id, quantity, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch],
            connection
          );

          if (batchResult.length > 0) {
            const batch = batchResult[0];
            const qty = parseFloat(item.quantity) || 0;
            if (batch.quantity < qty) throw new Error(`Insufficient batch quantity for ${item.batch}`);
            await queryPromise(
              "UPDATE batches SET quantity = quantity - ?, stock_out = stock_out + ? WHERE id = ?",
              [qty, qty, batch.id],
              connection
            );
          }
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({ error: commitErr.message });
            });
          }
          connection.release();
          res.json({ success: true, message: 'Transaction updated successfully', voucherId });
        });

      } catch (error) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ success: false, message: error.message });
        });
      }
    });
  });
});
// router.put("/transactions/:id", async (req, res) => {
//   const voucherId = req.params.id;
//   const updateData = req.body;

//   db.getConnection((err, connection) => {
//     if (err) return res.status(500).send({ error: 'Database connection failed' });

//     connection.beginTransaction(async (err) => {
//       if (err) return res.status(500).send({ error: 'Transaction failed to start' });

//       try {
//         // 1️⃣ Get original voucher
//         const originalVoucher = await queryPromise(
//           "SELECT * FROM voucher WHERE VoucherID = ?",
//           [voucherId],
//           connection
//         );
//         if (originalVoucher.length === 0) throw new Error('Transaction not found');

//         let originalBatchDetails = [];
//         try {
//           originalBatchDetails = originalVoucher[0].BatchDetails
//             ? JSON.parse(originalVoucher[0].BatchDetails)
//             : [];
//         } catch (err) { originalBatchDetails = []; }

//         // 2️⃣ Reverse old stock in batches
//         for (const item of originalBatchDetails) {
//           if (!item.batch || !item.product_id) continue;
//           const batchResult = await queryPromise(
//             "SELECT id, quantity, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch],
//             connection
//           );

//           if (batchResult.length > 0) {
//             const batch = batchResult[0];
//             const qty = parseFloat(item.quantity) || 0;
//             await queryPromise(
//               "UPDATE batches SET quantity = quantity + ?, stock_out = stock_out - ? WHERE id = ?",
//               [qty, qty, batch.id],
//               connection
//             );
//           }
//         }

//         // 3️⃣ Update voucher record
//         let newBatchDetails = [];
//         if (updateData.batchDetails) {
//           newBatchDetails = Array.isArray(updateData.batchDetails)
//             ? updateData.batchDetails
//             : JSON.parse(updateData.batchDetails || '[]');
//         }

//         const totalQty = newBatchDetails.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);

//         await queryPromise(
//           `UPDATE voucher 
//             SET InvoiceNumber = ?, Date = ?, PartyName = ?, BasicAmount = ?, TaxAmount = ?, TotalAmount = ?, TotalQty = ?, BatchDetails = ?
//             WHERE VoucherID = ?`,
//           [
//             updateData.invoiceNumber || originalVoucher[0].InvoiceNumber,
//             updateData.invoiceDate || originalVoucher[0].Date,
//             updateData.supplierInfo?.name || originalVoucher[0].PartyName,
//             parseFloat(updateData.taxableAmount) || parseFloat(originalVoucher[0].BasicAmount) || 0,
//             parseFloat(updateData.totalGST) || parseFloat(originalVoucher[0].TaxAmount) || 0,
//             parseFloat(updateData.grandTotal) || parseFloat(originalVoucher[0].TotalAmount) || 0,
//             totalQty,
//             JSON.stringify(newBatchDetails),
//             voucherId
//           ],
//           connection
//         );

//         // 4️⃣ Apply new stock changes in batches
//         for (const item of newBatchDetails) {
//           if (!item.batch || !item.product_id) continue;
//           const batchResult = await queryPromise(
//             "SELECT id, quantity, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch],
//             connection
//           );

//           if (batchResult.length > 0) {
//             const batch = batchResult[0];
//             const qty = parseFloat(item.quantity) || 0;
//             if (batch.quantity < qty) throw new Error(`Insufficient batch quantity for ${item.batch}`);
//             await queryPromise(
//               "UPDATE batches SET quantity = quantity - ?, stock_out = stock_out + ? WHERE id = ?",
//               [qty, qty, batch.id],
//               connection
//             );
//           }
//         }

//         connection.commit((commitErr) => {
//           if (commitErr) {
//             return connection.rollback(() => {
//               connection.release();
//               res.status(500).send({ error: commitErr.message });
//             });
//           }
//           connection.release();
//           res.json({ success: true, message: 'Transaction updated successfully', voucherId });
//         });

//       } catch (error) {
//         connection.rollback(() => {
//           connection.release();
//           res.status(500).json({ success: false, message: error.message });
//         });
//       }
//     });
//   });
// });




router.get("/ledger", (req, res) => {
  // Fetch all vouchers ordered by AccountID and Date
const query = `
  SELECT 
    VoucherID AS id,
    VchNo AS voucherID,
    Date AS date,
    TransactionType AS trantype,
    AccountID,
    AccountName,
    PartyID,
    PartyName,
    paid_amount AS Pamount,
    TotalAmount AS Amount,
    DC,
    balance_amount,
    created_at
  FROM voucher
  ORDER BY PartyName, Date ASC, VoucherID ASC
`;


  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching voucher data:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }

    // Recalculate running balances for all accounts
    const dataWithRecalculatedBalances = recalculateRunningBalances(results);

    res.status(200).json(dataWithRecalculatedBalances);
  });
});


// Function to recalculate running balances
function recalculateRunningBalances(transactions) {
  const accounts = {};
  
  // Group transactions by AccountID
  transactions.forEach(transaction => {
    if (!accounts[transaction.AccountID]) {
      accounts[transaction.AccountID] = [];
    }
    accounts[transaction.AccountID].push(transaction);
  });

  const results = [];

  // Calculate running balance for each account
  Object.keys(accounts).forEach(accountId => {
    let runningBalance = 0;
    const accountTransactions = accounts[accountId];

    accountTransactions.forEach(transaction => {
      // Calculate based on DC type
      if (transaction.DC === 'D') {
        runningBalance += parseFloat(transaction.Amount);
      } else if (transaction.DC === 'C') {
        runningBalance -= parseFloat(transaction.Amount);
      }

      // Add to results with recalculated balance
      results.push({
        ...transaction,
        balance_amount: runningBalance.toFixed(2)
      });
    });
  });

  // Sort by AccountID and ID DESC for final output (to show latest first)
  return results.sort((a, b) => {
    if (a.AccountID !== b.AccountID) {
      return a.AccountID - b.AccountID;
    }
    return b.id - a.id;
  });
}



router.get("/voucherdetails", async (req, res) => {
  try {
    const query = `
      SELECT 
        vd.*,
        v.InvoiceNumber,
        v.Date as voucher_date,
        v.PartyName,
        v.TotalAmount as voucher_total_amount
      FROM voucherdetails vd
      LEFT JOIN voucher v ON vd.voucher_id = v.VoucherID
      ORDER BY vd.created_at DESC
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error("Error fetching voucher details:", err);
        return res.status(500).json({ 
          success: false, 
          message: "Error fetching voucher details" 
        });
      }

      res.json({
        success: true,
        data: results,
        totalCount: results.length
      });
    });
  } catch (error) {
    console.error("Error in voucherdetails API:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
});

module.exports = router;