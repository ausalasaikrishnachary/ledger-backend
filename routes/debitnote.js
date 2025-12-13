const express = require("express");
const router = express.Router();
const db = require("../db"); // your db connection

// 🧮 Generate Next Credit Note Number
// router.get("/next-creditnote-number", (req, res) => {
//   const query = "SELECT VchNo FROM voucher ORDER BY VoucherID DESC LIMIT 1";

//   db.query(query, (err, result) => {
//     if (err) {
//       console.error("Database error:", err);
//       return res.status(500).json({ 
//         error: "Database error",
//         message: err.message 
//       });
//     }

//     let nextNumber = "CNOTE0001";
    
//     if (result.length > 0 && result[0].VchNo) {
//       const lastNumber = result[0].VchNo;
      
//       // Extract numeric part and increment
//       const match = lastNumber.match(/CNOTE(\d+)/);
//       if (match) {
//         const num = parseInt(match[1]) + 1;
//         nextNumber = `CNOTE${num.toString().padStart(4, "0")}`;
//       } else {
//         // If format doesn't match, start from CNOTE0001
//         nextNumber = "CNOTE0001";
//       }
//     }

//     console.log("Next credit note number:", nextNumber);
//     res.json({ 
//       nextCreditNoteNumber: nextNumber,
//       success: true
//     });
//   });
// });


