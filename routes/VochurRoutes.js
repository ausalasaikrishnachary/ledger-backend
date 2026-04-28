const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios'); // ADD THIS LINE

router.get("/next-invoice-number", async (req, res) => {
  try {
    const { transactionType } = req.query; // Get transaction type from request
    
    // Validate transaction type
    const validTypes = ['Sales', 'Purchase', 'stock transfer', 'stock inward'];
    if (!transactionType || !validTypes.includes(transactionType)) {
      return res.status(400).send({ 
        error: 'Valid transactionType is required (Sales, Purchase, stock transfer, or stock inward)' 
      });
    }
    
    const getFinancialYear = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth(); 
      
      if (month >= 3) { // April to March
        return `${year.toString().slice(-2)}-${(year + 1).toString().slice(-2)}`;
      } else { // January to March
        return `${(year - 1).toString().slice(-2)}-${year.toString().slice(-2)}`;
      }
    };
    
    const currentFY = getFinancialYear();
    
    // Set prefix based on transaction type
    let prefix = '';
    switch(transactionType) {
      case 'Sales':
        prefix = `SSA/`;
        break;
      case 'Purchase':
        prefix = `SSA/`;
        break;
      case 'stock transfer':
        prefix = `CS/`;
        break;
      case 'stock inward':
        prefix = `SSk/`;
        break;
      default:
        prefix = `SSA/`;
    }
    
    const suffix = `/${currentFY}`;
    const likePattern = `${prefix}%${suffix}`;
    
    // Fixed query - only one LIKE condition with the pattern
    const query = `
      SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(InvoiceNumber, '/', 2), '/', -1) AS UNSIGNED)) as maxNumber 
      FROM voucher 
      WHERE TransactionType = ? 
      AND InvoiceNumber LIKE ?
    `;
    
    db.query(query, [transactionType, likePattern], (err, results) => {
      if (err) {
        console.error('Error fetching next invoice number:', err);
        return res.status(500).send({ error: 'Failed to get next invoice number' });
      }

      let nextNumber = 1;
      if (results[0].maxNumber !== null && !isNaN(results[0].maxNumber)) {
        nextNumber = parseInt(results[0].maxNumber) + 1;
      }

      const nextInvoiceNumber = `${prefix}${nextNumber.toString().padStart(6, '0')}${suffix}`;
      
      res.send({ 
        nextInvoiceNumber,
        transactionType,
        financialYear: currentFY,
        prefix: prefix
      });
    });
  } catch (error) {
    console.error('Error in next-invoice-number:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
});
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
  let base64Data = pdfInfo.pdf_data;

  // 🟢 FIX: Convert Buffer → String
  if (Buffer.isBuffer(base64Data)) {
    base64Data = base64Data.toString();
  }

  // 🟢 FIX: Ensure it's a string before checking .startsWith()
  if (typeof base64Data === "string") {
    if (base64Data.startsWith("data:application/pdf;base64,")) {
      base64Data = base64Data.replace("data:application/pdf;base64,", "");
    }
  } else {
    return res.status(400).json({ error: "Invalid PDF data format" });
  }

  // Convert base64 to buffer
  const pdfBuffer = Buffer.from(base64Data, "base64");

  // Set headers
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${pdfInfo.pdf_file_name}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.setHeader("Cache-Control", "no-cache");

  console.log("Sending PDF buffer, size:", pdfBuffer.length);

  res.send(pdfBuffer);

} catch (err) {
  console.error("Error processing PDF:", err);
  res.status(500).json({ error: "PDF processing failed" });
}

  });
});


router.get("/transactions/download-pdf", (req, res) => {
  const { order_number } = req.query;

  if (!order_number) {
    return res.status(400).json({
      success: false,
      message: 'Order number is required'
    });
  }

  console.log('Downloading PDF(s) for order:', order_number);

  const query = `
    SELECT pdf_data, pdf_file_name , status
    FROM voucher 
    WHERE order_number = ? AND pdf_data IS NOT NULL
    ORDER BY created_at ASC
  `;

  db.query(query, [order_number], (err, results) => {
    if (err) {
      console.error('Error fetching PDFs:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch PDFs'
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'PDFs not found for this order'
      });
    }

    // Return all PDFs as an array in response
    const pdfs = results.map((pdfInfo, index) => {
      let base64Data = pdfInfo.pdf_data;
      
      if (Buffer.isBuffer(base64Data)) {
        base64Data = base64Data.toString();
      }

      if (typeof base64Data === "string") {
        if (base64Data.startsWith("data:application/pdf;base64,")) {
          base64Data = base64Data.replace("data:application/pdf;base64,", "");
        }
      }

      return {
        fileName: pdfInfo.pdf_file_name || `invoice_${index + 1}.pdf`,
        status : pdfInfo.status,
        data: base64Data
      };
    });

    res.json({
      success: true,
      count: pdfs.length,
      orderNumber: order_number,
      pdfs: pdfs
    });
  });
});

