const express = require("express");
const router = express.Router();
const db = require("../db"); // your db connection

// 🧮 Generate Next Credit Note Number
router.get("/next-creditnote-number", (req, res) => {
  const query = "SELECT VchNo FROM voucher ORDER BY VoucherID DESC LIMIT 1";

  db.query(query, (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ 
        error: "Database error",
        message: err.message 
      });
    }

    let nextNumber = "CNOTE0001";
    
    if (result.length > 0 && result[0].VchNo) {
      const lastNumber = result[0].VchNo;
      
      // Extract numeric part and increment
      const match = lastNumber.match(/CNOTE(\d+)/);
      if (match) {
        const num = parseInt(match[1]) + 1;
        nextNumber = `CNOTE${num.toString().padStart(4, "0")}`;
      } else {
        // If format doesn't match, start from CNOTE0001
        nextNumber = "CNOTE0001";
      }
    }

    console.log("Next credit note number:", nextNumber);
    res.json({ 
      nextCreditNoteNumber: nextNumber,
      success: true
    });
  });
});
// Get invoice details
router.get("/invoice-details/:invoiceNumber", (req, res) => {
  const { invoiceNumber } = req.params;

  // Fetch invoice + account data
  const invoiceQuery = `
    SELECT 
      v.VoucherID, 
      v.InvoiceNumber, 
      v.PartyID, 
      a.*
    FROM voucher v
    JOIN accounts a ON v.PartyID = a.id
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

      // Add details into response
      invoiceData.items = voucherDetails;
      res.json(invoiceData);
    });
  });
});

// Get sales invoices for credit note
router.get("/credit-notesales", (req, res) => { 
  const query = `
    SELECT VoucherID, InvoiceNumber 
    FROM voucher 
    WHERE TransactionType = 'Sales'
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
router.post('/create-credit-note', (req, res) => {
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
      const invoiceQuery = `SELECT * FROM voucher WHERE InvoiceNumber = ? AND TransactionType = 'sales'`;
      
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

        console.log("🔍 Debug - Product ID:", product_id);
        console.log("🔍 Debug - Batch Number:", batch_number);
        console.log("🔍 Debug - All items:", items);

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
            'creditnote',
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

              // REMOVED: updateNextCreditNoteNumber function call
              // Commit transaction directly after stock update
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

// Function to update stock for credit note (INCREASE stock)
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

    // UPDATE: Increase stock_in and quantity in batches table
    const updateStockQuery = `
      UPDATE batches 
      SET 
        stock_in = stock_in + ?,
      
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











router.get("/credit-notes-table", (req, res) => {
  const query = `
    SELECT 
      VoucherID,
      TransactionType,
      VchNo,
      product_id,
      batch_id,
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
      created_at,
      balance_amount,
      receipt_number,
      status,
      paid_date,
      pdf_data,
      DC,
      pdf_file_name,
      pdf_created_at
    FROM voucher
    WHERE TransactionType = 'creditnote' 
    ORDER BY VoucherID DESC
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

    console.log(`Found ${results.length} credit notes`);
    res.json({
      success: true,
      count: results.length,
      creditNotes: results
    });
  });
});


module.exports = router;