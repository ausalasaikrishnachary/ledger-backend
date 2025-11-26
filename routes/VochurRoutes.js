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
function queryPromise(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

// ----------------------------------------------------------------------
// PUT /creditnoteupdate/:id
// ----------------------------------------------------------------------
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

          // Credit Note = stock IN (reverse stock OUT of sales)
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
        
        if (invoiceNumber) {
          // Find the original Sales voucher for this invoice
          const salesVoucherRows = await queryPromise(
            connection,
            "SELECT * FROM voucher WHERE InvoiceNumber = ? AND TransactionType = 'Sales'",
            [invoiceNumber]
          );

          if (salesVoucherRows.length > 0) {
            const salesVoucherId = salesVoucherRows[0].VoucherID;
            
            // Get all sales details for this invoice
            const salesDetails = await queryPromise(
              connection,
              "SELECT * FROM voucherdetails WHERE voucher_id = ?",
              [salesVoucherId]
            );

            // Create a map of product_id+batch to sales quantity
            const salesQuantityMap = new Map();
            for (const salesItem of salesDetails) {
              const key = `${salesItem.product_id}_${salesItem.batch}`;
              salesQuantityMap.set(key, Number(salesItem.quantity) || 0);
            }

            // Validate each credit note item
            for (const creditNoteItem of newBatchDetails) {
              const key = `${creditNoteItem.product_id}_${creditNoteItem.batch}`;
              const salesQuantity = salesQuantityMap.get(key) || 0;
              const creditNoteQuantity = Number(creditNoteItem.quantity) || 0;

              if (creditNoteQuantity > salesQuantity) {
                // 🔴 IMPORTANT: Rollback transaction before sending response
                connection.rollback(() => {
                  connection.release();
                  return res.status(400).json({ 
                    success: false, 
                    message: `Quantity exceeds sales quantity! Product: ${creditNoteItem.product}, Batch: ${creditNoteItem.batch}. Sales Quantity: ${salesQuantity}, Credit Note Quantity: ${creditNoteQuantity}`
                  });
                });
                return; // Stop execution
              }
            }
          } else {
            // 🔴 Rollback and send error for no sales voucher found
            connection.rollback(() => {
              connection.release();
              return res.status(400).json({ 
                success: false, 
                message: `No Sales voucher found for Invoice Number: ${invoiceNumber}`
              });
            });
            return; // Stop execution
          }
        }

        // 5️⃣ UPDATE voucher TABLE (ONLY REAL FIELDS)
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
            paid_amount = ?
          WHERE VoucherID = ?`,
          [
            updateData.VchNo || updateData.creditNoteNumber || originalVoucher.VchNo,
            updateData.Date || originalVoucher.Date,
            updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
            updateData.PartyName || originalVoucher.PartyName,

            Number(updateData.BasicAmount) || originalVoucher.BasicAmount,
            Number(updateData.TaxAmount) || originalVoucher.TaxAmount,
            Number(updateData.TotalAmount) || originalVoucher.TotalAmount,

            // Subtotal = BasicAmount
            Number(updateData.BasicAmount) || originalVoucher.Subtotal,

            Number(updateData.SGSTAmount) || 0,
            Number(updateData.CGSTAmount) || 0,
            Number(updateData.IGSTAmount) || 0,

            Number(updateData.SGSTPercentage) || 0,
            Number(updateData.CGSTPercentage) || 0,
            Number(updateData.IGSTPercentage) || 0,

            Number(updateData.TotalAmount) || originalVoucher.paid_amount,

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

        // 7️⃣ UPDATE NEW STOCK (CREDIT NOTE = STOCK IN)
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













// router.put("/creditnoteupdate/:id", async (req, res) => {
//   const voucherId = req.params.id;
//   const updateData = req.body;

//   console.log("UPDATE RECEIVED => ", voucherId, updateData);

//   db.getConnection((err, connection) => {
//     if (err)
//       return res.status(500).send({ error: "Database connection failed" });

//     connection.beginTransaction(async (err) => {
//       if (err)
//         return res.status(500).send({ error: "Transaction could not start" });

//       try {
//         // 1️⃣ Fetch ORIGINAL VOUCHER
//         const originalVoucherRows = await queryPromise(
//           connection,
//           "SELECT * FROM voucher WHERE VoucherID = ?",
//           [voucherId]
//         );

//         if (originalVoucherRows.length === 0)
//           throw new Error("Voucher not found");

//         const originalVoucher = originalVoucherRows[0];
//         const transactionType =
//           updateData.transactionType ||
//           originalVoucher.TransactionType ||
//           "CreditNote";

//         // 2️⃣ FETCH OLD VOUCHERDETAILS (to reverse stock)
//         const oldDetails = await queryPromise(
//           connection,
//           "SELECT * FROM voucherdetails WHERE voucher_id = ?",
//           [voucherId]
//         );

//         // Reverse OLD STOCK
//         for (const item of oldDetails) {
//           const batchRows = await queryPromise(
//             connection,
//             "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch]
//           );

//           if (!batchRows[0]) continue;
//           const batch = batchRows[0];
//           const qty = Number(item.quantity) || 0;

//           // Credit Note = stock IN (reverse stock OUT of sales)
//           await queryPromise(
//             connection,
//             "UPDATE batches SET quantity = quantity - ?, stock_in = IF(stock_in - ? >= 0, stock_in - ?, 0) WHERE id = ?",
//             [qty, qty, qty, batch.id]
//           );
//         }

//         // 3️⃣ DELETE OLD VOUCHERDETAILS
//         await queryPromise(
//           connection,
//           "DELETE FROM voucherdetails WHERE voucher_id = ?",
//           [voucherId]
//         );

//         // 4️⃣ PARSE NEW ITEMS
//         let newBatchDetails =
//           updateData.batchDetails ||
//           updateData.items ||
//           updateData.batch_details ||
//           [];

//         if (!Array.isArray(newBatchDetails)) {
//           try {
//             newBatchDetails = JSON.parse(newBatchDetails);
//           } catch {
//             newBatchDetails = [];
//           }
//         }

//         newBatchDetails = newBatchDetails.map((it) => ({
//           product: it.product || "",
//           product_id: Number(it.product_id || it.productId || 0),
//           batch: it.batch || it.batch_number || "",
//           quantity: Number(it.quantity) || 0,
//           price: Number(it.price) || 0,
//           discount: Number(it.discount) || 0,
//           gst: Number(it.gst) || 0,
//           cgst: Number(it.cgst) || 0,
//           sgst: Number(it.sgst) || 0,
//           igst: Number(it.igst) || 0,
//           cess: Number(it.cess) || 0,
//           total: Number(it.total) || 0,
//         }));

//         // 5️⃣ UPDATE voucher TABLE (ONLY REAL FIELDS)
//         await queryPromise(
//           connection,
//           `UPDATE voucher SET
//             VchNo = ?,
//             Date = ?,
//             InvoiceNumber = ?,
//             PartyName = ?,
//             BasicAmount = ?,
//             TaxAmount = ?,
//             TotalAmount = ?,
//             Subtotal = ?,
//             SGSTAmount = ?,
//             CGSTAmount = ?,
//             IGSTAmount = ?,
//             SGSTPercentage = ?,
//             CGSTPercentage = ?,
//             IGSTPercentage = ?,
//             paid_amount = ?
//           WHERE VoucherID = ?`,
//           [
//             updateData.VchNo || updateData.creditNoteNumber || originalVoucher.VchNo,
//             updateData.Date || originalVoucher.Date,
//             updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
//             updateData.PartyName || originalVoucher.PartyName,

//             Number(updateData.BasicAmount) || originalVoucher.BasicAmount,
//             Number(updateData.TaxAmount) || originalVoucher.TaxAmount,
//             Number(updateData.TotalAmount) || originalVoucher.TotalAmount,

//             // Subtotal = BasicAmount
//             Number(updateData.BasicAmount) || originalVoucher.Subtotal,

//             Number(updateData.SGSTAmount) || 0,
//             Number(updateData.CGSTAmount) || 0,
//             Number(updateData.IGSTAmount) || 0,

//             Number(updateData.SGSTPercentage) || 0,
//             Number(updateData.CGSTPercentage) || 0,
//             Number(updateData.IGSTPercentage) || 0,

//             Number(updateData.TotalAmount) || originalVoucher.paid_amount,

//             voucherId,
//           ]
//         );

//         // 6️⃣ INSERT NEW voucherdetails ROWS
//         for (const it of newBatchDetails) {
//           await queryPromise(
//             connection,
//             `INSERT INTO voucherdetails 
//               (voucher_id, product, product_id, transaction_type, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total, created_at)
//              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
//             [
//               voucherId,
//               it.product,
//               it.product_id,
//               "CreditNote",
//               updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
//               it.batch,
//               it.quantity,
//               it.price,
//               it.discount,
//               it.gst,
//               it.cgst,
//               it.sgst,
//               it.igst,
//               it.cess,
//               it.total,
//             ]
//           );
//         }

//         // 7️⃣ UPDATE NEW STOCK (CREDIT NOTE = STOCK IN)
//         for (const it of newBatchDetails) {
//           const rows = await queryPromise(
//             connection,
//             "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
//             [it.product_id, it.batch]
//           );

//           if (!rows[0]) {
//             throw new Error(
//               `Batch not found for product ${it.product_id}, batch ${it.batch}`
//             );
//           }

//           const batch = rows[0];

//           await queryPromise(
//             connection,
//             "UPDATE batches SET quantity = quantity + ?, stock_in = stock_in + ? WHERE id = ?",
//             [it.quantity, it.quantity, batch.id]
//           );
//         }

//         // 8️⃣ COMMIT
//         connection.commit(() => {
//           connection.release();
//           res.json({
//             success: true,
//             message: "Credit Note updated successfully",
//             voucherId,
//           });
//         });
//       } catch (err) {
//         console.log("UPDATE ERROR:", err);
//         connection.rollback(() => {
//           connection.release();
//           res.status(500).json({ success: false, message: err.message });
//         });
//       }
//     });
//   });
// });


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
          connection, // 🔥 ADD CONNECTION PARAMETER HERE
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        if (voucherResult.length === 0) {
          throw new Error("Transaction not found");
        }

        const voucherData = voucherResult[0];

        // 2️⃣ Get batch details from voucherdetails table
        const batchDetails = await queryPromise(
          connection, // 🔥 ADD CONNECTION PARAMETER HERE
          "SELECT * FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // -----------------------------------------------------------------------
        // 3️⃣ Reverse stock for SALES
        // -----------------------------------------------------------------------
        if (voucherData.TransactionType === "Sales" && batchDetails.length > 0) {
          console.log("Reversing STOCK for SALES");

          for (const item of batchDetails) {
            if (!item.product_id || !item.batch) continue;

            const batchResult = await queryPromise(
              connection, // 🔥 ADD CONNECTION PARAMETER HERE
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch]
            );

            if (batchResult.length > 0) {
              const batch = batchResult[0];
              const qty = Number(item.quantity) || 0;

              const newStockOut = Number(batch.stock_out) - qty;
              const newQuantity =
                Number(batch.opening_stock) +
                Number(batch.stock_in) -
                newStockOut;

              await queryPromise(
                connection, // 🔥 ADD CONNECTION PARAMETER HERE
                "UPDATE batches SET quantity = ?, stock_out = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockOut, batch.id]
              );

              console.log(
                `✔ SALES reversed batch ${item.batch}: qty=${newQuantity}, stock_out=${newStockOut}`
              );
            }
          }
        }

        // -----------------------------------------------------------------------
        // 3️⃣➖ Reverse stock for CREDIT NOTE
        // -----------------------------------------------------------------------
        if (voucherData.TransactionType === "CreditNote" && batchDetails.length > 0) {
          console.log("Reversing STOCK for CREDIT NOTE");

          for (const item of batchDetails) {
            if (!item.product_id || !item.batch) continue;

            const batchResult = await queryPromise(
              connection, // 🔥 ADD CONNECTION PARAMETER HERE
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch]
            );

            if (batchResult.length > 0) {
              const batch = batchResult[0];
              const qty = Number(item.quantity) || 0;

              const newStockIn = Number(batch.stock_in) - qty;
              const newQuantity =
                Number(batch.opening_stock) +
                newStockIn -
                Number(batch.stock_out);

              await queryPromise(
                connection, // 🔥 ADD CONNECTION PARAMETER HERE
                "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockIn, batch.id]
              );

              console.log(
                `✔ CREDIT NOTE reversed batch ${item.batch}: qty=${newQuantity}, stock_in=${newStockIn}`
              );
            }
          }
        }

        // -----------------------------------------------------------------------
        // 3️⃣➖ Reverse stock for PURCHASE
        // -----------------------------------------------------------------------
        if (voucherData.TransactionType === "Purchase" && batchDetails.length > 0) {
          console.log("Reversing STOCK for PURCHASE");

          for (const item of batchDetails) {
            if (!item.product_id || !item.batch) continue;

            const batchResult = await queryPromise(
              connection, // 🔥 ADD CONNECTION PARAMETER HERE
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch]
            );

            if (batchResult.length > 0) {
              const batch = batchResult[0];
              const qty = Number(item.quantity) || 0;

              // Reverse purchase: decrease stock_in and decrease quantity
              const newStockIn = Number(batch.stock_in) - qty;

              const newQuantity =
                Number(batch.opening_stock) +
                newStockIn -
                Number(batch.stock_out);

              await queryPromise(
                connection, // 🔥 ADD CONNECTION PARAMETER HERE
                "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockIn, batch.id]
              );

              console.log(
                `✔ PURCHASE reversed batch ${item.batch}: qty=${newQuantity}, stock_in=${newStockIn}`
              );
            }
          }
        }

        // -----------------------------------------------------------------------
        // 3️⃣➖ Reverse stock for DEBIT NOTE
        // -----------------------------------------------------------------------
        if (voucherData.TransactionType === "DebitNote" && batchDetails.length > 0) {
          console.log("Reversing STOCK for DEBIT NOTE");

          for (const item of batchDetails) {
            if (!item.product_id || !item.batch) continue;

            const batchResult = await queryPromise(
              connection, // 🔥 ADD CONNECTION PARAMETER HERE
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch]
            );

            if (batchResult.length > 0) {
              const batch = batchResult[0];
              const qty = Number(item.quantity) || 0;

              // Reverse debit note = reverse stock_out
              const newStockOut = Number(batch.stock_out) - qty;

              const newQuantity =
                Number(batch.opening_stock) +
                Number(batch.stock_in) -
                newStockOut;

              await queryPromise(
                connection, // 🔥 ADD CONNECTION PARAMETER HERE
                "UPDATE batches SET quantity = ?, stock_out = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockOut, batch.id]
              );

              console.log(
                `✔ DEBIT NOTE reversed batch ${item.batch}: qty=${newQuantity}, stock_out=${newStockOut}`
              );
            }
          }
        }

        // -----------------------------------------------------------------------
        // 4️⃣ Delete voucherdetails
        // -----------------------------------------------------------------------
        await queryPromise(
          connection, // 🔥 ADD CONNECTION PARAMETER HERE
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // -----------------------------------------------------------------------
        // 5️⃣ Delete voucher record
        // -----------------------------------------------------------------------
        await queryPromise(
          connection, // 🔥 ADD CONNECTION PARAMETER HERE
          "DELETE FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        // -----------------------------------------------------------------------
        // 6️⃣ Commit transaction
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
          console.log("✔ Transaction deleted & stock reversed successfully");

          res.send({
            success: true,
            message: "Invoice deleted and stock reversed successfully",
            voucherId,
            stockReverted: true,
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

  // Fetch vouchers + customer details
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

    const { invoiceNumber } = req.params;

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
        v.AccountName,
        v.PartyID,
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
        v.pdf_created_at
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

    const voucherIDs = vouchers.map(v => v.VoucherID);

    // Load line items from voucherdetails
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

    // Build categorized response
    res.json({
      success: true,
      data: {
        sales: vouchers.find(v => v.TransactionType === "Sales") || null,
        receipts: vouchers.filter(v => v.TransactionType === "Receipt"),
        creditnotes: vouchers.filter(v => v.TransactionType === "CreditNote"),
        purchases: vouchers.filter(v => v.TransactionType === "Purchase"),
        purchasevoucher: vouchers.filter(v => v.TransactionType === "purchase voucher"),
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

        // Since BatchDetails column doesn't exist, we'll get batch details from voucherdetails table
        let originalBatchDetails = [];
        try {
          // Fetch batch details from voucherdetails table instead
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
            discount: detail.discount,
            gst: detail.gst,
            cgst: detail.cgst,
            sgst: detail.sgst,
            igst: detail.igst,
            cess: detail.cess,
            total: detail.total
          }));
        } catch {
          originalBatchDetails = [];
        }

        // -------------------------------------------------------------------
        // 2️⃣ REVERSE OLD STOCK (UNDO original stock effect) - FIXED FOR SALES
        // -------------------------------------------------------------------

        for (const item of originalBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          console.log("♻️ Reversing:", originalTransactionType, item);

          // First, check current batch stock
          const batchCheck = await queryPromise(
            connection,
            "SELECT quantity, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          if (batchCheck.length === 0) {
            console.warn(`⚠️ Batch ${item.batch} not found during reversal - skipping`);
            continue;
          }

          const currentQuantity = parseFloat(batchCheck[0].quantity);
          const currentStockOut = parseFloat(batchCheck[0].stock_out);

          if (originalTransactionType === "Purchase" || originalTransactionType === "CreditNote") {
            // For Purchase and CreditNote reversal, check if we have enough stock to reverse
            if (currentQuantity < item.quantity) {
              throw new Error(
                `Cannot reverse ${originalTransactionType}: insufficient stock in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}`
              );
            }

            const q = `
              UPDATE batches
              SET quantity = quantity - ?,
                  stock_in = stock_in - ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ?
            `;

            const r = await queryPromise(
              connection,
              q,
              [item.quantity, item.quantity, item.product_id, item.batch]
            );

            if (r.affectedRows === 0) {
              console.warn(`⚠️ Failed to reverse ${originalTransactionType} for batch ${item.batch} - batch may not exist`);
            } else {
              console.log(`✔ Reversed ${originalTransactionType} for batch ${item.batch}`);
            }

          } else {
            // SALES reversal → return stock
            if (currentStockOut < item.quantity) {
              throw new Error(
                `Cannot reverse SALES: stock_out is less than quantity to reverse in batch ${item.batch}. Current stock_out: ${currentStockOut}, Required: ${item.quantity}`
              );
            }

            const q = `
              UPDATE batches
              SET quantity = quantity + ?,
                  stock_out = stock_out - ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ?
            `;

            const r = await queryPromise(
              connection,
              q,
              [item.quantity, item.quantity, item.product_id, item.batch]
            );

            if (r.affectedRows === 0) {
              console.warn(`⚠️ Batch ${item.batch} not found during SALES reversal - skipping`);
            } else {
              console.log(`✔ Reversed SALES for batch ${item.batch}`);
            }
          }
        }

        // -------------------------------------------------------------------
        // DELETE EXISTING VOUCHER DETAILS
        // -------------------------------------------------------------------
        await queryPromise(
          connection,
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // -------------------------------------------------------------------
        // 3️⃣ UPDATE voucher main table
        // -------------------------------------------------------------------
        let newBatchDetails = [];
        if (updateData.batchDetails) {
          newBatchDetails = Array.isArray(updateData.batchDetails)
            ? updateData.batchDetails
            : JSON.parse(updateData.batchDetails || "[]");
        }

        let vchNo = updateData.invoiceNumber || originalVoucher[0].VchNo;
        let invoiceNumber =
          updateData.invoiceNumber || originalVoucher[0].InvoiceNumber;

        await queryPromise(
          connection,
          `UPDATE voucher 
           SET VchNo = ?, InvoiceNumber = ?, Date = ?, PartyName = ?, 
               BasicAmount = ?, TaxAmount = ?, TotalAmount = ?
           WHERE VoucherID = ?`,
          [
            vchNo,
            invoiceNumber,
            updateData.invoiceDate || originalVoucher[0].Date,
            updateData.supplierInfo?.name || originalVoucher[0].PartyName,
            parseFloat(updateData.taxableAmount) ||
            parseFloat(originalVoucher[0].BasicAmount),
            parseFloat(updateData.totalGST) ||
            parseFloat(originalVoucher[0].TaxAmount),
            parseFloat(updateData.grandTotal) ||
            parseFloat(originalVoucher[0].TotalAmount),
            voucherId,
          ]
        );

        // -------------------------------------------------------------------
        // INSERT NEW voucherDetails
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          await queryPromise(
            connection,
            `INSERT INTO voucherdetails 
              (voucher_id, product, product_id, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              voucherId,
              item.product || "",
              item.product_id || "",
              invoiceNumber,
              item.batch || "",
              parseFloat(item.quantity) || 0,
              parseFloat(item.price) || 0,
              parseFloat(item.discount) || 0,
              parseFloat(item.gst) || 0,
              parseFloat(item.cgst) || 0,
              parseFloat(item.sgst) || 0,
              parseFloat(item.igst) || 0,
              parseFloat(item.cess) || 0,
              parseFloat(item.total) || 0,
            ]
          );
        }

        // -------------------------------------------------------------------
        // 4️⃣ APPLY **NEW** STOCK CHANGES (WITH BATCH CREATION IF NEEDED)
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          // Check if batch exists before applying changes
          const batchExists = await queryPromise(
            connection,
            "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          // If batch doesn't exist, create it first
          if (batchExists.length === 0) {
            console.log(`➕ Creating new batch: ${item.batch} for product ${item.product_id}`);
            
            await queryPromise(
              connection,
              `INSERT INTO batches 
               (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
               VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
              [item.product_id, item.batch]
            );
            console.log(`✔ Created new batch: ${item.batch}`);
          }

          const currentBatch = await queryPromise(
            connection,
            "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          const currentQuantity = parseFloat(currentBatch[0].quantity);

          if (originalTransactionType === "Purchase" || originalTransactionType === "CreditNote") {
            // PURCHASE/CREDIT NOTE → Add stock
            const q = `
              UPDATE batches
              SET quantity = quantity + ?,
                  stock_in = stock_in + ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ?
            `;

            const r = await queryPromise(
              connection,
              q,
              [item.quantity, item.quantity, item.product_id, item.batch]
            );

            if (r.affectedRows === 0) {
              throw new Error(
                `Failed to update batch ${item.batch} for ${originalTransactionType}`
              );
            }

            console.log(`✔ ${originalTransactionType} applied batch ${item.batch}`);

          } else {
            // SALES → Reduce stock (with quantity check)
            if (currentQuantity < item.quantity) {
              throw new Error(
                `Insufficient quantity for SALES update in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}`
              );
            }

            const q = `
              UPDATE batches
              SET quantity = quantity - ?,
                  stock_out = stock_out + ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ?
            `;

            const r = await queryPromise(
              connection,
              q,
              [item.quantity, item.quantity, item.product_id, item.batch]
            );

            if (r.affectedRows === 0) {
              throw new Error(
                `Failed to update batch ${item.batch} for SALES`
              );
            }

            console.log(`✔ SALES applied batch ${item.batch}`);
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

router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  console.log("📦 COMPLETE REQUEST BODY:", JSON.stringify(transactionData, null, 2));
  console.log("Received transaction:", transactionData);

  const transactionType =
    transactionData.TransactionType ||
    transactionData.transactionType ||
    "Sales";

  console.log("Processing as:", transactionType);

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
          connection
        );

        const { voucherId, invoiceNumber, vchNo, batchDetails } = result;

        connection.commit((commitErr) => {
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

          let message =
            transactionType === "CreditNote"
              ? "Credit Note created"
              : transactionType === "Purchase"
              ? "Purchase Transaction completed"
              : transactionType === "DebitNote"
              ? "Debit Note created"
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

const processTransaction = async (transactionData, transactionType, connection) => {

  // STEP 1: NEXT VOUCHER ID
  const maxIdResult = await queryPromise(
    connection,
    "SELECT COALESCE(MAX(VoucherID),0)+1 AS nextId FROM voucher"
  );
  const nextVoucherId = maxIdResult[0].nextId;

  // STEP 2: EXTRACT ITEMS
  let items = [];

  if (Array.isArray(transactionData.items)) items = transactionData.items;
  else if (Array.isArray(transactionData.batch_details)) items = transactionData.batch_details;
  else if (Array.isArray(transactionData.batchDetails)) items = transactionData.batchDetails;
  else items = [];

  // Normalize
  items = items.map((i) => ({
    product: i.product || "",
    product_id: parseInt(i.product_id || i.productId) || null,
    batch: i.batch || i.batch_number || "DEFAULT",
    quantity: parseFloat(i.quantity) || 0,
    price: parseFloat(i.price) || 0,
    discount: parseFloat(i.discount) || 0,
    gst: parseFloat(i.gst) || 0,
    cgst: parseFloat(i.cgst) || 0,
    sgst: parseFloat(i.sgst) || 0,
    igst: parseFloat(i.igst) || 0,
    cess: parseFloat(i.cess) || 0,
    total: parseFloat(i.total) || (parseFloat(i.quantity) * parseFloat(i.price)),
  }));

  // STEP 3: GET BATCH NUMBER FOR VOUCHER TABLE
  let voucherBatchNumber = null;
  
  // Get batch number from the first item for voucher table
  if (items.length > 0 && items[0].batch) {
    voucherBatchNumber = items[0].batch;
    console.log(`✅ Using batch number for voucher table: ${voucherBatchNumber}`);
  }

  // STEP 4: INVOICE / VCHNO
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
      transactionData.creditNoteNumber ||
      "DNOTE001";
  }

  if (transactionType === "Purchase") {
    vchNo =
      transactionData.InvoiceNumber ||
      transactionData.invoiceNumber ||
      "PINV001";
  }

  // STEP 5: TOTALS
  const taxableAmount =
    parseFloat(transactionData.BasicAmount) ||
    items.reduce((sum, i) => sum + i.quantity * i.price, 0);

  const totalGST =
    parseFloat(transactionData.TaxAmount) ||
    items.reduce((sum, i) => sum + (i.quantity * i.price * (i.gst / 100)), 0);

  const grandTotal =
    parseFloat(transactionData.TotalAmount) ||
    taxableAmount + totalGST;

  // STEP 6: ACCOUNT / PARTY
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

  const accountName =
    supplier.business_name ||
    customer.business_name ||
    transactionData.AccountName ||
    "";

  // STEP 7: INSERT VOUCHER (STORE BATCH NUMBER INSTEAD OF BATCH_ID)
  const voucherData = {
    VoucherID: nextVoucherId,
    TransactionType: transactionType,
    VchNo: vchNo,
    InvoiceNumber: invoiceNumber,
    Date: transactionData.Date || new Date().toISOString().split("T")[0],

    PaymentTerms: transactionData.PaymentTerms || "Immediate",
    Freight: parseFloat(transactionData.Freight) || 0,
    TotalPacks: items.length,

    TaxAmount: totalGST,
    Subtotal: taxableAmount,
    BillSundryAmount: parseFloat(transactionData.BillSundryAmount) || 0,
    TotalAmount: grandTotal,
    paid_amount: parseFloat(transactionData.paid_amount) || grandTotal,

    AccountID: accountID,
    AccountName: accountName,
    PartyID: partyID,
    PartyName: partyName,

    BasicAmount: taxableAmount,
    ValueOfGoods: taxableAmount,
    EntryDate: new Date(),

    SGSTPercentage: parseFloat(transactionData.SGSTPercentage) || 0,
    CGSTPercentage: parseFloat(transactionData.CGSTPercentage) || 0,
    IGSTPercentage: parseFloat(transactionData.IGSTPercentage) || (items[0]?.igst || 0),

    SGSTAmount: parseFloat(transactionData.SGSTAmount) || 0,
    CGSTAmount: parseFloat(transactionData.CGSTAmount) || 0,
    IGSTAmount: parseFloat(transactionData.IGSTAmount) || 0,

    TaxSystem: transactionData.TaxSystem || "GST",

    product_id: items[0]?.product_id || null,
    batch_id: voucherBatchNumber, // 🔥 FIXED: Now storing batch number (like "sam001") instead of numeric batch_id
    DC: transactionType === "CreditNote" ? "C" : "D",

    ChequeNo: transactionData.ChequeNo || "",
    ChequeDate: transactionData.ChequeDate || null,
    BankName: transactionData.BankName || "",

    created_at: new Date(),
    balance_amount: parseFloat(transactionData.balance_amount) || 0,
    status: transactionData.status || "active",
    paid_date: transactionData.paid_date || null,

    pdf_data: transactionData.pdf_data || null,
    pdf_file_name: transactionData.pdf_file_name || null,
    pdf_created_at: transactionData.pdf_created_at || null
  };

  console.log("📦 Voucher Data being inserted - batch_id (batch number):", voucherBatchNumber);
  console.log("📦 Complete voucher data:", voucherData);

  await queryPromise(
    connection,
    "INSERT INTO voucher SET ?",
    [voucherData]
  );

  // STEP 8: INSERT ITEMS INTO voucherdetails
  const insertDetailQuery = `
    INSERT INTO voucherdetails (
      voucher_id, product, product_id, transaction_type, InvoiceNumber,
      batch, quantity, price, discount,
      gst, cgst, sgst, igst, cess, total, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  for (const i of items) {
    await queryPromise(connection, insertDetailQuery, [
      nextVoucherId,
      i.product,
      i.product_id,
      transactionType,
      invoiceNumber,
      i.batch,
      i.quantity,
      i.price,
      i.discount,
      i.gst,
      i.cgst,
      i.sgst,
      i.igst,
      i.cess,
      i.total
    ]);
  }

  // STEP 9: STOCK UPDATES
  for (const i of items) {
    if (transactionType === "Sales" || transactionType === "DebitNote") {
      await queryPromise(
        connection,
        `
        UPDATE batches 
          SET quantity = quantity - ?, stock_out = stock_out + ?, updated_at = NOW()
        WHERE product_id = ? AND batch_number = ? AND quantity >= ?
      `,
        [i.quantity, i.quantity, i.product_id, i.batch, i.quantity]
      );
    }

    if (transactionType === "Purchase" || transactionType === "CreditNote") {
      await queryPromise(
        connection,
        `
        UPDATE batches 
          SET quantity = quantity + ?, stock_in = stock_in + ?, updated_at = NOW()
        WHERE product_id = ? AND batch_number = ?
      `,
        [i.quantity, i.quantity, i.product_id, i.batch]
      );
    }
  }

  return {
    voucherId: nextVoucherId,
    invoiceNumber,
    vchNo,
    batchDetails: items,
    grandTotal
  };
};



router.get("/voucherdetails", async (req, res) => {
  try {
    const query = `
      SELECT 
        MIN(vd.id) as id,
        vd.product,
        vd.product_id,
        vd.batch,
        SUM(vd.quantity) as quantity,
        SUM(vd.price) as price,
        SUM(vd.discount) as discount,
        SUM(vd.gst) as gst,
        SUM(vd.cgst) as cgst,
        SUM(vd.sgst) as sgst,
        SUM(vd.igst) as igst,
        SUM(vd.cess) as cess,
        SUM(vd.total) as total,
        MIN(vd.created_at) as created_at,
        MAX(vd.update_at) as update_at,
        GROUP_CONCAT(DISTINCT v.InvoiceNumber SEPARATOR ', ') as InvoiceNumber,
        GROUP_CONCAT(DISTINCT v.PartyName SEPARATOR ', ') as PartyName,
        GROUP_CONCAT(DISTINCT vd.voucher_id) as voucher_ids,
        COUNT(*) as transaction_count
      FROM voucherdetails vd
      LEFT JOIN voucher v ON vd.voucher_id = v.VoucherID
      GROUP BY vd.product_id, vd.batch, vd.product
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






module.exports = router;