router.get("/next-debitnote-number", async (req, res) => {
  try {
    const query = `
      SELECT MAX(CAST(SUBSTRING(VchNo, 6) AS UNSIGNED)) as maxNumber
      FROM voucher
      WHERE TransactionType = 'DebitNote'
      AND VchNo LIKE 'DNOTE%'
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error('Error fetching next credit note number:', err);
        return res.status(500).send({ error: 'Failed to get next credit note number' });
      }

      let nextNumber = 1;
      if (results[0].maxNumber !== null && !isNaN(results[0].maxNumber)) {
        nextNumber = parseInt(results[0].maxNumber) + 1;
      }

      const nextCreditNoteNumber = `DNOTE${nextNumber.toString().padStart(3, '0')}`;

      res.send({ nextCreditNoteNumber });
    });
  } catch (error) {
    console.error('Error in next-DebitNote-number:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
});

// Get invoice details
router.get("/invoice-details/:invoiceNumber", (req, res) => {
  const { invoiceNumber } = req.params;

  // Fetch invoice + account data with PartyID and AccountID
  const invoiceQuery = `
    SELECT 
      v.VoucherID, 
      v.InvoiceNumber, 
      v.PartyID,
      v.AccountID,
      v.TransactionType,
      v.Date,
      v.TotalAmount,
      v.TaxAmount,
      v.Subtotal,
      a.*
    FROM voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id OR v.AccountID = a.id
    WHERE v.InvoiceNumber = ?
  `;

  db.query(invoiceQuery, [invoiceNumber], (err, invoiceResult) => {
    if (err) {
      console.error("Error fetching invoice:", err);
      return res.status(500).send(err);
    }

    if (invoiceResult.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const invoiceData = invoiceResult[0];

    // Fetch invoice item details from voucherdetails table
    const detailsQuery = `
      SELECT 
        id,
        voucher_id,
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
        total,
        created_at,
        update_at
      FROM voucherdetails
      WHERE voucher_id = ?
    `;

    db.query(detailsQuery, [invoiceData.VoucherID], (err, voucherDetails) => {
      if (err) {
        console.error("Error fetching voucher details:", err);
        return res.status(500).send(err);
      }

      // Prepare the response with all required fields
      const responseData = {
        // Invoice basic info
        VoucherID: invoiceData.VoucherID,
        InvoiceNumber: invoiceData.InvoiceNumber,
        TransactionType: invoiceData.TransactionType,
        Date: invoiceData.Date,
        TotalAmount: invoiceData.TotalAmount,
        TaxAmount: invoiceData.TaxAmount,
        Subtotal: invoiceData.Subtotal,
        
        // Account and Party IDs
        PartyID: invoiceData.PartyID,
        AccountID: invoiceData.AccountID,
        
        // Customer/Account information
        business_name: invoiceData.business_name,
        email: invoiceData.email,
        mobile_number: invoiceData.mobile_number,
        gstin: invoiceData.gstin,
        
        // Address fields
        billing_address_line1: invoiceData.billing_address_line1,
        billing_address_line2: invoiceData.billing_address_line2,
        billing_city: invoiceData.billing_city,
        billing_pin_code: invoiceData.billing_pin_code,
        billing_state: invoiceData.billing_state,
        billing_country: invoiceData.billing_country,
        billing_branch_name: invoiceData.billing_branch_name,
        billing_gstin: invoiceData.billing_gstin,
        
        shipping_address_line1: invoiceData.shipping_address_line1,
        shipping_address_line2: invoiceData.shipping_address_line2,
        shipping_city: invoiceData.shipping_city,
        shipping_pin_code: invoiceData.shipping_pin_code,
        shipping_state: invoiceData.shipping_state,
        shipping_country: invoiceData.shipping_country,
        shipping_branch_name: invoiceData.shipping_branch_name,
        shipping_gstin: invoiceData.shipping_gstin,
        
        // Additional account fields if needed
        account_id: invoiceData.id, // This is the account ID from accounts table
        party_id: invoiceData.PartyID, // Same as PartyID for consistency
        
        // Items from voucherdetails
        items: voucherDetails
      };

      console.log("📦 Invoice details response:", {
        PartyID: responseData.PartyID,
        AccountID: responseData.AccountID,
        account_id: responseData.account_id,
        party_id: responseData.party_id
      });

      res.json(responseData);
    });
  });
});
// Get sales invoices for credit note
router.get("/debit-notesales", (req, res) => { 
  const query = `
    SELECT VoucherID, InvoiceNumber 
    FROM voucher 
    WHERE TransactionType = 'Purchase'
  `;
  
  db.query(query, (err, result) => {
    if (err) {
      console.error("Error fetching invoices:", err);
      return res.status(500).send(err);
    }
    res.json(result);
  });
});

// Create credit note - Complete version with all functions
// router.post('/create-debit-note', (req, res) => {
//   const {
//     invoiceNumber,
//     noteDate,
//     items,
//     customerData,
//     totals,
//     noteText,
//     terms,
//     creditNoteNumber
//   } = req.body;

//   // Start transaction
//   db.getConnection((err, connection) => {
//     if (err) {
//       console.error("Error getting connection:", err);
//       return res.status(500).json({ error: "Database connection failed" });
//     }

//     connection.beginTransaction((beginErr) => {
//       if (beginErr) {
//         connection.release();
//         console.error("Error starting transaction:", beginErr);
//         return res.status(500).json({ error: "Transaction failed to start" });
//       }

//       // Get original invoice details for reference
//       const invoiceQuery = `SELECT * FROM voucher WHERE InvoiceNumber = ? AND TransactionType = 'Purchase'`;
      
//       connection.query(invoiceQuery, [invoiceNumber], (invoiceErr, invoiceDetails) => {
//         if (invoiceErr) {
//           return rollback(connection, res, invoiceErr);
//         }

//         if (invoiceDetails.length === 0) {
//           return rollback(connection, res, new Error('Original invoice not found'));
//         }

//         const originalInvoice = invoiceDetails[0];

//         // Calculate totals from items - FIXED: Use the function that exists
//         const calculatedTotals = calculateTotalsFromItems(items) || {
//           totalQty: items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0),
//           totalQty1: items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0),
//           taxAmount: parseFloat(totals?.totalGST || 0) + parseFloat(totals?.totalIGST || 0),
//           subtotal: parseFloat(totals?.taxableAmount || 0),
//           totalAmount: parseFloat(totals?.grandTotal || 0),
//           basicAmount: parseFloat(totals?.taxableAmount || 0),
//           valueOfGoods: parseFloat(totals?.taxableAmount || 0),
//           sgstAmount: parseFloat(totals?.totalGST || 0) / 2 || 0,
//           cgstAmount: parseFloat(totals?.totalGST || 0) / 2 || 0,
//           igstAmount: parseFloat(totals?.totalIGST || 0)
//         };

//         // Get product_id and batch from the first item
//         const firstItem = items[0] || {};
//         const product_id = firstItem.product_id || null;
//         const batch_number = firstItem.batch || null;


//         // Get batch_id from batches table using product_id and batch_number
//         const getBatchIdQuery = `SELECT id FROM batches WHERE product_id = ? AND batch_number = ?`;
        
//         connection.query(getBatchIdQuery, [product_id, batch_number], (batchErr, batchResults) => {
//           if (batchErr) {
//             return rollback(connection, res, batchErr);
//           }

//           let batch_id = null;
//           if (batchResults.length > 0) {
//             batch_id = batchResults[0].id;
//           }

//           console.log("🔍 Debug - Found Batch ID:", batch_id);

//           // Insert credit note into voucher table WITH product_id and batch_id
//           const creditNoteQuery = `
//             INSERT INTO voucher (
//               TransactionType, VchNo, product_id, batch_id, InvoiceNumber, Date, 
//               PaymentTerms, Freight, TotalQty, TotalPacks, TotalQty1, TaxAmount, 
//               Subtotal, BillSundryAmount, TotalAmount, ChequeNo, ChequeDate, BankName, 
//               AccountID, AccountName, PartyID, PartyName, BasicAmount, ValueOfGoods, 
//               EntryDate, SGSTPercentage, CGSTPercentage, IGSTPercentage, SGSTAmount, 
//               CGSTAmount, IGSTAmount, TaxSystem, BatchDetails, paid_amount, 
//               balance_amount, receipt_number, status, paid_date, DC
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//           `;

//           const creditNoteValues = [
//             'DebitNote',
//             creditNoteNumber,
//             product_id,
//             batch_id,
//             invoiceNumber,
//             noteDate,
//             originalInvoice.PaymentTerms || '',
//             originalInvoice.Freight || 0,
//             calculatedTotals.totalQty,
//             originalInvoice.TotalPacks || 0,
//             calculatedTotals.totalQty1,
//             calculatedTotals.taxAmount,
//             calculatedTotals.subtotal,
//             originalInvoice.BillSundryAmount || 0,
//             calculatedTotals.totalAmount,
//             '',
//             null,
//             '',
//             customerData?.account_id || originalInvoice.AccountID,
//             customerData?.business_name || originalInvoice.AccountName,
//             customerData?.party_id || originalInvoice.PartyID,
//             customerData?.business_name || originalInvoice.PartyName,
//             calculatedTotals.basicAmount,
//             calculatedTotals.valueOfGoods,
//             new Date(),
//             originalInvoice.SGSTPercentage || 0,
//             originalInvoice.CGSTPercentage || 0,
//             originalInvoice.IGSTPercentage || 0,
//             calculatedTotals.sgstAmount,
//             calculatedTotals.cgstAmount,
//             calculatedTotals.igstAmount,
//             originalInvoice.TaxSystem || 'GST',
//             JSON.stringify(items),
//             0,
//             calculatedTotals.totalAmount,
//             '',
//             'pending',
//             null,
//             noteText || ''
//           ];

//           connection.query(creditNoteQuery, creditNoteValues, (insertErr, result) => {
//             if (insertErr) {
//               console.error("❌ Error inserting credit note:", insertErr);
//               return rollback(connection, res, insertErr);
//             }

//             const creditNoteId = result.insertId;

//             // Update stock in batches table - INCREASE stock
//             updateStockForCreditNote(connection, items, (stockErr) => {
//               if (stockErr) {
//                 console.error("❌ Error updating stock:", stockErr);
//                 return rollback(connection, res, stockErr);
//               }

//               connection.commit((commitErr) => {
//                 if (commitErr) {
//                   return rollback(connection, res, commitErr);
//                 }

//                 connection.release();

//                 console.log("✅ Credit note created successfully!");
//                 res.status(201).json({
//                   success: true,
//                   message: 'Credit note created successfully',
//                   creditNoteId: creditNoteId,
//                   creditNoteNumber: creditNoteNumber,
//                   product_id: product_id,
//                   batch_id: batch_id,
//                   data: {
//                     ...calculatedTotals,
//                     items: items
//                   }
//                 });
//               });
//             });
//           });
//         });
//       });
//     });
//   });
// });

// // Function to calculate totals from items
// function calculateTotalsFromItems(items) {
//   if (!items || items.length === 0) {
//     return null;
//   }

//   const totals = {
//     totalQty: 0,
//     totalQty1: 0,
//     taxAmount: 0,
//     subtotal: 0,
//     totalAmount: 0,
//     basicAmount: 0,
//     valueOfGoods: 0,
//     sgstAmount: 0,
//     cgstAmount: 0,
//     igstAmount: 0
//   };

//   items.forEach(item => {
//     const quantity = parseFloat(item.quantity) || 0;
//     const price = parseFloat(item.price) || 0;
//     const discount = parseFloat(item.discount) || 0;
//     const gst = parseFloat(item.gst) || 0;
//     const igst = parseFloat(item.igst) || 0;
    
//     const itemTotal = (quantity * price) - discount;
//     const gstAmount = itemTotal * (gst / 100);
//     const igstAmount = itemTotal * (igst / 100);

//     totals.totalQty += quantity;
//     totals.totalQty1 += quantity;
//     totals.subtotal += itemTotal;
//     totals.basicAmount += itemTotal;
//     totals.valueOfGoods += itemTotal;
//     totals.taxAmount += gstAmount + igstAmount;
    
//     // Split GST if applicable
//     if (igst === 0 && gst > 0) {
//       totals.sgstAmount += gstAmount / 2;
//       totals.cgstAmount += gstAmount / 2;
//     } else {
//       totals.igstAmount += igstAmount;
//     }
//   });

//   totals.totalAmount = totals.subtotal + totals.taxAmount;

//   return totals;
// }

// Function to update stock for credit note (INCREASE stock_in and quantity)
// function updateStockForCreditNote(connection, items, callback) {
//   if (!items || items.length === 0) {
//     return callback(null);
//   }

//   let completed = 0;
//   let hasError = null;

//   items.forEach((item) => {
//     const product_id = item.product_id;
//     const batch_number = item.batch;
//     const returnedQuantity = parseFloat(item.quantity) || 0;

//     console.log(`🔄 Updating stock for product ${product_id}, batch ${batch_number}, quantity: +${returnedQuantity}`);

//     if (!product_id || !batch_number) {
//       console.warn("⚠️ Missing product_id or batch_number for item:", item);
//       completed++;
//       if (completed === items.length && !hasError) callback(null);
//       return;
//     }

//     // UPDATE: Increase both stock_in and quantity in batches table
//     const updateStockQuery = `
//       UPDATE batches 
//       SET 
//         stock_in = stock_in + ?,
//         quantity = quantity + ?,
//         updated_at = NOW()
//       WHERE product_id = ? AND batch_number = ?
//     `;

//     connection.query(updateStockQuery, [returnedQuantity, returnedQuantity, product_id, batch_number], (err, result) => {
//       if (err) {
//         console.error("❌ Error updating stock:", err);
//         hasError = err;
//       } else {
//         if (result.affectedRows === 0) {
//           console.warn(`⚠️ No batch found for product_id: ${product_id}, batch_number: ${batch_number}`);
//         } else {
//           console.log(`✅ Stock increased for product ${product_id}, batch ${batch_number}: +${returnedQuantity}`);
//         }
//       }

//       completed++;
//       if (completed === items.length) {
//         callback(hasError);
//       }
//     });
//   });
// }

// // Rollback function
// function rollback(connection, res, error) {
//   connection.rollback(() => {
//     connection.release();
//     console.error("Transaction rolled back due to error:", error);
//     res.status(500).json({ 
//       error: "Credit note creation failed", 
//       details: error.message 
//     });
//   });
// }


router.post('/create-debit-note', (req, res) => {
  const {
    invoiceNumber,
    noteDate,
    items,
    customerData,
    totals,
    noteText,
    terms,
    creditNoteNumber
  } = req.body;

  // Start transaction
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Error getting connection:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction((beginErr) => {
      if (beginErr) {
        connection.release();
        console.error("Error starting transaction:", beginErr);
        return res.status(500).json({ error: "Transaction failed to start" });
      }

      // Get original invoice details for reference
      const invoiceQuery = `SELECT * FROM voucher WHERE InvoiceNumber = ? AND TransactionType = 'Purchase'`;
      
      connection.query(invoiceQuery, [invoiceNumber], (invoiceErr, invoiceDetails) => {
        if (invoiceErr) {
          return rollback(connection, res, invoiceErr);
        }

        if (invoiceDetails.length === 0) {
          return rollback(connection, res, new Error('Original invoice not found'));
        }

        const originalInvoice = invoiceDetails[0];

        // Calculate totals from items - FIXED: Use the function that exists
        const calculatedTotals = calculateTotalsFromItems(items) || {
          totalQty: items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0),
          totalQty1: items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0),
          taxAmount: parseFloat(totals?.totalGST || 0) + parseFloat(totals?.totalIGST || 0),
          subtotal: parseFloat(totals?.taxableAmount || 0),
          totalAmount: parseFloat(totals?.grandTotal || 0),
          basicAmount: parseFloat(totals?.taxableAmount || 0),
          valueOfGoods: parseFloat(totals?.taxableAmount || 0),
          sgstAmount: parseFloat(totals?.totalGST || 0) / 2 || 0,
          cgstAmount: parseFloat(totals?.totalGST || 0) / 2 || 0,
          igstAmount: parseFloat(totals?.totalIGST || 0)
        };

        // Get product_id and batch from the first item
        const firstItem = items[0] || {};
        const product_id = firstItem.product_id || null;
        const batch_number = firstItem.batch || null;


        // Get batch_id from batches table using product_id and batch_number
        const getBatchIdQuery = `SELECT id FROM batches WHERE product_id = ? AND batch_number = ?`;
        
        connection.query(getBatchIdQuery, [product_id, batch_number], (batchErr, batchResults) => {
          if (batchErr) {
            return rollback(connection, res, batchErr);
          }

          let batch_id = null;
          if (batchResults.length > 0) {
            batch_id = batchResults[0].id;
          }

          console.log("🔍 Debug - Found Batch ID:", batch_id);

          // Insert credit note into voucher table WITH product_id and batch_id
          const creditNoteQuery = `
            INSERT INTO voucher (
              TransactionType, VchNo, product_id, batch_id, InvoiceNumber, Date, 
              PaymentTerms, Freight, TotalQty, TotalPacks, TotalQty1, TaxAmount, 
              Subtotal, BillSundryAmount, TotalAmount, ChequeNo, ChequeDate, BankName, 
              AccountID, AccountName, PartyID, PartyName, BasicAmount, ValueOfGoods, 
              EntryDate, SGSTPercentage, CGSTPercentage, IGSTPercentage, SGSTAmount, 
              CGSTAmount, IGSTAmount, TaxSystem, BatchDetails, paid_amount, 
              balance_amount, receipt_number, status, paid_date, DC
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const creditNoteValues = [
            'DebitNote',
            creditNoteNumber,
            product_id,
            batch_id,
            invoiceNumber,
            noteDate,
            originalInvoice.PaymentTerms || '',
            originalInvoice.Freight || 0,
            calculatedTotals.totalQty,
            originalInvoice.TotalPacks || 0,
            calculatedTotals.totalQty1,
            calculatedTotals.taxAmount,
            calculatedTotals.subtotal,
            originalInvoice.BillSundryAmount || 0,
            calculatedTotals.totalAmount,
            '',
            null,
            '',
            customerData?.account_id || originalInvoice.AccountID,
            customerData?.business_name || originalInvoice.AccountName,
            customerData?.party_id || originalInvoice.PartyID,
            customerData?.business_name || originalInvoice.PartyName,
            calculatedTotals.basicAmount,
            calculatedTotals.valueOfGoods,
            new Date(),
            originalInvoice.SGSTPercentage || 0,
            originalInvoice.CGSTPercentage || 0,
            originalInvoice.IGSTPercentage || 0,
            calculatedTotals.sgstAmount,
            calculatedTotals.cgstAmount,
            calculatedTotals.igstAmount,
            originalInvoice.TaxSystem || 'GST',
            JSON.stringify(items),
            0,
            calculatedTotals.totalAmount,
            '',
            'pending',
            null,
            noteText || ''
          ];

          connection.query(creditNoteQuery, creditNoteValues, (insertErr, result) => {
            if (insertErr) {
              console.error("❌ Error inserting credit note:", insertErr);
              return rollback(connection, res, insertErr);
            }

            const creditNoteId = result.insertId;

            // Update stock in batches table - INCREASE stock
            updateStockForCreditNote(connection, items, (stockErr) => {
              if (stockErr) {
                console.error("❌ Error updating stock:", stockErr);
                return rollback(connection, res, stockErr);
              }

              connection.commit((commitErr) => {
                if (commitErr) {
                  return rollback(connection, res, commitErr);
                }

                connection.release();

                console.log("✅ Credit note created successfully!");
                res.status(201).json({
                  success: true,
                  message: 'Credit note created successfully',
                  creditNoteId: creditNoteId,
                  creditNoteNumber: creditNoteNumber,
                  product_id: product_id,
                  batch_id: batch_id,
                  data: {
                    ...calculatedTotals,
                    items: items
                  }
                });
              });
            });
          });
        });
      });
    });
  });
});

// Function to calculate totals from items
function calculateTotalsFromItems(items) {
  if (!items || items.length === 0) {
    return null;
  }

  const totals = {
    totalQty: 0,
    totalQty1: 0,
    taxAmount: 0,
    subtotal: 0,
    totalAmount: 0,
    basicAmount: 0,
    valueOfGoods: 0,
    sgstAmount: 0,
    cgstAmount: 0,
    igstAmount: 0
  };

  items.forEach(item => {
    const quantity = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.price) || 0;
    const discount = parseFloat(item.discount) || 0;
    const gst = parseFloat(item.gst) || 0;
    const igst = parseFloat(item.igst) || 0;
    
    const itemTotal = (quantity * price) - discount;
    const gstAmount = itemTotal * (gst / 100);
    const igstAmount = itemTotal * (igst / 100);

    totals.totalQty += quantity;
    totals.totalQty1 += quantity;
    totals.subtotal += itemTotal;
    totals.basicAmount += itemTotal;
    totals.valueOfGoods += itemTotal;
    totals.taxAmount += gstAmount + igstAmount;
    
    // Split GST if applicable
    if (igst === 0 && gst > 0) {
      totals.sgstAmount += gstAmount / 2;
      totals.cgstAmount += gstAmount / 2;
    } else {
      totals.igstAmount += igstAmount;
    }
  });

  totals.totalAmount = totals.subtotal + totals.taxAmount;

  return totals;
}

// Function to update stock for credit note (INCREASE stock_in only)
// Function to update stock for credit note (INCREASE stock_in and quantity)
function updateStockForCreditNote(connection, items, callback) {
  if (!items || items.length === 0) {
    return callback(null);
  }

  let completed = 0;
  let hasError = null;

  items.forEach((item) => {
    const product_id = item.product_id;
    const batch_number = item.batch;
    const returnedQuantity = parseFloat(item.quantity) || 0;

    console.log(`🔄 Updating stock for product ${product_id}, batch ${batch_number}, quantity: +${returnedQuantity}`);

    if (!product_id || !batch_number) {
      console.warn("⚠️ Missing product_id or batch_number for item:", item);
      completed++;
      if (completed === items.length && !hasError) callback(null);
      return;
    }

    // UPDATE: Increase both stock_in and quantity in batches table
    const updateStockQuery = `
      UPDATE batches 
      SET 
        stock_out = stock_out + ?,
        quantity = quantity + ?,
        updated_at = NOW()
      WHERE product_id = ? AND batch_number = ?
    `;

    connection.query(updateStockQuery, [returnedQuantity, returnedQuantity, product_id, batch_number], (err, result) => {
      if (err) {
        console.error("❌ Error updating stock:", err);
        hasError = err;
      } else {
        if (result.affectedRows === 0) {
          console.warn(`⚠️ No batch found for product_id: ${product_id}, batch_number: ${batch_number}`);
        } else {
          console.log(`✅ Stock increased for product ${product_id}, batch ${batch_number}: +${returnedQuantity}`);
        }
      }

      completed++;
      if (completed === items.length) {
        callback(hasError);
      }
    });
  });
}

// Rollback function
function rollback(connection, res, error) {
  connection.rollback(() => {
    connection.release();
    console.error("Transaction rolled back due to error:", error);
    res.status(500).json({ 
      error: "Credit note creation failed", 
      details: error.message 
    });
  });
}

// ------------------------------
// Get all credit notes
// ------------------------------
router.get('/debitnotes', async (req, res) => {
  try {
    db.execute(
      `SELECT 
         v.*, 
         a.business_name, 
         a.name AS payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
           FROM voucher v2
           WHERE v2.VchNo = v.VchNo
           AND v2.TransactionType IN ('Purchase', 'DebitNote')
           AND v2.InvoiceNumber IS NOT NULL
           AND v2.InvoiceNumber != ''
         ) AS invoice_numbers
       FROM voucher v
       LEFT JOIN accounts a ON v.PartyID = a.id
       WHERE v.TransactionType = 'DebitNote'
       ORDER BY v.created_at DESC`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching credit notes:', error);
          return res.status(500).json({ error: 'Failed to fetch credit notes' });
        }

        // Convert invoice_numbers string to array
        const processedResults = results.map(creditNote => ({
          ...creditNote,
          invoice_numbers: creditNote.invoice_numbers ? creditNote.invoice_numbers.split(',') : []
        }));

        console.log('Credit notes fetched from voucher table:', processedResults.length);
        res.json(processedResults || []);
      }
    );
  } catch (error) {
    console.error('Error in /DebitNotes route:', error);
    res.status(500).json({ error: 'Failed to fetch credit notes' });
  }
});

// ------------------------------
// Get credit note by ID
// ------------------------------
router.get('/debitnotes/:id', async (req, res) => {
  try {
    db.execute(
      `SELECT 
         v.*, 
         a.business_name, 
         a.name AS payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
           FROM voucher v2
           WHERE v2.VchNo = v.VchNo
           AND v2.TransactionType IN ('Purchase', 'DebitNote')
           AND v2.InvoiceNumber IS NOT NULL
           AND v2.InvoiceNumber != ''
         ) AS invoice_numbers
       FROM voucher v
       LEFT JOIN accounts a ON v.PartyID = a.id
       WHERE v.VoucherID = ? 
       AND v.TransactionType = 'DebitNote'`,
      [req.params.id],
      (error, results) => {
        if (error) {
          console.error('Database error fetching credit note:', error);
          return res.status(500).json({ error: 'Failed to fetch credit note' });
        }

        if (!results || results.length === 0) {
          return res.status(404).json({ error: 'Credit note not found' });
        }

        // Convert invoice_numbers to array
        const creditNote = {
          ...results[0],
          invoice_numbers: results[0].invoice_numbers
            ? results[0].invoice_numbers.split(',')
            : []
        };

        console.log('Credit note fetched from voucher table:', creditNote);
        res.json(creditNote);
      }
    );
  } catch (error) {
    console.error('Error in /DebitNotes/:id route:', error);
    res.status(500).json({ error: 'Failed to fetch credit note' });
  }
});

router.get("/debit-notes-table", (req, res) => {
  const query = `
    SELECT 
      v.VoucherID,
      v.TransactionType,
      v.VchNo,
      v.product_id,
      v.batch_id,
      v.InvoiceNumber,
      v.Date,
      v.PaymentTerms,
      v.Freight,
      v.TotalPacks,
      v.TaxAmount,
      v.Subtotal,
      v.BillSundryAmount,
      v.TotalAmount,
      v.ChequeNo,
      v.ChequeDate,
      v.BankName,
      v.AccountID,

      -- Correct Party Name via accounts table
      v.PartyID,
      a.name AS PartyName,
      a.id AS AccountPartyID,

      v.BasicAmount,
      v.ValueOfGoods,
      v.EntryDate,
      v.SGSTPercentage,
      v.CGSTPercentage,
      v.IGSTPercentage,
      v.SGSTAmount,
      v.CGSTAmount,
      v.IGSTAmount,
      v.TaxSystem,
      v.paid_amount,
      v.created_at,
      v.balance_amount,
      v.status,
      v.paid_date,
      v.pdf_data,
      v.DC,
      v.pdf_file_name,
      v.pdf_created_at
    FROM voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id
    WHERE v.TransactionType = 'DebitNote'
    ORDER BY v.VoucherID DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        success: false,
        error: "Database error",
        message: err.message
      });
    }

    console.log(`Found ${results.length} debit notes`);

    res.json({
      success: true,
      count: results.length,
      debitNotes: results
    });
  });
});




module.exports = router;