function queryPromise(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}
router.put("/creditnoteupdate/:id", async (req, res) => {
  const voucherId = req.params.id;
  const updateData = req.body;

  console.log("UPDATE RECEIVED => ", voucherId, updateData);

  db.getConnection((err, connection) => {
    if (err)
      return res.status(500).send({ error: "Database connection failed" });

    connection.beginTransaction(async (err) => {
      if (err)
        return res.status(500).send({ error: "Transaction could not start" });

      try {
        // 1️⃣ Fetch ORIGINAL VOUCHER
        const originalVoucherRows = await queryPromise(
          connection,
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        if (originalVoucherRows.length === 0) {
          throw new Error("Voucher not found");
        }

        const originalVoucher = originalVoucherRows[0];
        const transactionType =
          updateData.transactionType ||
          originalVoucher.TransactionType ||
          "CreditNote";

        // 2️⃣ FETCH OLD VOUCHERDETAILS (to reverse stock)
        const oldDetails = await queryPromise(
          connection,
          "SELECT * FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // Reverse OLD STOCK
        for (const item of oldDetails) {
          const batchRows = await queryPromise(
            connection,
            "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          if (!batchRows[0]) continue;
          const batch = batchRows[0];
          const qty = Number(item.quantity) || 0;

          await queryPromise(
            connection,
            "UPDATE batches SET quantity = quantity - ?, stock_in = IF(stock_in - ? >= 0, stock_in - ?, 0) WHERE id = ?",
            [qty, qty, qty, batch.id]
          );
        }

        // 3️⃣ DELETE OLD VOUCHERDETAILS
        await queryPromise(
          connection,
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // 4️⃣ PARSE NEW ITEMS
        let newBatchDetails =
          updateData.batchDetails ||
          updateData.items ||
          updateData.batch_details ||
          [];

        if (!Array.isArray(newBatchDetails)) {
          try {
            newBatchDetails = JSON.parse(newBatchDetails);
          } catch {
            newBatchDetails = [];
          }
        }

        newBatchDetails = newBatchDetails.map((it) => ({
          product: it.product || "",
          product_id: Number(it.product_id || it.productId || 0),
          batch: it.batch || it.batch_number || "",
          quantity: Number(it.quantity) || 0,
          price: Number(it.price) || 0,
          discount: Number(it.discount) || 0,
          gst: Number(it.gst) || 0,
          cgst: Number(it.cgst) || 0,
          sgst: Number(it.sgst) || 0,
          igst: Number(it.igst) || 0,
          cess: Number(it.cess) || 0,
          total: Number(it.total) || 0,
        }));

        // 🔴 NEW VALIDATION: Check if Credit Note quantity exceeds Sales quantity
        const invoiceNumber = updateData.InvoiceNumber || originalVoucher.InvoiceNumber;
        
        // Variables for original invoice balance
        let originalSalesId = null;
        let originalSalesBalance = 0;
        let originalSalesTotal = 0;
        
        // Get actual old credit note total from voucherdetails
        let actualOldCreditNoteTotal = 0;
        
        const oldCreditNoteDetails = await queryPromise(
          connection,
          "SELECT SUM(total) as totalAmount FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );
        
        if (oldCreditNoteDetails[0] && oldCreditNoteDetails[0].totalAmount) {
          actualOldCreditNoteTotal = parseFloat(oldCreditNoteDetails[0].totalAmount) || 0;
        } else {
          actualOldCreditNoteTotal = parseFloat(originalVoucher.TotalAmount) || 0;
        }
        
// 👇 FIXED: Get new credit note total from updateData.TotalAmount first
let newCreditNoteTotal = parseFloat(updateData.TotalAmount) || 
                        parseFloat(updateData.totalAmount) || 
                        newBatchDetails.reduce((sum, item) => sum + (item.total || 0), 0);
        console.log("💰 Credit Note Amounts:", {
          
          oldCreditNoteTotal: actualOldCreditNoteTotal,
          newCreditNoteTotal: newCreditNoteTotal
        });

        if (invoiceNumber) {
          const salesVoucherRows = await queryPromise(
            connection,
            `
              SELECT *
              FROM voucher
              WHERE InvoiceNumber = ?
                AND TransactionType IN ('Sales', 'stock transfer')
            `,
            [invoiceNumber]
          );

          if (salesVoucherRows.length > 0) {
            const salesVoucherId = salesVoucherRows[0].VoucherID;
            
            originalSalesId = salesVoucherId;
            originalSalesTotal = parseFloat(salesVoucherRows[0].TotalAmount) || 0;
            originalSalesBalance = parseFloat(salesVoucherRows[0].balance_amount) || originalSalesTotal;
            
            const salesDetails = await queryPromise(
              connection,
              "SELECT * FROM voucherdetails WHERE voucher_id = ?",
              [salesVoucherId]
            );

            const salesQuantityMap = new Map();
            for (const salesItem of salesDetails) {
              const key = `${salesItem.product_id}_${salesItem.batch}`;
              salesQuantityMap.set(key, Number(salesItem.quantity) || 0);
            }

            for (const creditNoteItem of newBatchDetails) {
              const key = `${creditNoteItem.product_id}_${creditNoteItem.batch}`;
              const salesQuantity = salesQuantityMap.get(key) || 0;
              const creditNoteQuantity = Number(creditNoteItem.quantity) || 0;

              if (creditNoteQuantity > salesQuantity) {
                connection.rollback(() => {
                  connection.release();
                  return res.status(400).json({ 
                    success: false, 
                    message: `Quantity exceeds sales quantity! Product: ${creditNoteItem.product}, Batch: ${creditNoteItem.batch}. Sales Quantity: ${salesQuantity}, Credit Note Quantity: ${creditNoteQuantity}`
                  });
                });
                return;
              }
            }
          } else {
            connection.rollback(() => {
              connection.release();
              return res.status(400).json({ 
                success: false, 
                message: `No Sales voucher found for Invoice Number: ${invoiceNumber}`
              });
            });
            return;
          }
        }

        const rawDate = updateData.Date || originalVoucher.Date;

        let voucherDate = null;
        if (rawDate) {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            voucherDate = d.toISOString().slice(0, 19).replace("T", " ");
          }
        }

        console.log("🔥 RAW DATE:", rawDate);
        console.log("🔥 MYSQL DATE:", voucherDate);

        // ========== CORRECTED BALANCE CALCULATION ==========
        let creditNoteBalanceAmount = newCreditNoteTotal;
        let newSalesBalance = originalSalesBalance;

        if (originalSalesId) {
          console.log("📊 Balance Calculations - Input Values:", {
            originalSalesBalance: originalSalesBalance,
            originalSalesTotal: originalSalesTotal,
            actualOldCreditNoteTotal: actualOldCreditNoteTotal,
            newCreditNoteTotal: newCreditNoteTotal,
            invoiceNumber: invoiceNumber
          });

          // Validate that new credit note total doesn't exceed original sales total
          if (newCreditNoteTotal > originalSalesTotal) {
            throw new Error(`Credit Note amount (${newCreditNoteTotal}) cannot exceed original Sales amount (${originalSalesTotal})`);
          }

          // CORRECT FORMULA: Sales Balance after update = Sales Total - New Credit Note Total
          // This gives the remaining amount after this credit note
          newSalesBalance = originalSalesTotal - newCreditNoteTotal;
          
          // Ensure balance doesn't go negative
          newSalesBalance = Math.max(0, newSalesBalance);
          
          // Credit Note's balance_amount should be the SAME as the updated Sales balance
          // Both represent the remaining amount after this credit note
          creditNoteBalanceAmount = newSalesBalance;
          
          console.log("📊 Balance Calculations - Results:", {
            newSalesBalance: newSalesBalance,
            creditNoteBalanceAmount: creditNoteBalanceAmount
          });
        }
        // ========== END OF CORRECTED CALCULATION ==========

        // --------------------------------------
        // UPDATE voucher TABLE
        // --------------------------------------
        const sql = `
          UPDATE voucher SET
            VchNo = ?,
            Date = ?,
            InvoiceNumber = ?,
            PartyName = ?,
            BasicAmount = ?,
            TaxAmount = ?,
            TotalAmount = ?,
            Subtotal = ?,
            SGSTAmount = ?,
            CGSTAmount = ?,
            IGSTAmount = ?,
            SGSTPercentage = ?,
            CGSTPercentage = ?,
            IGSTPercentage = ?,
            paid_amount = ?,
            data_type = ?,
            balance_amount = ?
          WHERE VoucherID = ?
        `;

        const taxAmount = Number(updateData.TaxAmount) || originalVoucher.TaxAmount;
        const igstPercentage = Number(updateData.IGSTPercentage) || originalVoucher.IGSTPercentage || 0;
        
        const values = [
          updateData.VchNo ||
            updateData.creditNoteNumber ||
            originalVoucher.VchNo,

          voucherDate,

          updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
          updateData.PartyName || originalVoucher.PartyName,

          Number(updateData.BasicAmount) || originalVoucher.BasicAmount,
          taxAmount,
          Number(updateData.TotalAmount) || originalVoucher.TotalAmount,

          Number(updateData.BasicAmount) || originalVoucher.Subtotal,

          0,
          0,
          taxAmount,

          0,
          0,
          igstPercentage,

          Number(updateData.TotalAmount) || originalVoucher.paid_amount,

          updateData.data_type || originalVoucher.data_type || null,

          creditNoteBalanceAmount, // 👈 This sets credit note's balance_amount

          voucherId
        ];

        await queryPromise(connection, sql, values);

        // 6️⃣ INSERT NEW voucherdetails ROWS
        for (const it of newBatchDetails) {
          await queryPromise(
            connection,
            `INSERT INTO voucherdetails 
              (voucher_id, product, product_id, transaction_type, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              voucherId,
              it.product,
              it.product_id,
              "CreditNote",
              updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
              it.batch,
              it.quantity,
              it.price,
              it.discount,
              it.gst,
              it.cgst,
              it.sgst,
              it.igst,
              it.cess,
              it.total,
            ]
          );
        }

        // 7️⃣ UPDATE NEW STOCK
        for (const it of newBatchDetails) {
          const rows = await queryPromise(
            connection,
            "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
            [it.product_id, it.batch]
          );

          if (!rows[0]) {
            throw new Error(
              `Batch not found for product ${it.product_id}, batch ${it.batch}`
            );
          }

          const batch = rows[0];

          await queryPromise(
            connection,
            "UPDATE batches SET quantity = quantity + ?, stock_in = stock_in + ? WHERE id = ?",
            [it.quantity, it.quantity, batch.id]
          );
        }

        // 👇 UPDATE ORIGINAL SALES INVOICE BALANCE
        if (originalSalesId) {
          let newStatus = "active";
          if (newSalesBalance <= 0) {
            newStatus = "Paid";
          } else if (newSalesBalance < originalSalesTotal) {
            newStatus = "Partial";
          }
          
          await queryPromise(
            connection,
            `UPDATE voucher 
             SET balance_amount = ?, 
                 status = ?,
                 updated_at = NOW()
             WHERE VoucherID = ?`,
            [newSalesBalance, newStatus, originalSalesId]
          );
          
          console.log(`✅ Original Sales Invoice updated:`, {
            voucherId: originalSalesId,
            newBalance: newSalesBalance,
            newStatus: newStatus
          });
        }

        // 8️⃣ COMMIT
        connection.commit((err) => {
          if (err) {
            console.log("COMMIT ERROR:", err);
            connection.rollback(() => {
              connection.release();
              return res.status(500).json({ success: false, message: "Commit failed" });
            });
            return;
          }
          
          connection.release();
          res.json({
            success: true,
            message: "Credit Note updated successfully",
            voucherId,
          });
        });
      } catch (err) {
        console.log("UPDATE ERROR:", err);
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ success: false, message: err.message });
        });
      }
    });
  });
});
router.put("/debitnoteupdate/:id", async (req, res) => {
  const voucherId = req.params.id;
  const updateData = req.body;

  console.log("UPDATE RECEIVED => ", voucherId, updateData);

  db.getConnection((err, connection) => {
    if (err)
      return res.status(500).send({ error: "Database connection failed" });

    connection.beginTransaction(async (err) => {
      if (err)
        return res.status(500).send({ error: "Transaction could not start" });

      try {
        // 1️⃣ Fetch ORIGINAL VOUCHER (Debit Note being updated)
        const originalVoucherRows = await queryPromise(
          connection,
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        if (originalVoucherRows.length === 0) {
          throw new Error("Voucher not found");
        }

        const originalVoucher = originalVoucherRows[0];
        const transactionType =
          updateData.transactionType ||
          originalVoucher.TransactionType ||
          "DebitNote";

        // 2️⃣ FETCH OLD VOUCHERDETAILS (to reverse stock)
        const oldDetails = await queryPromise(
          connection,
          "SELECT * FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // Get the invoice number (the original Purchase invoice this debit note is for)
        const invoiceNumber = updateData.InvoiceNumber || originalVoucher.InvoiceNumber;
        
        // 👇 ADDED: Variables for original purchase invoice balance
        let originalPurchaseId = null;
        let originalPurchaseBalance = 0;
        let originalPurchaseTotal = 0;
        
        // 👇 ADDED: Get actual old debit note total from voucherdetails
        let actualOldDebitNoteTotal = 0;
        
        const oldDebitNoteDetails = await queryPromise(
          connection,
          "SELECT SUM(total) as totalAmount FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );
        
        if (oldDebitNoteDetails[0] && oldDebitNoteDetails[0].totalAmount) {
          actualOldDebitNoteTotal = parseFloat(oldDebitNoteDetails[0].totalAmount) || 0;
        } else {
          actualOldDebitNoteTotal = parseFloat(originalVoucher.TotalAmount) || 0;
        }

        for (const item of oldDetails) {
          const batchRows = await queryPromise(
            connection,
            "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          if (!batchRows[0]) continue;
          const batch = batchRows[0];
          const qty = Number(item.quantity) || 0;

          // For Debit Note: Original was stock OUT, so reversal is stock IN
          await queryPromise(
            connection,
            "UPDATE batches SET quantity = quantity + ?, stock_out = GREATEST(0, stock_out - ?) WHERE id = ?",
            [qty, qty, batch.id]
          );
        }

        // 3️⃣ DELETE OLD VOUCHERDETAILS
        await queryPromise(
          connection,
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // 4️⃣ PARSE NEW ITEMS
        let newBatchDetails =
          updateData.batchDetails ||
          updateData.items ||
          updateData.batch_details ||
          [];

        if (!Array.isArray(newBatchDetails)) {
          try {
            newBatchDetails = JSON.parse(newBatchDetails);
          } catch {
            newBatchDetails = [];
          }
        }

        newBatchDetails = newBatchDetails.map((it) => ({
          product: it.product || "",
          product_id: Number(it.product_id || it.productId || 0),
          batch: it.batch || it.batch_number || "",
          quantity: Number(it.quantity) || 0,
          price: Number(it.price) || 0,
          discount: Number(it.discount) || 0,
          gst: Number(it.gst) || 0,
          cgst: Number(it.cgst) || 0,
          sgst: Number(it.sgst) || 0,
          igst: Number(it.igst) || 0,
          cess: Number(it.cess) || 0,
          total: Number(it.total) || 0,
        }));

        // 👇 ADDED: Get new debit note total from updateData.TotalAmount first
        let newDebitNoteTotal = parseFloat(updateData.TotalAmount) || 
                                parseFloat(updateData.totalAmount) || 
                                newBatchDetails.reduce((sum, item) => sum + (item.total || 0), 0);

        console.log("💰 Debit Note Amounts:", {
          oldDebitNoteTotal: actualOldDebitNoteTotal,
          newDebitNoteTotal: newDebitNoteTotal,
          updateDataTotalAmount: updateData.TotalAmount
        });
        
        if (invoiceNumber) {
          const purchaseVoucherRows = await queryPromise(
            connection,
            `
              SELECT * 
              FROM voucher 
              WHERE InvoiceNumber = ?
                AND TransactionType IN ('Purchase', 'stock inward')
            `,
            [invoiceNumber]
          );

          if (purchaseVoucherRows.length > 0) {
            const purchaseVoucherId = purchaseVoucherRows[0].VoucherID;
            
            // 👇 ADDED: Get current balance of original purchase invoice
            originalPurchaseId = purchaseVoucherId;
            originalPurchaseTotal = parseFloat(purchaseVoucherRows[0].TotalAmount) || 0;
            originalPurchaseBalance = parseFloat(purchaseVoucherRows[0].balance_amount) || originalPurchaseTotal;
            
            // Get all purchase details for this invoice
            const purchaseDetails = await queryPromise(
              connection,
              "SELECT * FROM voucherdetails WHERE voucher_id = ?",
              [purchaseVoucherId]
            );

            // Create a map of product_id+batch to purchase quantity
            const purchaseQuantityMap = new Map();
            for (const purchaseItem of purchaseDetails) {
              const key = `${purchaseItem.product_id}_${purchaseItem.batch}`;
              purchaseQuantityMap.set(key, Number(purchaseItem.quantity) || 0);
            }

            // Get all debit notes for this invoice (excluding current one being edited)
            const allDebitNotes = await queryPromise(
              connection,
              `SELECT vd.* FROM voucherdetails vd 
               JOIN voucher v ON vd.voucher_id = v.VoucherID 
               WHERE v.InvoiceNumber = ? 
               AND vd.transaction_type = 'DebitNote' 
               AND v.VoucherID != ?`,
              [invoiceNumber, voucherId]
            );

            // Calculate total debit note quantities already used
            const usedDebitQuantityMap = new Map();
            for (const debitItem of allDebitNotes) {
              const key = `${debitItem.product_id}_${debitItem.batch}`;
              const currentUsed = usedDebitQuantityMap.get(key) || 0;
              usedDebitQuantityMap.set(key, currentUsed + Number(debitItem.quantity));
            }

            // Add the old debit note quantities (that we're editing)
            for (const oldItem of oldDetails) {
              const key = `${oldItem.product_id}_${oldItem.batch}`;
              const currentUsed = usedDebitQuantityMap.get(key) || 0;
              usedDebitQuantityMap.set(key, currentUsed + Number(oldItem.quantity));
            }

            // Validate each debit note item
            for (const debitNoteItem of newBatchDetails) {
              const key = `${debitNoteItem.product_id}_${debitNoteItem.batch}`;
              const purchaseQuantity = purchaseQuantityMap.get(key) || 0;
              const debitNoteQuantity = Number(debitNoteItem.quantity) || 0;
              const alreadyUsedQuantity = usedDebitQuantityMap.get(key) || 0;
              
              // Available quantity = Purchase Quantity - Already used Debit Note Quantities (excluding this item's old quantity)
              const availableForNewDebit = purchaseQuantity - alreadyUsedQuantity + 
                (oldDetails.find(d => 
                  d.product_id === debitNoteItem.product_id && 
                  d.batch === debitNoteItem.batch
                )?.quantity || 0);

              if (debitNoteQuantity > availableForNewDebit) {
                connection.rollback(() => {
                  connection.release();
                  return res.status(400).json({ 
                    success: false, 
                    message: `Quantity exceeds available quantity! Product: ${debitNoteItem.product}, Batch: ${debitNoteItem.batch}. Available: ${availableForNewDebit}, Debit Note Quantity: ${debitNoteQuantity}`
                  });
                });
                return;
              }
            }
          } else {
            connection.rollback(() => {
              connection.release();
              return res.status(400).json({ 
                success: false, 
                message: `No Purchase voucher found for Invoice Number: ${invoiceNumber}`
              });
            });
            return;
          }
        }

        // 5️⃣ UPDATE voucher TABLE (WITH balance_amount added)
        
        // Helper function for MySQL datetime conversion
        function toMySQLDateTime(value) {
          if (!value) return null;
          const d = new Date(value);
          if (isNaN(d.getTime())) return null;
          return d.toISOString().slice(0, 19).replace("T", " ");
        }

        // Calculate GST values properly
        const taxAmount = Number(updateData.TaxAmount) || originalVoucher.TaxAmount;
        const igstPercentage = Number(updateData.IGSTPercentage) || 
                              (updateData.IGSTPercentage === 0 ? 0 : originalVoucher.IGSTPercentage) || 0;
        
        // Determine if this is IGST or SGST/CGST based on the data
        const hasIGST = igstPercentage > 0 || (updateData.IGSTAmount && updateData.IGSTAmount > 0);

        // 👇 ADDED: Calculate new balance amounts for debit note
        let debitNoteBalanceAmount = newDebitNoteTotal;
        let newPurchaseBalance = originalPurchaseBalance;

        if (originalPurchaseId) {
          console.log("📊 Balance Calculations - Input Values:", {
            originalPurchaseBalance: originalPurchaseBalance,
            originalPurchaseTotal: originalPurchaseTotal,
            actualOldDebitNoteTotal: actualOldDebitNoteTotal,
            newDebitNoteTotal: newDebitNoteTotal,
            invoiceNumber: invoiceNumber
          });

          // Validate that new debit note total doesn't exceed original purchase total
          if (newDebitNoteTotal > originalPurchaseTotal) {
            throw new Error(`Debit Note amount (${newDebitNoteTotal}) cannot exceed original Purchase amount (${originalPurchaseTotal})`);
          }

          newPurchaseBalance = originalPurchaseTotal - newDebitNoteTotal;
          
          // Ensure balance doesn't go negative
          newPurchaseBalance = Math.max(0, newPurchaseBalance);
          
          debitNoteBalanceAmount = newPurchaseBalance;
          
          console.log("📊 Balance Calculations - Results:", {
            newPurchaseBalance: newPurchaseBalance,
            debitNoteBalanceAmount: debitNoteBalanceAmount
          });
        }
        
        await queryPromise(
          connection,
          `UPDATE voucher SET
            VchNo = ?,
            Date = ?,
            InvoiceNumber = ?,
            PartyName = ?,
            BasicAmount = ?,
            TaxAmount = ?,
            TotalAmount = ?,
            Subtotal = ?,
            SGSTAmount = ?,
            CGSTAmount = ?,
            IGSTAmount = ?,
            SGSTPercentage = ?,
            CGSTPercentage = ?,
            IGSTPercentage = ?,
            paid_amount = ?,
            data_type = ?,
            balance_amount = ? 
          WHERE VoucherID = ?`,
          [
            updateData.VchNo || updateData.creditNoteNumber || originalVoucher.VchNo,

            toMySQLDateTime(updateData.Date || originalVoucher.Date),

            updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
            updateData.PartyName || originalVoucher.PartyName,

            Number(updateData.BasicAmount) || originalVoucher.BasicAmount,
            taxAmount,
            Number(updateData.TotalAmount) || originalVoucher.TotalAmount,

            Number(updateData.BasicAmount) || originalVoucher.Subtotal,

            hasIGST ? 0 : (Number(updateData.SGSTAmount) || originalVoucher.SGSTAmount || 0),
            hasIGST ? 0 : (Number(updateData.CGSTAmount) || originalVoucher.CGSTAmount || 0),
            hasIGST ? taxAmount : (Number(updateData.IGSTAmount) || originalVoucher.IGSTAmount || 0),

            hasIGST ? 0 : (Number(updateData.SGSTPercentage) || originalVoucher.SGSTPercentage || 0),
            hasIGST ? 0 : (Number(updateData.CGSTPercentage) || originalVoucher.CGSTPercentage || 0),
            hasIGST ? igstPercentage : (Number(updateData.IGSTPercentage) || originalVoucher.IGSTPercentage || 0),

            Number(updateData.TotalAmount) || originalVoucher.paid_amount,
            updateData.data_type || originalVoucher.data_type || null,

            debitNoteBalanceAmount, 

            voucherId,
          ]
        );

        // 6️⃣ INSERT NEW voucherdetails ROWS
        for (const it of newBatchDetails) {
          await queryPromise(
            connection,
            `INSERT INTO voucherdetails 
              (voucher_id, product, product_id, transaction_type, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              voucherId,
              it.product,
              it.product_id,
              "DebitNote",
              updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
              it.batch,
              it.quantity,
              it.price,
              it.discount,
              it.gst,
              it.cgst,
              it.sgst,
              it.igst,
              it.cess,
              it.total,
            ]
          );
        }

        // 7️⃣ UPDATE NEW STOCK (DEBIT NOTE = STOCK OUT)
        for (const it of newBatchDetails) {
          const rows = await queryPromise(
            connection,
            "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
            [it.product_id, it.batch]
          );

          if (!rows[0]) {
            throw new Error(
              `Batch not found for product ${it.product_id}, batch ${it.batch}`
            );
          }

          const batch = rows[0];

          // For Debit Note: This is stock OUT
          await queryPromise(
            connection,
            "UPDATE batches SET quantity = GREATEST(0, quantity - ?), stock_out = stock_out + ? WHERE id = ?",
            [it.quantity, it.quantity, batch.id]
          );
        }

        // 👇 ADDED: UPDATE ORIGINAL PURCHASE INVOICE BALANCE
        if (originalPurchaseId) {
          let newStatus = "active";
          if (newPurchaseBalance <= 0) {
            newStatus = "Paid";
          } else if (newPurchaseBalance < originalPurchaseTotal) {
            newStatus = "Partial";
          }
          
          await queryPromise(
            connection,
            `UPDATE voucher 
             SET balance_amount = ?, 
                 status = ?,
                 updated_at = NOW()
             WHERE VoucherID = ?`,
            [newPurchaseBalance, newStatus, originalPurchaseId]
          );
          
          console.log(`✅ Original Purchase Invoice updated:`, {
            voucherId: originalPurchaseId,
            newBalance: newPurchaseBalance,
            newStatus: newStatus
          });
        }

        // 8️⃣ COMMIT
        connection.commit((err) => {
          if (err) {
            console.log("COMMIT ERROR:", err);
            connection.rollback(() => {
              connection.release();
              return res.status(500).json({ success: false, message: "Commit failed" });
            });
            return;
          }
          
          connection.release();
          res.json({
            success: true,
            message: "Debit Note updated successfully",
            voucherId,
          });
        });
      } catch (err) {
        console.log("UPDATE ERROR:", err);
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ success: false, message: err.message });
        });
      }
    });
  });
});



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
          connection,
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        if (voucherResult.length === 0) {
          throw new Error("Transaction not found");
        }

        const voucherData = voucherResult[0];
        const transactionType = voucherData.TransactionType || "Sales";
        const invoiceNumber = voucherData.InvoiceNumber;

        // 2️⃣ Check if this is a CreditNote or DebitNote
        const isCreditNote = transactionType === "CreditNote";
        const isDebitNote = transactionType === "DebitNote";
        
        // 3️⃣ Get batch details from voucherdetails table
        const batchDetails = await queryPromise(
          connection,
          "SELECT * FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // -----------------------------------------------------------------------
        // 4️⃣ Reverse stock based on transaction type
        // -----------------------------------------------------------------------
        if (batchDetails.length > 0) {
          console.log(`Reversing STOCK for ${transactionType}`);

          const stockInTransactions = ["Purchase", "CreditNote", "stock inward"];
          const stockOutTransactions = ["Sales", "DebitNote", "stock transfer"];
          
          const isStockIn = stockInTransactions.includes(transactionType);
          const isStockOut = stockOutTransactions.includes(transactionType);

          if (!isStockIn && !isStockOut) {
            console.log(`⚠️ Unknown transaction type: ${transactionType}, skipping stock reversal`);
          } else {
            for (const item of batchDetails) {
              if (!item.product_id || !item.batch) continue;

              const batchResult = await queryPromise(
                connection,
                "SELECT id, quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
                [item.product_id, item.batch]
              );

              if (batchResult.length > 0) {
                const batch = batchResult[0];
                const qty = Number(item.quantity) || 0;

                let currentQuantity = Number(batch.quantity) || 0;
                let currentStockIn = Number(batch.stock_in) || 0;
                let currentStockOut = Number(batch.stock_out) || 0;

                let newQuantity = currentQuantity;
                let newStockIn = currentStockIn;
                let newStockOut = currentStockOut;

                if (isStockIn) {
                  // Reverse stock IN transaction: decrease stock_in and quantity
                  newStockIn = Math.max(0, currentStockIn - qty);
                  newQuantity = currentQuantity - qty;
                  
                  console.log(`Reversing ${transactionType}: Subtracting ${qty} from stock_in for batch ${item.batch}`);
                } else if (isStockOut) {
                  // Reverse stock OUT transaction: decrease stock_out and increase quantity
                  newStockOut = Math.max(0, currentStockOut - qty);
                  newQuantity = currentQuantity + qty;
                  
                  console.log(`Reversing ${transactionType}: Subtracting ${qty} from stock_out for batch ${item.batch}`);
                }

                // Ensure quantities don't go negative
                newQuantity = Math.max(0, newQuantity);
                newStockIn = Math.max(0, newStockIn);
                newStockOut = Math.max(0, newStockOut);

                await queryPromise(
                  connection,
                  "UPDATE batches SET quantity = ?, stock_in = ?, stock_out = ?, updated_at = NOW() WHERE id = ?",
                  [newQuantity, newStockIn, newStockOut, batch.id]
                );

                console.log(
                  `✔ ${transactionType} reversed batch ${item.batch}: ` +
                  `qty=${newQuantity}, stock_in=${newStockIn}, stock_out=${newStockOut}`
                );
              }
            }
          }
        }

        // -----------------------------------------------------------------------
        // 5️⃣ Handle order status reversal ONLY for Sales/stock transfer
        // -----------------------------------------------------------------------
        if ((transactionType === "Sales" || transactionType === "stock transfer") && voucherData.order_number) {
          console.log(`🔄 This was an invoice from order ${voucherData.order_number}. Reversing order status...`);
          
          try {
            await queryPromise(
              connection,
              `
              UPDATE order_items SET 
                invoice_number = NULL, 
                invoice_date = NULL, 
                invoice_status = 0,
                updated_at = NOW()
              WHERE order_number = ? AND invoice_number = ?
              `,
              [voucherData.order_number, voucherData.InvoiceNumber]
            );
            
            await queryPromise(
              connection,
              `
              UPDATE orders SET 
                order_status = 'Pending',
                invoice_number = NULL,
                invoice_date = NULL,
                invoice_status = 0,
                updated_at = NOW()
              WHERE order_number = ?
              `,
              [voucherData.order_number]
            );
            
            console.log(`✅ Order ${voucherData.order_number} status reverted to 'Pending'`);
          } catch (error) {
            console.error(`⚠️ Error reverting order status:`, error.message);
          }
        }

        // -----------------------------------------------------------------------
        // 6️⃣ Handle unpaid amount reversal ONLY for Sales/stock transfer/stock inward
        // -----------------------------------------------------------------------
        if ((transactionType === "Sales" || transactionType === "stock transfer" || transactionType === "stock inward") && voucherData.PartyID) {
          console.log(`💰 Reversing unpaid amount for PartyID: ${voucherData.PartyID}`);
          
          try {
            const tableCheck = await queryPromise(
              connection,
              "SHOW COLUMNS FROM accounts LIKE 'unpaid_amount'"
            );
            
            if (tableCheck.length > 0) {
              const currentAccount = await queryPromise(
                connection,
                "SELECT unpaid_amount, credit_limit FROM accounts WHERE id = ?",
                [voucherData.PartyID]
              );
              
              if (currentAccount.length > 0) {
                const currentUnpaid = parseFloat(currentAccount[0].unpaid_amount) || 0;
                const totalAmount = parseFloat(voucherData.TotalAmount) || 0;
                const newUnpaid = Math.max(0, currentUnpaid - totalAmount);
                
                const balanceCheck = await queryPromise(
                  connection,
                  "SHOW COLUMNS FROM accounts LIKE 'balance_amount'"
                );
                
                if (balanceCheck.length > 0 && currentAccount[0].credit_limit) {
                  const creditLimit = parseFloat(currentAccount[0].credit_limit) || 0;
                  const newBalanceAmount = creditLimit - newUnpaid;
                  
                  await queryPromise(
                    connection,
                    `
                    UPDATE accounts 
                    SET unpaid_amount = ?,
                        balance_amount = ?,
                        updated_at = NOW()
                    WHERE id = ?
                    `,
                    [newUnpaid, newBalanceAmount, voucherData.PartyID]
                  );
                } else {
                  await queryPromise(
                    connection,
                    `
                    UPDATE accounts 
                    SET unpaid_amount = ?,
                        updated_at = NOW()
                    WHERE id = ?
                    `,
                    [newUnpaid, voucherData.PartyID]
                  );
                }
                
                console.log(`✅ Unpaid amount reversed: ${totalAmount}, New unpaid: ${newUnpaid}`);
              }
            }
          } catch (error) {
            console.error(`⚠️ Error reversing unpaid amount:`, error.message);
          }
        }

        // -----------------------------------------------------------------------
        // 7️⃣ Delete ONLY this voucher's details, NOT all with same InvoiceNumber
        // -----------------------------------------------------------------------
        console.log(`Deleting voucherdetails for VoucherID: ${voucherId}`);
        await queryPromise(
          connection,
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // -----------------------------------------------------------------------
        // 8️⃣ Delete ONLY this voucher, NOT all with same InvoiceNumber
        // -----------------------------------------------------------------------
        console.log(`Deleting voucher with VoucherID: ${voucherId}`);
        await queryPromise(
          connection,
          "DELETE FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        // -----------------------------------------------------------------------
        // 9️⃣ Commit transaction
        // -----------------------------------------------------------------------
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

          console.log(`✔ Transaction ${voucherId} (${transactionType}) deleted successfully`);

          let message = "";
          if (isCreditNote) {
            message = "Credit Note deleted & stock reversed successfully";
          } else if (isDebitNote) {
            message = "Debit Note deleted & stock reversed successfully";
          } else if (transactionType === "stock inward") {
            message = "Stock inward transaction deleted & stock reversed";
          } else if (transactionType === "stock transfer") {
            message = "Stock transfer deleted & stock reversed";
          } else {
            message = `${transactionType} deleted & stock reversed successfully`;
          }

          res.send({
            success: true,
            message: message,
            voucherId,
            invoiceNumber,
            transactionType,
            stockReverted: batchDetails.length > 0,
            orderReverted: (transactionType === "Sales" || transactionType === "stock transfer") && voucherData.order_number ? true : false,
            unpaidReverted: (transactionType === "Sales" || transactionType === "stock transfer" || transactionType === "stock inward") && voucherData.PartyID ? true : false
          });
        });
      } catch (error) {
        console.error("❌ Error deleting transaction:", error);

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


// 19-11
// Get transaction by ID - Single API endpoint
router.get("/transactions/:id", (req, res) => {
  const voucherId = req.params.id;

  const query = `
    SELECT 
      v.*, 
      a.business_name,
      a.email,
      a.mobile_number,
      a.gstin,
      a.billing_address_line1,
      a.billing_address_line2,
      a.billing_city,
      a.billing_state,
      a.billing_country,
      a.billing_pin_code,
      a.shipping_address_line1,
      a.shipping_address_line2,
      a.shipping_city,
      a.shipping_state,
      a.shipping_country,
      a.shipping_pin_code
    FROM voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id
    WHERE v.VoucherID = ?
  `;

  db.query(query, [voucherId], (err, results) => {
    if (err) {
      console.error("Error fetching transaction:", err);
      return res.status(500).json({
        success: false,
        message: "Database error fetching transaction",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const transaction = results[0];

    // Fetch batch details
    const detailsQuery = `
      SELECT 
        product, 
        product_id, 
        batch, 
        quantity, 
        price, 
        unit_id,
          original_price, 
          inclusive_gst,
        discount, 
         hsn_code,
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

      // Combine all data
      const responseData = {
        ...transaction,
        batch_details: detailsResults || [],
        items: detailsResults || [] // Add items for compatibility
      };

      res.json({
        success: true,
        data: responseData,
      });
    });
  });
});


router.get("/transactions", (req, res) => {

  // Fetch vouchers + customer details - FILTERED to show only rows with empty/null order_number
  const voucherQuery = `
    SELECT 
      v.*,
      a.business_name,
      a.email,
      a.mobile_number,
      a.gstin,
      a.billing_address_line1,
      a.billing_address_line2,
      a.billing_city,
      a.billing_state,
      a.billing_country,
      a.billing_pin_code,
      a.shipping_address_line1,
      a.shipping_address_line2,
      a.shipping_city,
      a.shipping_state,
      a.shipping_country,
      a.shipping_pin_code
    FROM voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id
    WHERE v.order_number IS NULL 
      OR v.order_number = ''
    ORDER BY v.VoucherID DESC
  `;

  db.query(voucherQuery, (err, vouchers) => {
    if (err) {
      console.error("Error fetching vouchers:", err);
      return res.status(500).send(err);
    }

    // Fetch all voucherdetails (line items)
    const detailsQuery = `
      SELECT 
        vd.*,
        p.goods_name,
        p.unit
      FROM voucherdetails vd
      LEFT JOIN products p ON vd.product_id = p.id
    `;

    db.query(detailsQuery, (err, details) => {
      if (err) {
        console.error("Error fetching voucher details:", err);
        return res.status(500).send(err);
      }

      // Group details by voucher_id
      const detailsByVoucher = {};
      details.forEach(row => {
        if (!detailsByVoucher[row.voucher_id]) {
          detailsByVoucher[row.voucher_id] = [];
        }
        detailsByVoucher[row.voucher_id].push(row);
      });

      // Attach details to each voucher
      const finalResult = vouchers.map(v => {
        const vDetails = detailsByVoucher[v.VoucherID] || [];

        return {
          ...v,
          items: vDetails,
          totalItems: vDetails.length,
          totalQuantity: vDetails.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0),
          totalAmount: vDetails.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0)
        };
      });

      res.send(finalResult);
    });
  });
});




router.get('/invoices/:invoiceNumber', async (req, res) => {
  let connection;

  try {
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    // ✅ Decode the invoice number if it was encoded
    let { invoiceNumber } = req.params;
    invoiceNumber = decodeURIComponent(invoiceNumber);

    console.log('Searching for invoice:', invoiceNumber);

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
        v.additional_charges_type,
        additional_charges_amount,
        v.assigned_staff,
        v.BillSundryAmount,
        v.TotalAmount,
        v.ChequeNo,
        v.ChequeDate,
        v.BankName,
        v.AccountID,
        v.AccountName,
        v.business_name,
        v.PartyID,
        v.data_type ,
        a.name AS PartyName,
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
        v.pdf_created_at,
        v.transport_name,
        v.gr_rr_number,
        v.vehicle_number,
        v.station_name
      FROM voucher v
      LEFT JOIN accounts a ON v.PartyID = a.id
      WHERE v.InvoiceNumber = ?
      ORDER BY 
        CASE 
          WHEN v.TransactionType = 'Sales' THEN 1
          WHEN v.TransactionType = 'Receipt' THEN 2
          WHEN v.TransactionType = 'CreditNote' THEN 3
          WHEN v.TransactionType = 'purchase voucher' THEN 4
          WHEN v.TransactionType = 'Purchase' THEN 5
          WHEN v.TransactionType = 'stock transfer' THEN 5
          WHEN v.TransactionType = 'stock inward' THEN 6
          ELSE 6
        END,
        v.created_at ASC
    `;

    const vouchers = await new Promise((resolve, reject) => {
      connection.execute(query, [invoiceNumber], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    if (vouchers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    // Rest of your code remains the same...
    const voucherIDs = vouchers.map(v => v.VoucherID);

    const itemQuery = `
      SELECT 
        vd.*,
        p.goods_name,
        p.unit
      FROM voucherdetails vd
      LEFT JOIN products p ON p.id = vd.product_id
      WHERE vd.voucher_id IN (?)
    `;

    const items = await new Promise((resolve, reject) => {
      connection.query(itemQuery, [voucherIDs], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    const groupedItems = {};
    voucherIDs.forEach(id => groupedItems[id] = []);
    items.forEach(i => groupedItems[i.voucher_id].push(i));

    vouchers.forEach(v => {
      v.items = groupedItems[v.VoucherID] || [];
    });

    res.json({
      success: true,
      data: {
        sales: vouchers.find(v => v.TransactionType === "Sales") || null,
        receipts: vouchers.filter(v => v.TransactionType === "Receipt"),
        creditnotes: vouchers.filter(v => v.TransactionType === "CreditNote"),
        purchases: vouchers.filter(v => v.TransactionType === "Purchase"),
        purchasevoucher: vouchers.filter(v => v.TransactionType === "purchase voucher"),
        stocktransfer: vouchers.find(v => v.TransactionType === "stock transfer") || null,
        allEntries: vouchers
      }
    });

  } catch (err) {
    console.error("Error fetching invoice:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message
    });
  } finally {
    if (connection) connection.release();
  }
});


router.get("/last-invoice", (req, res) => {
  const query = "SELECT VchNo FROM voucher WHERE TransactionType IN ('Sales', 'stock transfer') ORDER BY VoucherID DESC LIMIT 1";

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

console.log("📋 Voucher document_type:", updateData.document_type);
console.log("📋 Items document_type:", updateData.batchDetails?.map(item => ({ 
  product: item.product, 
  document_type: item.document_type 
})));

// After updating voucher table
console.log("✅ Voucher document_type saved:", updateData.document_type);

// After inserting voucherdetails
console.log("✅ Items document_type saved:", updateData.batchDetails?.map(item => item.document_type));


  db.getConnection((err, connection) => {
    if (err) return res.status(500).send({ error: "Database connection failed" });

    connection.beginTransaction(async (err) => {
      if (err)
        return res.status(500).send({ error: "Transaction failed to start" });

      try {
        // 1️⃣ FETCH ORIGINAL VOUCHER
        const originalVoucher = await queryPromise(
          connection,
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        if (originalVoucher.length === 0)
          throw new Error("Transaction not found");

        const originalTransactionType =
          originalVoucher[0].TransactionType || "Sales";

        console.log("🔎 Original transaction:", originalTransactionType);

        // Fetch batch details from voucherdetails table
        let originalBatchDetails = [];
        try {
          const voucherDetails = await queryPromise(
            connection,
            "SELECT * FROM voucherdetails WHERE voucher_id = ?",
            [voucherId]
          );
          originalBatchDetails = voucherDetails.map(detail => ({
            product: detail.product,
            product_id: detail.product_id,
            batch: detail.batch,
            quantity: detail.quantity,
            price: detail.price,
            unit_id: detail.unit_id,
             original_price: detail.original_price,
            discount: detail.discount,
            gst: detail.gst,
            cgst: detail.cgst,
            sgst: detail.sgst,
            igst: detail.igst,
            cess: detail.cess,
            total: detail.total,
              hsn_code: detail.hsn_code ,
               inclusive_gst: detail.inclusive_gst  ,
                  document_type: detail.document_type 
          }));
        } catch {
          originalBatchDetails = [];
        }

        // -------------------------------------------------------------------
        // 2️⃣ REVERSE OLD STOCK (UNDO original stock effect)
        // -------------------------------------------------------------------
        for (const item of originalBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          console.log("♻️ Reversing:", originalTransactionType, item);

          const batchCheck = await queryPromise(
            connection,
            "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          if (batchCheck.length === 0) {
            console.warn(`⚠️ Batch ${item.batch} not found during reversal - creating it`);
            
            await queryPromise(
              connection,
              `INSERT INTO batches 
               (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
               VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
              [item.product_id, item.batch]
            );
            console.log(`✔ Created missing batch: ${item.batch}`);
          }

          const updatedBatchCheck = await queryPromise(
            connection,
            "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          const currentQuantity = parseFloat(updatedBatchCheck[0].quantity);
          const currentStockOut = parseFloat(updatedBatchCheck[0].stock_out);
          const currentStockIn = parseFloat(updatedBatchCheck[0].stock_in);
          const itemQuantity = parseFloat(item.quantity);

          const isStockInTransaction = originalTransactionType === "Purchase" || 
                                       originalTransactionType === "CreditNote" || 
                                       originalTransactionType === "stock inward";
          
          if (isStockInTransaction) {
            if (currentQuantity < itemQuantity) {
              console.warn(`⚠️ Insufficient stock for reversal in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}. Adjusting...`);
              
              const finalQuantity = Math.max(0, currentQuantity - itemQuantity);
              const finalStockIn = Math.max(0, currentStockIn - itemQuantity);
              
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [finalQuantity, finalStockIn, item.product_id, item.batch]
              );
            } else {
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = quantity - ?, stock_in = stock_in - ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [itemQuantity, itemQuantity, item.product_id, item.batch]
              );
            }
            console.log(`✔ Reversed ${originalTransactionType} for batch ${item.batch}`);
          } else {
            if (currentStockOut < itemQuantity) {
              console.warn(`⚠️ stock_out less than reversal quantity in batch ${item.batch}. Current: ${currentStockOut}, Required: ${item.quantity}. Adjusting...`);
              
              const finalStockOut = Math.max(0, currentStockOut - itemQuantity);
              
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = quantity + ?, stock_out = ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [itemQuantity, finalStockOut, item.product_id, item.batch]
              );
            } else {
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = quantity + ?, stock_out = stock_out - ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [itemQuantity, itemQuantity, item.product_id, item.batch]
              );
            }
            console.log(`✔ Reversed ${originalTransactionType} for batch ${item.batch}`);
          }
        }

        await queryPromise(
          connection,
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        let newBatchDetails = [];
        if (updateData.batchDetails) {
          newBatchDetails = Array.isArray(updateData.batchDetails)
            ? updateData.batchDetails
            : JSON.parse(updateData.batchDetails || "[]");
        }

        let vchNo = updateData.invoiceNumber || originalVoucher[0].VchNo;
        let invoiceNumber = updateData.invoiceNumber || originalVoucher[0].InvoiceNumber;
        
        // Get staff values - prioritize frontend data
        const staffIdToUpdate = updateData.selectedStaffId || 
                               updateData.staffid || 
                               originalVoucher[0].staffid;
        
        const assignedStaffToUpdate = updateData.assigned_staff || 
                                     originalVoucher[0].assigned_staff;
        
        // Get mobile number
        const mobileNumber = updateData.mobile_number || 
                            updateData.customer_mobile ||
                            updateData.supplierInfo?.mobile_number ||
                            updateData.supplierInfo?.phone_number ||
                            originalVoucher[0].retailer_mobile ||
                            0;

        // ✅ GET TRANSPORTATION VALUES
        const transportName = updateData.transportDetails?.transport || 
                             updateData.transport_name || 
                             originalVoucher[0].transport_name || null;
        
        const grRrNumber = updateData.transportDetails?.grNumber || 
                          updateData.gr_rr_number || 
                          originalVoucher[0].gr_rr_number || null;
        
        const vehicleNumber = updateData.transportDetails?.vehicleNo || 
                             updateData.vehicle_number || 
                             originalVoucher[0].vehicle_number || null;
        
        const stationName = updateData.transportDetails?.station || 
                           updateData.station_name || 
                           originalVoucher[0].station_name || null;

        console.log("📝 Updating with staff values:", {
          staffIdToUpdate,
          assignedStaffToUpdate,
          mobileNumber
        });

        console.log("🚛 Updating with transportation values:", {
          transportName,
          grRrNumber,
          vehicleNumber,
          stationName
        });

        // ✅ UPDATED UPDATE query with transportation fields
        await queryPromise(
          connection,
          `UPDATE voucher 
           SET VchNo = ?, 
               InvoiceNumber = ?, 
               Date = ?, 
               PartyID = ?,
               AccountID = ?,
               AccountName = ?,
               PartyName = ?, 
               business_name = ?,
               BasicAmount = ?, 
               TaxAmount = ?, 
               TotalAmount = ?,
               staffid = ?, 
               assigned_staff = ?,
               retailer_mobile = ?,
               transport_name = ?,
               gr_rr_number = ?,
               vehicle_number = ?,
               station_name = ?,
                 additional_charges_type = ?,
       additional_charges_amount = ?,
       discount_charges = ?,
discount_charges_amount = ?,
 round_off = ? ,
  document_type = ?  ,
  bb_bc = ?,
       L_I = ?,
        gstin = ? 
           WHERE VoucherID = ?`,
          [
            vchNo,
            invoiceNumber,
            updateData.invoiceDate || originalVoucher[0].Date,
            updateData.PartyID || updateData.selectedSupplierId || originalVoucher[0].PartyID,
            updateData.AccountID || updateData.supplierInfo?.accountId || originalVoucher[0].AccountID,
            updateData.AccountName || updateData.account_name || updateData.supplierInfo?.account_name || originalVoucher[0].AccountName,
            updateData.PartyName || updateData.supplierInfo?.name || originalVoucher[0].PartyName,
            updateData.business_name || updateData.supplierInfo?.business_name || originalVoucher[0].business_name,
            parseFloat(updateData.taxableAmount) || parseFloat(originalVoucher[0].BasicAmount),
            parseFloat(updateData.totalGST) || parseFloat(originalVoucher[0].TaxAmount),
            parseFloat(updateData.grandTotal) || parseFloat(originalVoucher[0].TotalAmount),
            staffIdToUpdate,       
            assignedStaffToUpdate, 
            mobileNumber,           
            transportName,          
            grRrNumber,           
            vehicleNumber,         
            stationName,   
            
      updateData.additional_charges_type || null,
parseFloat(updateData.additional_charges_amount) || 0,
updateData.discount_charges || "amount",
parseFloat(updateData.discount_charges_amount) || 0,
 parseFloat(updateData.roundOff) || 0,
 updateData.document_type || null,
  updateData.bb_bc || updateData.customerType || '',  
    updateData.L_I || '',  
     updateData.gstin || null,  
voucherId             
          ]
        );

        console.log("✅ Staff data updated in voucher:", {
          staffid: staffIdToUpdate,
          assigned_staff: assignedStaffToUpdate,
          retailer_mobile: mobileNumber
        });

        console.log("✅ Transportation data updated in voucher:", {
          transport_name: transportName,
          gr_rr_number: grRrNumber,
          vehicle_number: vehicleNumber,
          station_name: stationName
        });

        // -------------------------------------------------------------------
        // INSERT NEW voucherDetails
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          await queryPromise(
            connection,
            `INSERT INTO voucherdetails 
              (voucher_id, product, product_id,transaction_type, InvoiceNumber, batch,unit_id, quantity, price,original_price, discount, gst, cgst, sgst, igst, cess, total,hsn_code, inclusive_gst, document_type)
             VALUES (?, ?, ?, ?, ?, ?, ?,?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?,?, ?)`,
            [
              voucherId,
              item.product || "",
              item.product_id || "",
                 originalTransactionType,
              invoiceNumber,
              item.batch || "",
                item.unit_id || null,
              parseFloat(item.quantity) || 0,
              parseFloat(item.price) || 0,
             parseFloat(item.original_price) || 0, 
              parseFloat(item.discount) || 0,
              parseFloat(item.gst) || 0,
              parseFloat(item.cgst) || 0,
              parseFloat(item.sgst) || 0,
              parseFloat(item.igst) || 0,
              parseFloat(item.cess) || 0,
              parseFloat(item.total) || 0,
                item.hsn_code || null,
                  item.inclusive_gst || "",
                  item.document_type || null 
            ]
          );
        }

        // -------------------------------------------------------------------
        // 4️⃣ APPLY **NEW** STOCK CHANGES
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          const itemQuantity = parseFloat(item.quantity);

          const batchExists = await queryPromise(
            connection,
            "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          if (batchExists.length === 0) {
            console.log(`➕ Creating new batch: ${item.batch} for product ${item.product_id}`);
            await queryPromise(
              connection,
              `INSERT INTO batches 
               (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
               VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
              [item.product_id, item.batch]
            );
          }

          const currentBatch = await queryPromise(
            connection,
            "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          const currentQuantity = parseFloat(currentBatch[0].quantity);
          const isStockInTransaction = originalTransactionType === "Purchase" || 
                                       originalTransactionType === "CreditNote" || 
                                       originalTransactionType === "stock inward";
          
          if (isStockInTransaction) {
            await queryPromise(
              connection,
              "UPDATE batches SET quantity = quantity + ?, stock_in = stock_in + ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
              [itemQuantity, itemQuantity, item.product_id, item.batch]
            );
            console.log(`✔ ${originalTransactionType} applied - added stock to batch ${item.batch}`);
          } else {
            console.log(`⚠️ Allowing negative stock for batch ${item.batch}. Current: ${currentQuantity}, Deducting: ${itemQuantity}, New: ${currentQuantity - itemQuantity}`);
            await queryPromise(
              connection,
              "UPDATE batches SET quantity = quantity - ?, stock_out = stock_out + ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
              [itemQuantity, itemQuantity, item.product_id, item.batch]
            );
            console.log(`✔ ${originalTransactionType} applied - reduced stock from batch ${item.batch}`);
          }
        }

        // -------------------------------------------------------------------
        // COMMIT TRANSACTION
        // -------------------------------------------------------------------
        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({ error: commitErr.message });
            });
          }

          connection.release();
          res.json({
            success: true,
            message: "Transaction updated successfully",
            voucherId,
            staffid: staffIdToUpdate,
            assigned_staff: assignedStaffToUpdate,
            retailer_mobile: mobileNumber,
             round_off: parseFloat(updateData.roundOff) || 0,
            transportation: {
              transport_name: transportName,
              gr_rr_number: grRrNumber,
              vehicle_number: vehicleNumber,
              station_name: stationName
            },
            discount_charges: updateData.discount_charges || "amount",          // ← ADD
  discount_charges_amount: parseFloat(updateData.discount_charges_amount) || 0  // ← ADD
          });
        });
      } catch (err) {
        console.error("❌ Error:", err);
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ success: false, message: err.message });
        });
      }
    });
  });
});
router.get("/ledger", (req, res) => {
  // Fetch all vouchers ordered by PartyID and Date
  const query = `
    SELECT 
      VoucherID AS id,
      VchNo AS voucherID,
      Date AS date,
      TransactionType AS trantype,
      AccountID,
    
      AccountName,
      PartyID,
      order_mode,
      data_type,
      PartyName,
      paid_amount AS Pamount,
      TotalAmount AS Amount,
      DC,
      balance_amount,
      created_at
    FROM voucher
    WHERE PartyID IS NOT NULL
    ORDER BY PartyID, Date ASC, VoucherID ASC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching voucher data:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }

    console.log("Transaction types found:", [...new Set(results.map(r => r.trantype))]);
    
    const dataWithRecalculatedBalances = recalculateRunningBalances(results);

    res.status(200).json(dataWithRecalculatedBalances);
  });
});

function recalculateRunningBalances(transactions) {
  return transactions.sort((a, b) => {
    if (a.PartyID !== b.PartyID) {
      return a.PartyID - b.PartyID;
    }
    
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    if (dateA.getTime() !== dateB.getTime()) {
      return dateA.getTime() - dateB.getTime();
    }
    
    return a.id - b.id;
  });
}
router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  console.log('📦 ALL RECEIVED DATA:', transactionData);

  // Determine transaction type
  let transactionType = transactionData.TransactionType || "";
  const dataType = transactionData.data_type || null; 
  const normalizedType = transactionType.toLowerCase().trim();
  
  const orderNumber = transactionData.orderNumber || transactionData.order_number || null;
  
  if ((normalizedType === "stock transfer" || normalizedType === "stocktransfer") && orderNumber) {
    console.log("🔄 Stock Transfer detected with order number");
    transactionType = "stock transfer";
  } else if ((normalizedType === "stock transfer") && !orderNumber) {
    console.log("⚠️ Stock Transfer specified but no order number - Reverting to Sales");
    transactionType = "stock transfer";
  } else if (normalizedType === "stock inward") {
    console.log("📥 Stock Inward transaction detected");
    transactionType = "stock inward";
  }

  console.log("Processing as:", transactionType);
  console.log("Order Number:", orderNumber);

  db.getConnection((err, connection) => {
    if (err) {
      console.error("DB Connection Error:", err);
      return res.status(500).send({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error("Begin Transaction Error:", err);
        return res.status(500).send({ error: "Transaction failed" });
      }

      try {
        const result = await processTransaction(
          transactionData,
          transactionType,
          connection,
          dataType
        );

        const { voucherId, invoiceNumber, vchNo, batchDetails, grandTotal } = result;

        connection.commit(async (commitErr) => {
          if (commitErr) {
            console.error("Commit Error:", commitErr);
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({
                error: "Transaction commit failed",
                details: commitErr.message,
              });
            });
          }

          connection.release();

          // SMS sending logic (your existing code)
          try {
            const normalizedType = (transactionType || "")
              .toLowerCase()
              .trim()
              .replace(/\s+/g, " ");

            if (
              orderNumber &&
              (normalizedType === "Sales" || normalizedType === "stock transfer")
            ) {
              const mobile =
                transactionData.fullAccountDetails?.mobile_number || null;

              if (!mobile) {
                console.log(`No mobile number for order ${orderNumber}`);
                return;
              }

              const cleanMobile = mobile.toString().replace(/\D/g, "");

              if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
                console.log(`Invalid mobile number: ${cleanMobile}`);
                return;
              }

              const smsMessage =
`Your invoice ${invoiceNumber} for order #${orderNumber} is ready.
Total Amount: ${grandTotal} - SHREE SHASHWATRAJ AGRO PRIVATE LIMITED`;

              const smsResponse = await axios.get(
                "https://www.smsjust.com/blank/sms/user/urlsms.php",
                {
                  params: {
                    username: process.env.SMS_USERNAME,
                    pass: process.env.SMS_PASSWORD,
                    senderid: process.env.SMS_SENDERID,
                    dest_mobileno: cleanMobile,
                    message: smsMessage,
                    dltentityid: process.env.SMS_ENTITYID,
                    dlttempid: process.env.SMS_INVOICEREADYTEMPLATEID,
                    response: "y"
                  }
                }
              );

              console.log(`✅ SMS SENT to ${cleanMobile}`);
              console.log("SMSJust response:", smsResponse.data);
            }
          } catch (err) {
            console.error("❌ SMS failed (non-blocking):", err.message);
          }

          let message =
            transactionType === "CreditNote"
              ? "Credit Note created"
              : transactionType === "Purchase"
              ? "Purchase Transaction completed"
              : transactionType === "DebitNote"
              ? "Debit Note created"
              : transactionType === "stock transfer"
              ? "Stock Transfer completed"
              : transactionType === "stock inward"
              ? "Stock Inward completed"
              : "Sales Transaction completed";

          res.send({
            success: true,
            message,
            voucherId,
            invoiceNumber,
            vchNo,
            items: batchDetails,
          });
        });
      } catch (error) {
        console.error("Transaction Error:", error);

        connection.rollback(() => {
          connection.release();

          res.status(500).send({
            error: `${transactionType} transaction failed`,
            details: error.message,
          });
        });
      }
    });
  });
});

const processTransaction = async (transactionData, transactionType, connection, dataType) => {
  const maxIdResult = await queryPromise(
    connection,
    "SELECT COALESCE(MAX(VoucherID),0)+1 AS nextId FROM voucher"
  );
  const nextVoucherId = maxIdResult[0].nextId;

  const orderMode = (transactionData.order_mode || transactionData.orderMode || "").toUpperCase();
  const isKacha = orderMode === "KACHA";
  
  console.log(`📊 Order Mode from request: ${orderMode}, Is Kacha: ${isKacha}`);

  const staffIncentive = parseFloat(transactionData.staff_incentive) || 
                        parseFloat(transactionData.originalOrder?.staff_incentive) || 
                        0;
  
  console.log(`💰 Staff Incentive from request: ${staffIncentive}`);

  let items = [];

  let totalDiscount = 0;
  let totalCreditCharge = 0;

  if (Array.isArray(transactionData.items)) items = transactionData.items;
  else if (Array.isArray(transactionData.batch_details)) items = transactionData.batch_details;
  else if (Array.isArray(transactionData.batchDetails)) items = transactionData.batchDetails;
  else items = [];

  // Process items with FLASH OFFER SUPPORT
  items = items.map((i) => {
    const itemStaffIncentive = parseFloat(i.staff_incentive) || 0;
    
    // Get flash offer details from frontend
    const flashOffer = parseInt(i.flash_offer) || 0;
    const buyQuantity = parseFloat(i.buy_quantity) || 0;
    const getQuantity = parseFloat(i.get_quantity) || 0;
    
    const billingQuantity = parseFloat(i.quantity) || 1;
    
    const stockDeductionQuantity = i.stock_deduction_quantity || 
                                  (flashOffer === 1 ? buyQuantity + getQuantity : billingQuantity);
    
    const discountAmount = parseFloat(i.discount_amount) || 0;
    const creditCharge = parseFloat(i.credit_charge) || 0;
    
    totalDiscount += discountAmount;  
    totalCreditCharge += creditCharge;
const itemDocumentType = i.document_type || null;
    if (isKacha) {
      return {
        product: i.product || "",
        product_id: parseInt(i.product_id || i.productId) || null,
        batch: i.batch || i.batch_number || "DEFAULT",
        quantity: billingQuantity,
        stock_deduction_quantity: stockDeductionQuantity,
        price: parseFloat(i.price) || 0,
             original_price: parseFloat(i.original_price) || 0,  
        discount: parseFloat(i.discount) || 0,
        discount_amount: discountAmount,
        credit_charge: creditCharge,
        gst: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        total: parseFloat(i.total) || (billingQuantity * parseFloat(i.price)),
        mfg_date: i.mfg_date || null,
        staff_incentive: itemStaffIncentive,
        flash_offer: flashOffer,
        buy_quantity: buyQuantity,
        get_quantity: getQuantity,
        hsn_code: i.hsn_code || ""  ,
         inclusive_gst: i.inclusive_gst || null  ,
           unit_id: i.unit_id || null  ,
           document_type: itemDocumentType
      };
    } else {
      const gstPercentage = parseFloat(i.gst) || 0;
      const cgstPercentageFromFrontend = parseFloat(i.cgst) || 0;
      const sgstPercentageFromFrontend = parseFloat(i.sgst) || 0;
      
      const cgstToStore = cgstPercentageFromFrontend * billingQuantity;  
      const sgstToStore = sgstPercentageFromFrontend * billingQuantity;
      
      return {
        product: i.product || "",
        product_id: parseInt(i.product_id || i.productId) || null,
        batch: i.batch || i.batch_number || "DEFAULT",
        quantity: billingQuantity,
        stock_deduction_quantity: stockDeductionQuantity,
        price: parseFloat(i.price) || 0,
         original_price: parseFloat(i.original_price) || 0,  
        discount: parseFloat(i.discount) || 0,
        discount_amount: discountAmount,
        credit_charge: creditCharge,
        gst: gstPercentage,
        cgst: cgstToStore, 
        sgst: sgstToStore,  
        igst: parseFloat(i.igst) || 0,
        cess: parseFloat(i.cess) || 0,
        total: parseFloat(i.total) || (billingQuantity * parseFloat(i.price)),
        mfg_date: i.mfg_date || null,
        staff_incentive: itemStaffIncentive,
        flash_offer: flashOffer,
        buy_quantity: buyQuantity,
        get_quantity: getQuantity,
        hsn_code: i.hsn_code || ""  ,
         inclusive_gst: i.inclusive_gst || null,
         unit_id: i.unit_id || null,
          document_type: itemDocumentType
      };
    }
  });

  const orderNumber = transactionData.orderNumber || transactionData.order_number || null;
  console.log("🛒 Order Number from request:", orderNumber);

  const selectedItemIds = transactionData.selectedItemIds || transactionData.selected_item_ids || [];
  const hasItemSelection = selectedItemIds && selectedItemIds.length > 0;
  
  console.log("📋 Has item selection:", hasItemSelection ? `Yes (${selectedItemIds.length} items)` : "No");

  // For CreditNote, find the original invoice to calculate balance
  let originalInvoiceBalance = null;
  let originalInvoiceTotal = null;
  let originalInvoiceId = null;
  
  if (transactionType === "CreditNote" && transactionData.InvoiceNumber) {
    console.log(`🔍 Finding original invoice for CreditNote: ${transactionData.InvoiceNumber}`);
    
    const [originalInvoice] = await queryPromise(
      connection,
      `SELECT VoucherID, TotalAmount, balance_amount, status
       FROM voucher
       WHERE InvoiceNumber = ? 
         AND TransactionType IN ('Sales', 'Purchase', 'stock transfer', 'stock inward')
       ORDER BY VoucherID DESC
       LIMIT 1`,
      [transactionData.InvoiceNumber]
    );
    
    if (originalInvoice) {
      originalInvoiceId = originalInvoice.VoucherID;
      originalInvoiceTotal = parseFloat(originalInvoice.TotalAmount) || 0;
      originalInvoiceBalance = parseFloat(originalInvoice.balance_amount) || originalInvoiceTotal;
      
      console.log(`✅ Found original invoice:`, {
        voucherId: originalInvoiceId,
        totalAmount: originalInvoiceTotal,
        currentBalance: originalInvoiceBalance
      });
    }
  }

  // ADD THIS: For DebitNote, find the original purchase invoice
if (transactionType === "DebitNote" && transactionData.InvoiceNumber) {
  console.log(`🔍 Finding original purchase invoice for DebitNote: ${transactionData.InvoiceNumber}`);
  
  const [originalPurchase] = await queryPromise(
    connection,
    `SELECT VoucherID, TotalAmount, balance_amount, status
     FROM voucher
     WHERE InvoiceNumber = ? 
       AND TransactionType IN ('Purchase', 'stock inward')
     ORDER BY VoucherID DESC
     LIMIT 1`,
    [transactionData.InvoiceNumber]
  );
  
  if (originalPurchase) {
    originalPurchaseId = originalPurchase.VoucherID;
    originalPurchaseTotal = parseFloat(originalPurchase.TotalAmount) || 0;
    originalPurchaseBalance = parseFloat(originalPurchase.balance_amount) || originalPurchaseTotal;
    
    console.log(`✅ Found original purchase invoice:`, {
      voucherId: originalPurchaseId,
      totalAmount: originalPurchaseTotal,
      currentBalance: originalPurchaseBalance
    });
  }
}

  if (orderNumber && (transactionType === "Sales" || transactionType === "stock transfer")) {
    console.log("✅ This is an order conversion. Updating order items and order status...");
    
    const invoiceNumber = transactionData.InvoiceNumber || transactionData.invoiceNumber || `INV${Date.now()}`;
    const invoiceDate = transactionData.Date || new Date().toISOString().split('T')[0];
    
    try {
      // First, let's debug what we're receiving
      console.log("🔍 DEBUG - Received items for order update:", items);
      console.log("🔍 DEBUG - Selected Item IDs:", selectedItemIds);
      
      if (hasItemSelection && selectedItemIds.length > 0) {
        // Update invoice details for selected items
        const placeholders = selectedItemIds.map(() => '?').join(',');
        const updateParams = [invoiceNumber, invoiceDate, orderNumber, ...selectedItemIds];
        
        await queryPromise(
          connection,
          `
          UPDATE order_items SET 
            invoice_number = ?, 
            invoice_date = ?, 
            invoice_status = 1, 
            updated_at = NOW()
          WHERE order_number = ? 
            AND id IN (${placeholders})
          `,
          updateParams
        );
        
        console.log(`✅ Updated invoice details for ${selectedItemIds.length} items in order ${orderNumber}`);
        
        // Update product_id for all items (regardless of selection)
        for (const item of items) {
          console.log("🔍 Processing item for product_id update:", {
            product: item.product,
            product_id: item.product_id,
            hasProductId: !!item.product_id,
            originalItemId: item.originalItemId,
            hasOriginalItemId: !!item.originalItemId
          });
          
          if (item.product_id) {
            try {
              let updateResult;
              
              if (item.originalItemId) {
                // Method 1: Use originalItemId if available
                console.log(`📝 Using originalItemId: ${item.originalItemId} for ${item.product}`);
                updateResult = await queryPromise(
                  connection,
                  `
                  UPDATE order_items SET 
                    product_id = ?,
                    updated_at = NOW()
                  WHERE id = ? 
                    AND order_number = ?
                  `,
                  [item.product_id, item.originalItemId, orderNumber]
                );
              } else {
                // Method 2: Match by product name when originalItemId is not available
                console.log(`🔍 No originalItemId, matching by product name: ${item.product}`);
                
                // First, check if we need to update - find existing product_id
                const existingItem = await queryPromise(
                  connection,
                  `
                  SELECT id, product_id 
                  FROM order_items 
                  WHERE order_number = ? 
                    AND item_name LIKE ?
                  LIMIT 1
                  `,
                  [orderNumber, `%${item.product}%`]
                );
                
                if (existingItem.length > 0) {
                  const existingProductId = existingItem[0].product_id;
                  
                  // Only update if product_id is different or null/0
                  if (!existingProductId || existingProductId === 0 || existingProductId !== item.product_id) {
                    updateResult = await queryPromise(
                      connection,
                      `
                      UPDATE order_items SET 
                        product_id = ?,
                        updated_at = NOW()
                      WHERE id = ? 
                        AND order_number = ?
                      `,
                      [item.product_id, existingItem[0].id, orderNumber]
                    );
                    
                    console.log(`✅ Updated product_id for "${item.product}" from ${existingProductId} to ${item.product_id}`);
                  } else {
                    console.log(`ℹ️ Product_id already set to ${item.product_id} for "${item.product}"`);
                    continue;
                  }
                } else {
                  console.log(`⚠️ No matching item found in order for "${item.product}"`);
                  continue;
                }
              }
              
              if (updateResult) {
                console.log(`✅ Update result for ${item.product}: ${updateResult.affectedRows} rows affected`);
                
                if (updateResult.affectedRows === 0) {
                  console.log(`ℹ️ No rows updated for ${item.product}. May already have correct product_id.`);
                }
              }
              
            } catch (error) {
              console.error(`❌ Error updating product_id for ${item.product}:`, error.message);
              // Don't throw, continue with other items
            }
          } else {
            console.log(`⚠️ Skipping ${item.product} - no product_id provided`);
          }
        }
      } 
      
      // Update orders table WITH order_mode
      console.log(`🔄 Updating order status in orders table for: ${orderNumber}`);
      console.log(`   Order Mode being set: ${orderMode}`);
      
      // First check what columns exist in the orders table
      let updateOrdersQuery;
      let updateParams;
      
      try {
        // Try the full update including order_mode
        updateOrdersQuery = `
        UPDATE orders SET 
          order_status = 'Invoice',
          invoice_number = ?,
          invoice_date = ?,
          invoice_status = 1,
          order_mode = ?,
          updated_at = NOW()
        WHERE order_number = ?
        `;
        updateParams = [invoiceNumber, invoiceDate, orderMode, orderNumber];
        
        await queryPromise(connection, updateOrdersQuery, updateParams);
        
      } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR') {
          console.log(`ℹ️ Column error detected: ${error.message}`);
          
          if (error.message.includes('order_mode')) {
            console.log("ℹ️ 'order_mode' column not found in orders table, updating without it...");
            
            // Try without order_mode but with updated_at
            try {
              updateOrdersQuery = `
              UPDATE orders SET 
                order_status = 'Invoice',
                invoice_number = ?,
                invoice_date = ?,
                invoice_status = 1,
                updated_at = NOW()
              WHERE order_number = ?
              `;
              updateParams = [invoiceNumber, invoiceDate, orderNumber];
              
              await queryPromise(connection, updateOrdersQuery, updateParams);
              
            } catch (innerError) {
              if (innerError.code === 'ER_BAD_FIELD_ERROR' && innerError.message.includes('updated_at')) {
                console.log("ℹ️ 'updated_at' column not found either, updating basic columns only...");
                
                updateOrdersQuery = `
                UPDATE orders SET 
                  order_status = 'Invoice',
                  invoice_number = ?,
                  invoice_date = ?,
                  invoice_status = 1
                WHERE order_number = ?
                `;
                updateParams = [invoiceNumber, invoiceDate, orderNumber];
                
                await queryPromise(connection, updateOrdersQuery, updateParams);
              } else {
                throw innerError;
              }
            }
            
          } else if (error.message.includes('updated_at')) {
            console.log("ℹ️ 'updated_at' column not found, updating without it...");
            
            updateOrdersQuery = `
            UPDATE orders SET 
              order_status = 'Invoice',
              invoice_number = ?,
              invoice_date = ?,
              invoice_status = 1,
              order_mode = ?
            WHERE order_number = ?
            `;
            updateParams = [invoiceNumber, invoiceDate, orderMode, orderNumber];
            
            await queryPromise(connection, updateOrdersQuery, updateParams);
            
          } else if (error.message.includes('invoice_status')) {
            console.log("ℹ️ 'invoice_status' column not found in orders table, updating without it...");
            
            updateOrdersQuery = `
            UPDATE orders SET 
              order_status = 'Invoice',
              invoice_number = ?,
              invoice_date = ?,
              order_mode = ?,
              updated_at = NOW()
            WHERE order_number = ?
            `;
            updateParams = [invoiceNumber, invoiceDate, orderMode, orderNumber];
            
            await queryPromise(connection, updateOrdersQuery, updateParams);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
      
      console.log(`✅ Order ${orderNumber} status updated to 'Invoiced' in orders table with invoice ${invoiceNumber}`);
      console.log(`✅ Order mode set to: ${orderMode}`);
      
    } catch (error) {
      console.error(`❌ Error updating order ${orderNumber}:`, error.message);
      throw error;
    }
  }

  let voucherBatchNumber = null;
  
  if (items.length > 0 && items[0].batch) {
    voucherBatchNumber = items[0].batch;
    console.log(`✅ Using batch number for voucher table: ${voucherBatchNumber}`);
  }

  let invoiceNumber =
    transactionData.InvoiceNumber ||
    transactionData.invoiceNumber ||
    "INV001";

  let vchNo = invoiceNumber;

  if (transactionType === "CreditNote") {
    vchNo =
      transactionData.VchNo ||
      transactionData.vchNo ||
      transactionData.creditNoteNumber ||
      "CNOTE001";
  }

  if (transactionType === "DebitNote") {
    vchNo =
      transactionData.VchNo ||
      transactionData.vchNo ||
      transactionData.creditNoteNumber  ||
      "DNOTE001";
  }

  if (transactionType === "Purchase") {
    vchNo =
      transactionData.InvoiceNumber ||
      transactionData.invoiceNumber ||
      "PINV001";
  }

  if (transactionType === "stock transfer") {
    vchNo =
      transactionData.InvoiceNumber ||
      transactionData.invoiceNumber ||
      "ST001";
  }

  if (transactionType === "stock inward") {
    vchNo =
      transactionData.InvoiceNumber ||
      transactionData.invoiceNumber ||
      "SI001";
  }

  // TOTALS CALCULATION
  let taxableAmount, totalGST, grandTotal;
  
  if (isKacha) {
    console.log("🔴 KACHA Order Mode Detected - Calculating totals without GST");
    
    taxableAmount = parseFloat(transactionData.BasicAmount) ||
                   parseFloat(transactionData.taxableAmount) ||
                   parseFloat(transactionData.Subtotal) ||
                   items.reduce((sum, i) => sum + i.total, 0);
    
    totalGST = 0;
    grandTotal = taxableAmount + totalCreditCharge;
    
  } else {
    taxableAmount = parseFloat(transactionData.BasicAmount) ||
                    parseFloat(transactionData.taxableAmount) ||
                    parseFloat(transactionData.Subtotal) ||
                    items.reduce((sum, i) => sum + (i.quantity * i.price), 0);
    
    totalGST = parseFloat(transactionData.TaxAmount) ||
               parseFloat(transactionData.totalGST) ||
               items.reduce((sum, i) => {
                 const itemTotal = i.quantity * i.price;
                 const discountAmount = itemTotal * (i.discount / 100);
                 const amountAfterDiscount = itemTotal - discountAmount;
                 return sum + (amountAfterDiscount * (i.gst / 100));
               }, 0);
    
    grandTotal = parseFloat(transactionData.TotalAmount) ||
                 parseFloat(transactionData.grandTotal) ||
                 taxableAmount + totalGST + totalCreditCharge;
  }

  console.log(`💰 Totals - Taxable: ${taxableAmount}, GST: ${totalGST}, Grand Total: ${grandTotal}`);
  console.log(`💰 Staff Incentive: ${staffIncentive}`);

  // ACCOUNT / PARTY DETAILS
  const supplier = transactionData.supplierInfo || {};
  const customer = transactionData.customerData || {};

  let partyID =
    supplier.party_id ||
    customer.party_id ||
    transactionData.PartyID ||
    null;

  let accountID =
    supplier.account_id ||
    customer.account_id ||
    transactionData.AccountID ||
    null;

  const partyName =
    supplier.name ||
    supplier.business_name ||
    customer.business_name ||
    customer.name ||
    transactionData.PartyName ||
    "";

  const account_name = transactionData.account_name ||  
                     supplier.account_name ||          
                     customer.account_name ||          
                     transactionData.AccountName ||     
                     "";

  const business_name = transactionData.business_name || 
                       supplier.business_name ||         
                       customer.business_name ||        
                       transactionData.businessName ||  
                       "";

  let balanceAmount = 0;
 // Calculate balance_amount based on transaction type

if (transactionType === "Sales" || transactionType === "Purchase" || 
    transactionType === "stock transfer" || transactionType === "stock inward") {
  balanceAmount = grandTotal;
  console.log(`💰 New ${transactionType} - Setting balance_amount to TotalAmount: ${balanceAmount}`);
} 
else if (transactionType === "CreditNote") {
  if (originalInvoiceBalance !== null) {
    const newBalance = originalInvoiceBalance - grandTotal;
    balanceAmount = Math.max(0, newBalance);
    
    console.log(`💰 CreditNote - Calculating balance_amount:`, {
      originalInvoiceBalance: originalInvoiceBalance,
      creditNoteAmount: grandTotal,
      balanceAmount: balanceAmount
    });
  } else {
    balanceAmount = grandTotal;
  }
}
// ADD THIS: For DebitNote
else if (transactionType === "DebitNote") {
  if (originalPurchaseBalance !== null) {
    const newBalance = originalPurchaseBalance - grandTotal;
    balanceAmount = Math.max(0, newBalance);
    
    console.log(`💰 DebitNote - Calculating balance_amount:`, {
      originalPurchaseBalance: originalPurchaseBalance,
      debitNoteAmount: grandTotal,
      balanceAmount: balanceAmount
    });
  } else {
    balanceAmount = grandTotal;
  }
}
else {
  balanceAmount = parseFloat(transactionData.balance_amount) || 0;
}
  
// VOUCHER DATA with FLASH OFFER field
const voucherData = {
  VoucherID: nextVoucherId,
  TransactionType: transactionType,
  data_type: dataType,
  VchNo: vchNo,
  InvoiceNumber: invoiceNumber,
  order_number: orderNumber, 
  order_mode: orderMode,
  flash_offer: items.some(item => item.flash_offer === 1) ? 1 : 0,
  due_date: transactionData.due_date || null,
  document_type: transactionData.document_type || null, 
  Date: transactionData.Date || new Date().toISOString().split("T")[0],
  PaymentTerms: transactionData.PaymentTerms || "Immediate",
  Freight: parseFloat(transactionData.Freight) || 0,
  TotalPacks: items.length,
  TaxAmount: totalGST,
  Subtotal: taxableAmount,
  round_off: parseFloat(transactionData.roundOff) || 0,
  BillSundryAmount: parseFloat(transactionData.BillSundryAmount) || 0,
  TotalAmount: grandTotal,
  paid_amount: parseFloat(transactionData.paid_amount) || grandTotal,
  total_discount: totalDiscount,
  total_credit_charge: totalCreditCharge,
  AccountID: accountID,
  AccountName: account_name,      
  business_name: business_name,   
  PartyID: partyID,
    discount_charges: transactionData.discount_charges || null,
  discount_charges_amount: parseFloat(transactionData.discount_charges_amount) || 0,
    additional_charges_type: transactionData.additional_charges_type || null,
  additional_charges_amount: parseFloat(transactionData.additional_charges_amount) || 0,
 retailer_mobile: transactionData.customerInfo?.phone || 
                 transactionData.fullAccountDetails?.mobile_number || 
                            
                 transactionData.supplierInfo?.mobile_number ||       
                 transactionData.supplierInfo?.phone_number ||   0,
  PartyName: partyName,
  BasicAmount: taxableAmount,
  ValueOfGoods: taxableAmount,
  EntryDate: new Date(),
  SGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.SGSTPercentage) || 0),
  CGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.CGSTPercentage) || 0),
  IGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.IGSTPercentage) || (items[0]?.igst || 0)),
  SGSTAmount: isKacha ? 0 : (parseFloat(transactionData.SGSTAmount) || 0),
  CGSTAmount: isKacha ? 0 : (parseFloat(transactionData.CGSTAmount) || 0),
  // FIX: Use totalIGST from transactionData instead of items[0]?.igst
  IGSTAmount: isKacha ? 0 : (parseFloat(transactionData.totalIGST) || // Try totalIGST first
                           parseFloat(transactionData.IGSTAmount) || // Then try IGSTAmount
                           
                          
                           0),
  description_preview: transactionData.description_preview || 
                      (transactionData.description ? 
                       transactionData.description.substring(0, 200) : ''),
  note_preview: transactionData.note_preview || 
               (transactionData.note ? transactionData.note.substring(0, 200) : ''),
  TaxSystem: isKacha ? "KACHA_NO_GST" : (transactionData.TaxSystem || "GST"),
  product_id: items[0]?.product_id || null,
  batch_id: voucherBatchNumber,
  DC: transactionType === "CreditNote" ? "C" : "D",
  ChequeNo: transactionData.ChequeNo || "",
  ChequeDate: transactionData.ChequeDate || null,
  BankName: transactionData.BankName || "",
staffid: transactionData.supplierInfo?.staffid || transactionData.staffid || null,
assigned_staff: transactionData.supplierInfo?.assigned_staff || transactionData.assigned_staff || null,
  staff_incentive: staffIncentive,
  created_at: new Date(),
  balance_amount: balanceAmount,
  status: transactionData.status || "active",
  paid_date: transactionData.paid_date || null,
  pdf_data: transactionData.pdf_data || null,
  pdf_file_name: transactionData.pdf_file_name || null,
  pdf_created_at: transactionData.pdf_created_at || null,

              transport_name: transactionData.transportDetails?.transport || 
                  transactionData.transport_name || null,
  gr_rr_number: transactionData.transportDetails?.grNumber || 
                transactionData.gr_rr_number || null,
  vehicle_number: transactionData.transportDetails?.vehicleNo || 
                  transactionData.vehicle_number || null,
  station_name: transactionData.transportDetails?.station || 
                transactionData.station_name || null,
                bb_bc: transactionData.bb_bc || transactionData.customerType || '',
  L_I: transactionData.L_I || '',  
  gstin: transactionData.gstin || null
};

  console.log(`🔍 FINAL Voucher Data - TransactionType: ${transactionType}, balance_amount: ${voucherData.balance_amount}`);

  // INSERT VOUCHER
  await queryPromise(
    connection,
    "INSERT INTO voucher SET ?",
    [voucherData]
  );

  const insertDetailQuery = `
  INSERT INTO voucherdetails (
    voucher_id, product, product_id, transaction_type, InvoiceNumber,
    batch, quantity, get_quantity, unit_id, price, original_price, discount,
    gst, cgst, sgst, igst, cess, total, inclusive_gst, hsn_code,document_type, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?,?,?, NOW())
`;


  for (const i of items) {
    const itemGST = isKacha ? 0 : i.gst;
    const itemCGST = isKacha ? 0 : i.cgst;
    const itemSGST = isKacha ? 0 : i.sgst;
    const itemIGST = isKacha ? 0 : i.igst;
    const itemCess = isKacha ? 0 : i.cess;
    
    await queryPromise(connection, insertDetailQuery, [
      nextVoucherId,          
      i.product,             
      i.product_id,          
      transactionType,       
      invoiceNumber,        
      i.batch,               
      i.quantity,         
      i.get_quantity || 0,
      i.unit_id || null,   
      i.price,    
      i.original_price || 0,        
      i.discount,         
      itemGST,              
      itemCGST,             
      itemSGST,           
      itemIGST,           
      itemCess,             
      i.total,    
        i.inclusive_gst || null, 
         i.hsn_code || null,   
           i.document_type || null    
    ]);
  }

  for (const i of items) {
    if (transactionType === "Sales" || transactionType === "DebitNote" || transactionType === "stock transfer") {
      
      // USE stock_deduction_quantity for flash offers (buy+get), otherwise use quantity
      let remainingQuantity = i.stock_deduction_quantity || i.quantity;
      const flashOffer = i.flash_offer || 0;
      
      console.log(`🔄 Stock Deduction - Flash Offer: ${flashOffer === 1 ? 'Yes' : 'No'}`);
      console.log(`   Product: ${i.product} (ID: ${i.product_id})`);
      console.log(`   Billing Qty: ${i.quantity}, Stock Deduction Qty: ${remainingQuantity}`);
      if (flashOffer === 1) {
        console.log(`   Buy: ${i.buy_quantity}, Get: ${i.get_quantity}, Total: ${remainingQuantity}`);
      }
      
      const specificBatch = i.batch || i.batch_number || i.batchNumber;
      const shouldUseSpecificBatch = specificBatch && specificBatch !== "DEFAULT";
      const isFromOrder = orderNumber;
      
    if (shouldUseSpecificBatch) {
  console.log(`🔍 Deducting from specific batch: ${specificBatch} for product ${i.product_id}`);
  
  try {
    // First check if batch exists (don't check quantity)
    const batchExists = await queryPromise(
      connection,
      `
      SELECT batch_number, quantity 
      FROM batches 
      WHERE product_id = ? 
        AND batch_number = ?
      `,
      [i.product_id, specificBatch]
    );
    
    if (batchExists.length === 0) {
      // Batch doesn't exist - create it with negative quantity
      console.log(`⚠️ Batch ${specificBatch} not found. Creating with negative quantity...`);
      
      await queryPromise(
        connection,
        `
        INSERT INTO batches (product_id, batch_number, quantity, stock_out, created_at, updated_at)
        VALUES (?, ?, ?, ?, NOW(), NOW())
        `,
        [i.product_id, specificBatch, -remainingQuantity, remainingQuantity]
      );
      
      console.log(`✅ Created new batch ${specificBatch} with quantity -${remainingQuantity}`);
    } else {
      // Batch exists - update quantity (allow negative)
      const currentQty = batchExists[0].quantity;
      console.log(`📊 Current quantity for batch ${specificBatch}: ${currentQty}`);
      console.log(`➖ Deducting ${remainingQuantity} (will become ${currentQty - remainingQuantity})`);
      
      await queryPromise(
        connection,
        `
        UPDATE batches 
          SET quantity = quantity - ?, 
              stock_out = stock_out + ?, 
              updated_at = NOW()
        WHERE product_id = ? 
          AND batch_number = ?
        `,
        [remainingQuantity, remainingQuantity, i.product_id, specificBatch]
      );
    }
    
    console.log(`✅ Successfully deducted ${remainingQuantity} from batch ${specificBatch} (negative stock allowed)`);
    remainingQuantity = 0;
    
  } catch (error) {
    console.error(`❌ Error with specific batch ${specificBatch}:`, error.message);
    throw error;
  }
} else if (isFromOrder) {
        // Order-based sale - use FIFO with mfg_date
        console.log(`📦 Order-based sale - Using FIFO with MFG date for product ${i.product_id}`);
        
        const batches = await queryPromise(
          connection,
          `
          SELECT batch_number, quantity, mfg_date 
          FROM batches 
          WHERE product_id = ? 
            AND quantity > 0 
          ORDER BY mfg_date ASC
          `,
          [i.product_id]
        );
        
        console.log(`📊 Found ${batches.length} batches for product ${i.product_id}`);
        
        if (batches.length === 0) {
          throw new Error(`No stock available for product ID ${i.product_id}`);
        }
        
        for (const batch of batches) {
          if (remainingQuantity <= 0) break;
          
          const batchQtyAvailable = batch.quantity;
          const batchNumber = batch.batch_number;
          
          const deductQty = Math.min(remainingQuantity, batchQtyAvailable);
          
          if (deductQty > 0) {
            console.log(`➖ Deducting ${deductQty} from batch ${batchNumber} (MFG: ${batch.mfg_date})`);
            
            await queryPromise(
              connection,
              `
              UPDATE batches 
                SET quantity = quantity - ?, 
                    stock_out = stock_out + ?, 
                    updated_at = NOW()
              WHERE product_id = ? 
                AND batch_number = ? 
                AND quantity >= ?
              `,
              [deductQty, deductQty, i.product_id, batchNumber, deductQty]
            );
            
            remainingQuantity -= deductQty;
          }
        }
        
    } else {
  console.log(`🛍️ Regular sale for product ${i.product_id} - allowing negative stock`);
  
  const defaultBatch = "DEFAULT";
  
  const batchExists = await queryPromise(
    connection,
    `
    SELECT batch_number, quantity 
    FROM batches 
    WHERE product_id = ? 
      AND batch_number = ?
    `,
    [i.product_id, defaultBatch]
  );
  
  if (batchExists.length === 0) {
    // Create DEFAULT batch with negative quantity
    console.log(`⚠️ DEFAULT batch not found. Creating with negative quantity...`);
    
    await queryPromise(
      connection,
      `
      INSERT INTO batches (product_id, batch_number, quantity, stock_out, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
      `,
      [i.product_id, defaultBatch, -remainingQuantity, remainingQuantity]
    );
    
    console.log(`✅ Created DEFAULT batch with quantity -${remainingQuantity}`);
  } else {
    // Update DEFAULT batch (allow negative)
    const currentQty = batchExists[0].quantity;
    console.log(`📊 Current DEFAULT batch quantity: ${currentQty}`);
    console.log(`➖ Deducting ${remainingQuantity} (will become ${currentQty - remainingQuantity})`);
    
    await queryPromise(
      connection,
      `
      UPDATE batches 
        SET quantity = quantity - ?, 
            stock_out = stock_out + ?, 
            updated_at = NOW()
      WHERE product_id = ? 
        AND batch_number = ?
      `,
      [remainingQuantity, remainingQuantity, i.product_id, defaultBatch]
    );
  }
  
  console.log(`✅ Successfully deducted ${remainingQuantity} using DEFAULT batch (negative stock allowed)`);
  remainingQuantity = 0;
}
      
      if (remainingQuantity > 0) {
        throw new Error(`Insufficient stock for product ID ${i.product_id}. Required: ${i.stock_deduction_quantity || i.quantity}, Fulfilled: ${(i.stock_deduction_quantity || i.quantity) - remainingQuantity}, Shortage: ${remainingQuantity} units`);
      }
      
    } else if (transactionType === "Purchase" || transactionType === "CreditNote" || transactionType === "stock inward") {
      const purchaseQuantity = i.quantity;
      console.log(`➕ Adding ${purchaseQuantity} to product ${i.product_id}, batch: ${i.batch || i.batch_number} (Transaction: ${transactionType})`);
      
      const batchToUse = i.batch || i.batch_number || i.batchNumber || "DEFAULT";
      
      // First check if batch exists
      const batchCheck = await queryPromise(
        connection,
        `
        SELECT batch_number FROM batches 
        WHERE product_id = ? AND batch_number = ?
        `,
        [i.product_id, batchToUse]
      );
      
      if (batchCheck.length > 0) {
        // Update existing batch
        await queryPromise(
          connection,
          `
          UPDATE batches 
            SET quantity = quantity + ?, 
                stock_in = stock_in + ?, 
                updated_at = NOW()
          WHERE product_id = ? AND batch_number = ?
          `,
          [purchaseQuantity, purchaseQuantity, i.product_id, batchToUse]
        );
        console.log(`📝 Updated existing batch ${batchToUse}`);
      } else {
        // Insert new batch
        await queryPromise(
          connection,
          `
          INSERT INTO batches (product_id, batch_number, quantity, stock_in, mfg_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        `,
          [i.product_id, batchToUse, purchaseQuantity, purchaseQuantity, i.mfg_date]
        );
        console.log(`📝 Created new batch ${batchToUse}`);
      }
    }
  }

  if (transactionType === "CreditNote" && originalInvoiceId) {
    console.log(`🔄 Updating original invoice balance_amount after CreditNote`);
    
    const newOriginalBalance = Math.max(0, originalInvoiceBalance - grandTotal);
    
    let newStatus = "active";
    if (newOriginalBalance <= 0) {
      newStatus = "Paid";
    } else if (newOriginalBalance < originalInvoiceTotal) {
      newStatus = "Partial";
    }
    
    await queryPromise(
      connection,
      `UPDATE voucher 
       SET balance_amount = ?, 
           status = ?,
           updated_at = NOW()
       WHERE VoucherID = ?`,
      [newOriginalBalance, newStatus, originalInvoiceId]
    );
    
    console.log(`✅ Original invoice updated:`, {
      voucherId: originalInvoiceId,
      oldBalance: originalInvoiceBalance,
      creditNoteAmount: grandTotal,
      newBalance: newOriginalBalance,
      newStatus: newStatus
    });
  }


  if (transactionType === "DebitNote" && originalPurchaseId) {
  const newOriginalBalance = Math.max(0, originalPurchaseBalance - grandTotal);
  
  let newStatus = "active";
  if (newOriginalBalance <= 0) {
    newStatus = "Paid";
  } else if (newOriginalBalance < originalPurchaseTotal) {
    newStatus = "Partial";
  }
  
  await queryPromise(
    connection,
    `UPDATE voucher 
     SET balance_amount = ?, 
         status = ?,
         updated_at = NOW()
     WHERE VoucherID = ?`,
    [newOriginalBalance, newStatus, originalPurchaseId]
  );
  
  console.log(`✅ Original purchase invoice updated after DebitNote`);
}

  if ((transactionType === "Sales" || transactionType === "stock transfer" || transactionType === "stock inward") && partyID && orderNumber) {
    console.log(`💰 UNPAID AMOUNT UPDATE - ${transactionType} with order number detected`);
    console.log(`   PartyID: ${partyID}, TotalAmount: ${grandTotal}, Order Number: ${orderNumber}`);
    
    try {
      // Check if accounts table has unpaid_amount column
      const tableCheck = await queryPromise(
        connection,
        "SHOW COLUMNS FROM accounts LIKE 'unpaid_amount'"
      );
      
      if (tableCheck.length === 0) {
        console.warn("⚠️ 'unpaid_amount' column not found in accounts table.");
      } else {
        // First check if credit_limit column exists
        const creditLimitCheck = await queryPromise(
          connection,
          "SHOW COLUMNS FROM accounts LIKE 'credit_limit'"
        );
        
        // Get current account data including credit_limit
        let currentAccount;
        if (creditLimitCheck.length > 0) {
          currentAccount = await queryPromise(
            connection,
            "SELECT unpaid_amount, credit_limit FROM accounts WHERE id = ?",
            [partyID]
          );
        } else {
          currentAccount = await queryPromise(
            connection,
            "SELECT unpaid_amount FROM accounts WHERE id = ?",
            [partyID]
          );
        }
        
        if (currentAccount.length === 0) {
          console.warn(`⚠️ Account with id ${partyID} not found in accounts table.`);
        } else {
          const currentUnpaid = parseFloat(currentAccount[0].unpaid_amount) || 0;
          const newUnpaid = currentUnpaid + grandTotal;
          
          // Check if balance_amount column exists
          const balanceCheck = await queryPromise(
            connection,
            "SHOW COLUMNS FROM accounts LIKE 'balance_amount'"
          );
          
          let updateQuery, updateParams;
          
          if (balanceCheck.length > 0 && creditLimitCheck.length > 0) {
            // Both balance_amount and credit_limit columns exist
            const creditLimit = parseFloat(currentAccount[0].credit_limit) || 0;
            const newBalanceAmount = creditLimit - newUnpaid;
            
            updateQuery = `
            UPDATE accounts 
            SET unpaid_amount = ?,
                balance_amount = ?,
                updated_at = NOW()
            WHERE id = ?
            `;
            updateParams = [newUnpaid, newBalanceAmount, partyID];
            
            const oldBalanceAmount = creditLimit - currentUnpaid;
            console.log(`✅ BALANCE AMOUNT CALCULATED - Old: ${oldBalanceAmount}, New: ${newBalanceAmount}, Difference: -${grandTotal}`);
          } else if (balanceCheck.length > 0 && creditLimitCheck.length === 0) {
            // balance_amount exists but credit_limit doesn't - can't calculate balance
            console.warn("⚠️ 'balance_amount' column exists but 'credit_limit' column not found. Cannot calculate balance.");
            updateQuery = `
            UPDATE accounts 
            SET unpaid_amount = ?,
                updated_at = NOW()
            WHERE id = ?
            `;
            updateParams = [newUnpaid, partyID];
          } else {
            // balance_amount column doesn't exist, update only unpaid_amount
            updateQuery = `
            UPDATE accounts 
            SET unpaid_amount = ?,
                updated_at = NOW()
            WHERE id = ?
            `;
            updateParams = [newUnpaid, partyID];
            console.log("ℹ️ 'balance_amount' column not found. Only updating unpaid_amount.");
          }
          
          // Update the accounts table
          await queryPromise(connection, updateQuery, updateParams);
          
          console.log(`✅ UNPAID AMOUNT UPDATED IN ACCOUNTS TABLE`);
          console.log(`   PartyID: ${partyID}`);
          console.log(`   Previous Unpaid: ${currentUnpaid}`);
          console.log(`   Added Amount: ${grandTotal}`);
          console.log(`   New Unpaid: ${newUnpaid}`);
        }
      }
    } catch (error) {
      console.error(`❌ ERROR updating unpaid amount:`, error.message);
    }
  }

  return {
    voucherId: nextVoucherId,
    invoiceNumber,
    vchNo,
    batchDetails: items,
    taxableAmount,
    totalGST,
    totalDiscount,
    totalCreditCharge,
    grandTotal,
    staffIncentive: staffIncentive,
    orderNumber: orderNumber,
    orderMode: orderMode,
    isKacha: isKacha,
    updatedItemCount: hasItemSelection ? selectedItemIds.length : 'all',
    orderStatusUpdated: orderNumber ? true : false,
    transactionType: transactionType,
    hasFlashOffer: voucherData.flash_offer === 1
  };
};


router.get("/voucherdetail", async (req, res) => {
  try {
    const query = `
      SELECT 
        MIN(vd.id) AS id,
        vd.product,
        vd.product_id,
        vd.batch,
        v.Date,
        v.Subtotal,
        v.order_mode,
        v.PartyName AS retailer,  -- Renamed to retailer
        v.staffid,
        a.name AS assigned_staff,  -- Get staff name from accounts table
        a.address AS staff_address,
        SUM(vd.quantity) AS quantity,
        SUM(vd.price) AS price,
        SUM(vd.discount) AS discount,
        SUM(vd.gst) AS gst,
        SUM(vd.cgst) AS cgst,
        SUM(vd.sgst) AS sgst,
        SUM(vd.igst) AS igst,
        SUM(vd.cess) AS cess,
        SUM(vd.total) AS total,
        MIN(vd.created_at) AS created_at,
        MAX(vd.update_at) AS update_at,
        GROUP_CONCAT(DISTINCT v.InvoiceNumber SEPARATOR ', ') AS InvoiceNumber,
        GROUP_CONCAT(DISTINCT v.PartyName SEPARATOR ', ') AS PartyNames,
        GROUP_CONCAT(DISTINCT vd.voucher_id) AS voucher_ids,
        COUNT(*) AS transaction_count
      FROM voucherdetails vd
      
      LEFT JOIN voucher v 
        ON vd.voucher_id = v.VoucherID

      LEFT JOIN accounts a 
        ON v.staffid = a.id   -- staff → accounts match
        
      WHERE v.TransactionType = 'Sales'

      GROUP BY 
        vd.product_id, 
        vd.batch, 
        vd.product, 
        v.PartyName, 
        v.staffid, 
        a.name,
        a.address

      ORDER BY created_at DESC
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



router.get('/order/:order_number', async (req, res) => {
    try {
        const orderNumber = req.params.order_number;

        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }

        const query = `
            SELECT 
                VoucherID, TransactionType, VchNo, product_id, batch_id, 
                batch_number, InvoiceNumber, order_number, Date, PaymentTerms, 
                Freight, TotalPacks, TaxAmount, Subtotal, BillSundryAmount, 
                TotalAmount, ChequeNo, ChequeDate, BankName, AccountID, 
                AccountName, PartyID, PartyName, BasicAmount, ValueOfGoods, 
                EntryDate, SGSTPercentage, CGSTPercentage, IGSTPercentage, 
                SGSTAmount, CGSTAmount, IGSTAmount, TaxSystem, paid_amount, 
                created_at, balance_amount, status, paid_date, pdf_data, 
                DC, staffid, assigned_staff, pdf_file_name, pdf_created_at, 
                note_preview, description_preview, order_mode
            FROM voucher
            WHERE order_number = ?
            ORDER BY created_at DESC
        `;

        const results = await new Promise((resolve, reject) => {
            db.query(query, [orderNumber], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });

        if (!results || results.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No vouchers found for the given order number'
            });
        }

        res.status(200).json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (error) {
        console.error('Error fetching vouchers:', error.message);

        res.status(500).json({
            success: false,
            message: 'Server error while fetching vouchers',
            error: error.message
        });
    }
});



router.post('/orders/send-retailer-alert', async (req, res) => {
  const {
    order_number,
    retailer_mobile,
    retailer_id,
    customer_name,
    items_with_issues,
    message
  } = req.body;

  try {
    // 1. Update order status
    db.query(
      `UPDATE orders SET 
        modification_required = 1,
        modification_reason = 'Item out of stock',
        order_status = 'Modification Required',
        updated_at = NOW()
       WHERE order_number = ?`,
      [order_number],
      (error) => {
        if (error) console.error('Error updating order:', error);
      }
    );

    // 2. Update order items
    items_with_issues.forEach(item => {
      const stock_status = item.shortage > 0 ? 'INSUFFICIENT_STOCK' : 'OUT_OF_STOCK';
      
      db.query(
        `UPDATE order_items SET 
          stock_status = ?,
          admin_approval = 'pending_modification',
          updated_at = NOW()
         WHERE order_number = ? 
           AND product_id = ?`,
        [stock_status, order_number, item.product_id],
        (error) => {
          if (error) console.error('Error updating item:', error);
        }
      );
    });

  const notificationMessage = items_with_issues
  .map((item, index) =>
    `${index + 1}. ${item.item_name}\n` +
    `Ordered ${item.ordered_quantity}, Available ${item.available_quantity}, Shortage ${item.shortage} units`
  )
  .join('\n\n');


    // 4. Store notification with retailer_id
    db.query(
      `INSERT INTO notifications SET 
        user_type = 'RETAILER',
        retailer_mobile = ?,
        retailer_id = ?,
        order_number = ?,
        title = 'Order Modification Required',
        message = ?,
        created_at = NOW()`,
      [retailer_mobile, retailer_id, order_number, notificationMessage],
      (error, results) => {
        if (error) {
          console.error('Error creating notification:', error);
          return res.status(500).json({ 
            success: false, 
            error: 'Failed to create notification' 
          });
        }

        res.json({
          success: true,
          message: 'Alert sent to retailer successfully',
          notification_id: results.insertId
        });
      }
    );

  } catch (error) {
    console.error('Error sending retailer alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send alert to retailer'
    });
  }
});

// 4. Get notifications by retailer_id
router.get('/notifications/retailer-id/:retailer_id', async (req, res) => {
  const { retailer_id } = req.params;

  db.query(
    `SELECT * FROM notifications 
     WHERE retailer_id = ? 
       AND user_type = 'RETAILER'
       AND is_read = 0
     ORDER BY created_at DESC`,
    [retailer_id],
    (error, notifications) => {
      if (error) {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch notifications'
        });
      }

      res.json({
        success: true,
        notifications
      });
    }
  );
});


router.put('/notifications/mark-read-by-order', async (req, res) => {
  const { order_number, retailer_id } = req.body;

  try {
    await queryPromise(
      db,
      `UPDATE notifications SET is_read = 1 
       WHERE order_number = ? 
         AND retailer_id = ? 
         AND is_read = 0`,
      [order_number, retailer_id]
    );

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read'
    });
  }
});



router.get("/voucher-list", (req, res) => {
  const query = `
    SELECT 
      VoucherID,
      TransactionType,
      data_type,
      	InvoiceNumber,
      VchNo
    FROM voucher
    ORDER BY VoucherID DESC
  `;

  db.query(query, (err, result) => {
    if (err) {
      console.error("Error fetching voucher list:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json(result);
  });
});
router.get("/gstreport", (req, res) => {
  // Fetch only required fields from vouchers
  const voucherQuery = `
    SELECT 
      v.VoucherID,
      v.VchNo,
      v.Date,
      v.PartyName,
      v.gstin,
      v.bb_bc,
      v.Subtotal,
      v.SGSTAmount,
      v.CGSTAmount,
      v.IGSTAmount,
      v.TotalAmount,
      v.TransactionType
    FROM voucher v
    WHERE v.TransactionType = 'Sales'
    ORDER BY v.VoucherID DESC
  `;

  db.query(voucherQuery, (err, vouchers) => {
    if (err) {
      console.error("Error fetching vouchers:", err);
      return res.status(500).send(err);
    }

    // Fetch only required fields from voucher details
    const detailsQuery = `
      SELECT 
        vd.voucher_id,
        vd.hsn_code,
        vd.gst,
        vd.quantity,
        vd.total
      FROM voucherdetails vd
      WHERE vd.voucher_id IN (${vouchers.map(v => v.VoucherID).join(',') || 0})
    `;

    db.query(detailsQuery, (err, details) => {
      if (err) {
        console.error("Error fetching voucher details:", err);
        return res.status(500).send(err);
      }

      // Group details by voucher_id
      const detailsByVoucher = {};
      details.forEach(row => {
        if (!detailsByVoucher[row.voucher_id]) {
          detailsByVoucher[row.voucher_id] = [];
        }
        detailsByVoucher[row.voucher_id].push(row);
      });

      // Attach only required details to vouchers
      const finalResult = vouchers.map(v => ({
        VoucherID: v.VoucherID,
        VchNo: v.VchNo,
        Date: v.Date,
        PartyName: v.PartyName,
        gstin: v.gstin,
        bb_bc: v.bb_bc,
        Subtotal: v.Subtotal,
        SGSTAmount: v.SGSTAmount,
        CGSTAmount: v.CGSTAmount,
        IGSTAmount: v.IGSTAmount,
        TotalAmount: v.TotalAmount,
        TransactionType: v.TransactionType,
        items: (detailsByVoucher[v.VoucherID] || []).map(item => ({
          hsn_code: item.hsn_code,
          gst: item.gst,
          subtotal: item.subtotal,
          sgst_amount: item.sgst_amount,
          cgst_amount: item.cgst_amount,
          igst_amount: item.igst_amount,
          quantity: item.quantity,
          total: item.total
        }))
      }));

      res.send(finalResult);
    });
  });
});

router.delete("/clear-cart/:customerId", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({ success: false, message: "customerId is required" });
  }

  try {
    const [result] = await db.query(
      "DELETE FROM cart WHERE customer_id = ?",
      [customerId]
    );

    res.json({
      success: true,
      message: `Cart cleared successfully. ${result.affectedRows} item(s) removed.`,
      deletedCount: result.affectedRows
    });
  } catch (err) {
    console.error("Error clearing cart:", err);
    res.status(500).json({ success: false, message: "Failed to clear cart", error: err.message });
  }
});



router.get("/hsnreport", (req, res) => {
  const { fromDate, toDate } = req.query;

  let dateFilter = "";
  const params = [];

  if (fromDate && toDate) {
    dateFilter = "WHERE DATE(v.Date) BETWEEN ? AND ?";
    params.push(fromDate, toDate);
  } else if (fromDate) {
    dateFilter = "WHERE DATE(v.Date) >= ?";
    params.push(fromDate);
  } else if (toDate) {
    dateFilter = "WHERE DATE(v.Date) <= ?";
    params.push(toDate);
  }

  const voucherQuery = `
    SELECT 
      v.VoucherID,
      v.Date,
      v.TransactionType,
      v.TotalAmount,
      v.Subtotal,
      v.SGSTAmount,
      v.CGSTAmount,
      v.IGSTAmount
    FROM voucher v
    ${dateFilter}
    ORDER BY v.VoucherID DESC
  `;

  db.query(voucherQuery, params, (err, vouchers) => {
    if (err) return res.status(500).send(err);

    const detailsQuery = `
      SELECT 
        vd.voucher_id,
        vd.product_id,
        vd.quantity,
        vd.total,
        vd.gst,
        p.hsn_code,
        p.goods_name
      FROM voucherdetails vd
      LEFT JOIN products p ON vd.product_id = p.id
      WHERE vd.product_id IS NOT NULL
        AND p.hsn_code IS NOT NULL
    `;

    db.query(detailsQuery, (err, details) => {
      if (err) return res.status(500).send(err);

      // Group details by voucher_id
      const detailsMap = {};
      details.forEach((row) => {
        if (!detailsMap[row.voucher_id]) {
          detailsMap[row.voucher_id] = [];
        }
        detailsMap[row.voucher_id].push(row);
      });

      // Map vouchers with items, filter out empty ones
      const result = vouchers
        .map((v) => ({
          ...v,
          items: (detailsMap[v.VoucherID] || []).filter(
            (item) => item.product_id !== null && item.hsn_code !== null
          )
        }))
        .filter((v) => v.items.length > 0); // ✅ empty items vouchers remove

      res.send(result);
    });
  });
});
router.get("/Salesreportdetail/:id", (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT 
      v.VoucherID,
      v.TransactionType,
      v.VchNo,
      v.PartyName,
      v.Date,
      d.id,
      d.product AS product,
      d.product_id,
      d.price,
      d.quantity,
      (d.price * d.quantity) AS total
    FROM voucher v
    JOIN voucherdetails d 
      ON v.VoucherID = d.voucher_id
    WHERE v.TransactionType IN ('Sales', 'Purchase')
      AND d.product_id = ?  
    ORDER BY v.VoucherID DESC, d.id DESC
  `;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false });
    }

    res.json({
      success: true,
      data: result
    });
  });
});


router.post('/production/create', (req, res) => {
  const { voucherNo, invoiceDate, productionItems } = req.body;

  if (!productionItems || productionItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No production items to save'
    });
  }

  // Get connection
  db.getConnection((err, connection) => {
    if (err) {
      console.error('Connection error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }

    // Start transaction
    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ success: false, message: err.message });
      }

      let completedVouchers = 0;
      let voucherIds = [];

      // Create a separate voucher for each item (since each item has its own product_id, batch_id)
      productionItems.forEach((item, idx) => {
        const itemTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
        
        const voucherQuery = `
          INSERT INTO voucher (
            VchNo,
            Date,
            TransactionType,
            product_id,
            batch_id,
            batch_number,
            TotalAmount,
            TotalPacks,
            EntryDate
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const voucherValues = [
          `${voucherNo}`,        
          invoiceDate,                       // Date
          item.type,                         // TransactionType (Production/Consumption)
          item.itemId,                       // product_id
          item.batchId,                      // batch_id
          item.batchNo,                      // batch_number
          item.amount || itemTotal,          // TotalAmount
          1,                                 // TotalPacks (1 item per voucher)
          new Date()                         // EntryDate
        ];

        connection.query(voucherQuery, voucherValues, (err, result) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              console.error('Voucher insert error:', err);
              res.status(500).json({ success: false, message: err.message });
            });
          }

          const voucherId = result.insertId;
          voucherIds.push({ id: voucherId, item: item, idx: idx });

          completedVouchers++;

          // When all vouchers are inserted, process details
          if (completedVouchers === productionItems.length) {
            processDetails();
          }
        });
      });

      function processDetails() {
        let completedDetails = 0;

        productionItems.forEach((item, idx) => {
          const voucherInfo = voucherIds.find(v => v.idx === idx);
          
          if (!voucherInfo) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ success: false, message: `No voucher found for item: ${idx}` });
            });
          }

          // Insert into voucherdetails
          const detailsQuery = `
            INSERT INTO voucherdetails (
              voucher_id,
              product,
              product_id,
              batch,
              batch_id,
              quantity,
              price,
              transaction_type,
              total,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const itemTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);

          connection.query(
            detailsQuery,
            [
              voucherInfo.id,
              item.itemName,
              item.itemId,
              item.batchNo,
              item.batchId,
              item.qty,
              item.rate,
              item.type,
              item.amount || itemTotal,
              new Date()
            ],
            (err) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  console.error('Details insert error:', err);
                  res.status(500).json({ success: false, message: err.message });
                });
              }

              // Update stock in batches table
              let updateStockQuery = '';
              let updateValues = [];

              if (item.type === 'Production') {
                updateStockQuery = `
                  UPDATE batches 
                  SET 
                    stock_in = stock_in + ?,
                    quantity = quantity + ?
                  WHERE product_id = ? AND batch_number = ?
                `;
                updateValues = [item.qty, item.qty, item.itemId, item.batchNo];
              } 
              else if (item.type === 'Consumption') {
                updateStockQuery = `
                  UPDATE batches 
                  SET 
                    stock_out = stock_out + ?,
                    quantity = quantity - ?
                  WHERE product_id = ? AND batch_number = ?
                `;
                updateValues = [item.qty, item.qty, item.itemId, item.batchNo];
              }

              if (updateStockQuery && item.batchId) {
                connection.query(updateStockQuery, updateValues, (err, updateResult) => {
                  if (err) {
                    return connection.rollback(() => {
                      connection.release();
                      console.error('Stock update error:', err);
                      res.status(500).json({ success: false, message: 'Failed to update stock: ' + err.message });
                    });
                  }

                  completedDetails++;
                  finalizeTransaction();
                });
              } else {
                completedDetails++;
                finalizeTransaction();
              }

              function finalizeTransaction() {
                if (completedDetails === productionItems.length) {
                  connection.commit(err => {
                    if (err) {
                      return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ success: false, message: err.message });
                      });
                    }

                    connection.release();
                    res.status(201).json({
                      success: true,
                      message: 'Production saved successfully',
                      data: {
                        vouchersCreated: productionItems.length,
                        itemsCount: productionItems.length
                      }
                    });
                  });
                }
              }
            }
          );
        });
      }
    });
  });
});
// PUT API - Update production by ID
router.put('/production/update/:id', (req, res) => {
  const { id } = req.params;
  const { voucherNo, invoiceDate, productionItems } = req.body;

  if (!productionItems || productionItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No production items to save'
    });
  }

  // Get connection
  db.getConnection((err, connection) => {
    if (err) {
      console.error('Connection error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }

    // Start transaction
    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ success: false, message: err.message });
      }

      // First, get old items to revert stock changes
      const getOldItemsQuery = `
        SELECT vd.*, v.TransactionType, v.product_id, v.batch_id, v.batch_number
        FROM voucherdetails vd
        JOIN voucher v ON vd.voucher_id = v.VoucherID
        WHERE v.VoucherID = ?
      `;

      connection.query(getOldItemsQuery, [id], (err, oldItems) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            console.error('Error fetching old items:', err);
            res.status(500).json({ success: false, message: err.message });
          });
        }

        // Revert old stock changes
        let revertCompleted = 0;
        
        if (oldItems.length > 0) {
          oldItems.forEach((oldItem) => {
            let revertQuery = '';
            let revertValues = [];

            if (oldItem.transaction_type === 'Production') {
              // Reverse Production: Subtract from stock
              revertQuery = `
                UPDATE batches 
                SET 
                  stock_in = stock_in - ?,
                  quantity = quantity - ?
                WHERE product_id = ? AND batch_number = ?
              `;
              revertValues = [oldItem.quantity, oldItem.quantity, oldItem.product_id, oldItem.batch_number];
            } 
            else if (oldItem.transaction_type === 'Consumption') {
              // Reverse Consumption: Add back to stock
              revertQuery = `
                UPDATE batches 
                SET 
                  stock_out = stock_out - ?,
                  quantity = quantity + ?
                WHERE product_id = ? AND batch_number = ?
              `;
              revertValues = [oldItem.quantity, oldItem.quantity, oldItem.product_id, oldItem.batch_number];
            }

            if (revertQuery && oldItem.batch_id) {
              connection.query(revertQuery, revertValues, (err) => {
                if (err) {
                  return connection.rollback(() => {
                    connection.release();
                    console.error('Error reverting stock:', err);
                    res.status(500).json({ success: false, message: err.message });
                  });
                }
                revertCompleted++;
                proceedWithUpdate();
              });
            } else {
              revertCompleted++;
              proceedWithUpdate();
            }
          });
        } else {
          proceedWithUpdate();
        }

        function proceedWithUpdate() {
          if (revertCompleted !== oldItems.length && oldItems.length > 0) {
            return;
          }

          // Delete old voucher details
          const deleteDetailsQuery = `DELETE FROM voucherdetails WHERE voucher_id = ?`;
          connection.query(deleteDetailsQuery, [id], (err) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                console.error('Error deleting old details:', err);
                res.status(500).json({ success: false, message: err.message });
              });
            }

            // Update voucher main record
            const updateVoucherQuery = `
              UPDATE voucher 
              SET 
                VchNo = ?,
                Date = ?,
                TotalAmount = ?,
                TotalPacks = ?
              WHERE VoucherID = ?
            `;

            // Calculate new totals
            let totalAmount = 0;
            productionItems.forEach(item => {
              const itemTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
              totalAmount += (item.amount || itemTotal);
            });

            connection.query(updateVoucherQuery, [
              voucherNo,
              invoiceDate,
              totalAmount,
              productionItems.length,
              id
            ], (err) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  console.error('Error updating voucher:', err);
                  res.status(500).json({ success: false, message: err.message });
                });
              }

              // Insert new voucher details and update stock
              let completedDetails = 0;
              const newVoucherIds = [];

              productionItems.forEach((item, idx) => {
                const itemTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);

                // Insert new details
                const detailsQuery = `
                  INSERT INTO voucherdetails (
                    voucher_id,
                    product,
                    product_id,
                    batch,
                    batch_id,
                    quantity,
                    price,
                    transaction_type,
                    total,
                    created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                connection.query(detailsQuery, [
                  id,
                  item.itemName,
                  item.itemId,
                  item.batchNo,
                  item.batchId,
                  item.qty,
                  item.rate,
                  item.type,
                  item.amount || itemTotal,
                  new Date()
                ], (err, result) => {
                  if (err) {
                    return connection.rollback(() => {
                      connection.release();
                      console.error('Error inserting details:', err);
                      res.status(500).json({ success: false, message: err.message });
                    });
                  }

                  newVoucherIds.push(result.insertId);

                  // Update stock with new values
                  let stockQuery = '';
                  let stockValues = [];

                  if (item.type === 'Production') {
                    stockQuery = `
                      UPDATE batches 
                      SET 
                        stock_in = stock_in + ?,
                        quantity = quantity + ?
                      WHERE product_id = ? AND batch_number = ?
                    `;
                    stockValues = [item.qty, item.qty, item.itemId, item.batchNo];
                  } 
                  else if (item.type === 'Consumption') {
                    stockQuery = `
                      UPDATE batches 
                      SET 
                        stock_out = stock_out + ?,
                        quantity = quantity - ?
                      WHERE product_id = ? AND batch_number = ?
                    `;
                    stockValues = [item.qty, item.qty, item.itemId, item.batchNo];
                  }

                  if (stockQuery && item.batchId) {
                    connection.query(stockQuery, stockValues, (err) => {
                      if (err) {
                        return connection.rollback(() => {
                          connection.release();
                          console.error('Error updating stock:', err);
                          res.status(500).json({ success: false, message: err.message });
                        });
                      }
                      completedDetails++;
                      finalizeUpdate();
                    });
                  } else {
                    completedDetails++;
                    finalizeUpdate();
                  }

                  function finalizeUpdate() {
                    if (completedDetails === productionItems.length) {
                      connection.commit(err => {
                        if (err) {
                          return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ success: false, message: err.message });
                          });
                        }

                        connection.release();
                        res.status(200).json({
                          success: true,
                          message: 'Production updated successfully',
                          data: {
                            voucherId: id,
                            itemsCount: productionItems.length
                          }
                        });
                      });
                    }
                  }
                });
              });
            });
          });
        }
      });
    });
  });
});

// DELETE API - Delete production by ID
router.delete('/production/delete/:id', (req, res) => {
  const { id } = req.params;

  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }

    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ success: false, message: err.message });
      }

      // Get items to revert stock
      connection.query(`
        SELECT vd.*, v.product_id, v.batch_id, v.batch_number
        FROM voucherdetails vd
        JOIN voucher v ON vd.voucher_id = v.VoucherID
        WHERE v.VoucherID = ?
      `, [id], (err, items) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ success: false, message: err.message });
          });
        }

        if (items.length === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ success: false, message: 'Record not found' });
          });
        }

        let completed = 0;

        // Revert stock based on transaction type
        items.forEach(item => {
          let query = '';
          let values = [];

          if (item.transaction_type === 'Production') {
            // Production: Subtract from stock_in and quantity
            query = `UPDATE batches SET stock_in = stock_in - ?, quantity = quantity - ? WHERE product_id = ? AND batch_number = ?`;
            values = [item.quantity, item.quantity, item.product_id, item.batch_number];
          } 
          else if (item.transaction_type === 'Consumption') {
            // Consumption: Subtract from stock_out and add back to quantity
            query = `UPDATE batches SET stock_out = stock_out - ?, quantity = quantity + ? WHERE product_id = ? AND batch_number = ?`;
            values = [item.quantity, item.quantity, item.product_id, item.batch_number];
          }

          if (query) {
            connection.query(query, values, (err) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({ success: false, message: err.message });
                });
              }
              
              completed++;
              if (completed === items.length) {
                // Delete voucher details
                connection.query('DELETE FROM voucherdetails WHERE voucher_id = ?', [id], (err) => {
                  if (err) {
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({ success: false, message: err.message });
                    });
                  }
                  
                  // Delete voucher
                  connection.query('DELETE FROM voucher WHERE VoucherID = ?', [id], (err) => {
                    if (err) {
                      return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ success: false, message: err.message });
                      });
                    }
                    
                    // Commit transaction
                    connection.commit((err) => {
                      if (err) {
                        return connection.rollback(() => {
                          connection.release();
                          res.status(500).json({ success: false, message: err.message });
                        });
                      }
                      
                      connection.release();
                      res.status(200).json({ 
                        success: true, 
                        message: 'Deleted successfully' 
                      });
                    });
                  });
                });
              }
            });
          } else {
            completed++;
            if (completed === items.length) {
              connection.query('DELETE FROM voucherdetails WHERE voucher_id = ?', [id], (err) => {
                if (err) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ success: false, message: err.message });
                  });
                }
                
                connection.query('DELETE FROM voucher WHERE VoucherID = ?', [id], (err) => {
                  if (err) {
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({ success: false, message: err.message });
                    });
                  }
                  
                  connection.commit((err) => {
                    if (err) {
                      return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ success: false, message: err.message });
                      });
                    }
                    
                    connection.release();
                    res.status(200).json({ 
                      success: true, 
                      message: 'Deleted successfully' 
                    });
                  });
                });
              });
            }
          }
        });
      });
    });
  });
});


// GET API - Fetch last voucher number for Production
router.get('/production/last-voucher', (req, res) => {
  const query = `
    SELECT VchNo 
    FROM voucher 
    WHERE TransactionType = 'Production' 
      AND VchNo LIKE 'COS-%'
    ORDER BY VoucherID DESC 
    LIMIT 1
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching last voucher:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch last voucher',
        error: err.message
      });
    }

    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        voucherNo: null,
        nextVoucherNo: 'PROD-001'
      });
    }

    const lastVoucherNo = results[0].VchNo;
    const match = lastVoucherNo.match(/PROD-(\d+)/);
    let nextNumber = 1;
    
    if (match) {
      nextNumber = parseInt(match[1]) + 1;
    }
    
    const nextVoucherNo = `PROD-${String(nextNumber).padStart(3, '0')}`;
    
    res.status(200).json({
      success: true,
      voucherNo: lastVoucherNo,
      nextVoucherNo: nextVoucherNo
    });
  });
});

router.get('/production/list', (req, res) => {
  const query = `
    SELECT 
      v.VoucherID,
      v.VchNo,
      v.Date,
      v.TransactionType,
      v.product_id,
      v.batch_id,
      v.batch_number,
      v.TotalAmount,
      v.TotalPacks,
      v.EntryDate,
      vd.id as detail_id,
      vd.product,
      vd.quantity,
      vd.price,
      vd.total,
      vd.created_at as detail_created_at
    FROM voucher v
    LEFT JOIN voucherdetails vd ON v.VoucherID = vd.voucher_id
    WHERE v.TransactionType IN ('Production', 'Consumption')
    ORDER BY v.EntryDate DESC, v.VoucherID DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching production records:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch production records',
        error: err.message
      });
    }

    // Group results by voucher
    const groupedResults = {};
    
    results.forEach(row => {
      if (!groupedResults[row.VoucherID]) {
        groupedResults[row.VoucherID] = {
          VoucherID: row.VoucherID,
          VchNo: row.VchNo,
          Date: row.Date,
          TransactionType: row.TransactionType,
          product_id: row.product_id,
          batch_id: row.batch_id,
          batch_number: row.batch_number,
          TotalAmount: row.TotalAmount,
          TotalPacks: row.TotalPacks,
          EntryDate: row.EntryDate,
          items: []
        };
      }
      
      if (row.detail_id) {
        groupedResults[row.VoucherID].items.push({
          id: row.detail_id,
          product: row.product,
          quantity: row.quantity,
          price: row.price,
          total: row.total,
          created_at: row.detail_created_at
        });
      }
    });

    res.status(200).json({
      success: true,
      data: Object.values(groupedResults)
    });
  });
});

// GET API - Fetch single production by ID
router.get('/production/:id', (req, res) => {
  const { id } = req.params;
  
  const voucherQuery = `
    SELECT 
      VoucherID,
      VchNo,
      Date,
      TransactionType,
      product_id,
      batch_id,
      batch_number,
      TotalAmount,
      TotalPacks,
      EntryDate
    FROM voucher
    WHERE VoucherID = ? AND TransactionType IN ('Production', 'Consumption')
  `;

  db.query(voucherQuery, [id], (err, voucherResult) => {
    if (err) {
      console.error('Error fetching production:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch production record',
        error: err.message
      });
    }

    if (voucherResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Production record not found'
      });
    }

    const detailsQuery = `
      SELECT 
        id,
        product,
        product_id,
        batch,
        batch_id,
        quantity,
        price,
        transaction_type,
        total,
        created_at
      FROM voucherdetails
      WHERE voucher_id = ?
      ORDER BY id ASC
    `;

    db.query(detailsQuery, [id], (err, detailsResult) => {
      if (err) {
        console.error('Error fetching production details:', err);
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch production details',
          error: err.message
        });
      }

      res.status(200).json({
        success: true,
        data: {
          ...voucherResult[0],
          items: detailsResult
        }
      });
    });
  });
});




router.put("/update-account-balance/:id", (req, res) => {
  const party_id = req.params.id;
  const { balance, balance_type } = req.body;

  console.log("Updating:", party_id, balance, balance_type); // ✅ add this to verify

  const query = `UPDATE accounts SET balance = ?, balance_type = ? WHERE id = ?`;
  db.query(query, [balance, balance_type, party_id], (err, result) => {
    if (err) return res.status(500).json({ message: "Database error" });
    res.json({ message: "Balance updated successfully" });
  });
});
module.exports = router;

