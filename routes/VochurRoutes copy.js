// const express = require('express');
// const router = express.Router();
// const db = require('../db');
// const axios = require('axios'); // ADD THIS LINE

// // Get next sales invoice number
// router.get("/next-invoice-number", async (req, res) => {
//   try {
//     const query = `
//       SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 4) AS UNSIGNED)) as maxNumber 
//       FROM voucher 
//       WHERE TransactionType IN ('Sales', 'stock transfer') 
//       AND InvoiceNumber LIKE 'INV%'
//     `;

//     db.query(query, (err, results) => {
//       if (err) {
//         console.error('Error fetching next invoice number:', err);
//         return res.status(500).send({ error: 'Failed to get next invoice number' });
//       }

//       let nextNumber = 1;
//       if (results[0].maxNumber !== null && !isNaN(results[0].maxNumber)) {
//         nextNumber = parseInt(results[0].maxNumber) + 1;
//       }

//       const nextInvoiceNumber = `INV${nextNumber.toString().padStart(3, '0')}`;

//       res.send({ nextInvoiceNumber });
//     });
//   } catch (error) {
//     console.error('Error in next-invoice-number:', error);
//     res.status(500).send({ error: 'Internal server error' });
//   }
// });
// // Store PDF data for invoice
// router.post("/transactions/:id/pdf", async (req, res) => {
//   const voucherId = req.params.id;
//   const { pdfData, fileName } = req.body;

//   console.log('Storing PDF for voucher:', voucherId);

//   if (!pdfData || !fileName) {
//     return res.status(400).json({
//       success: false,
//       message: 'PDF data and file name are required'
//     });
//   }

//   try {
//     const updateQuery = `
//       UPDATE voucher 
//       SET pdf_data = ?, pdf_file_name = ?, pdf_created_at = NOW() 
//       WHERE VoucherID = ?
//     `;

//     db.query(updateQuery, [pdfData, fileName, voucherId], (err, results) => {
//       if (err) {
//         console.error('Error storing PDF:', err);
//         return res.status(500).json({
//           success: false,
//           message: 'Failed to store PDF',
//           error: err.message
//         });
//       }

//       if (results.affectedRows === 0) {
//         return res.status(404).json({
//           success: false,
//           message: 'Voucher not found'
//         });
//       }

//       console.log('PDF stored successfully for voucher:', voucherId);
//       res.json({
//         success: true,
//         message: 'PDF stored successfully',
//         voucherId: voucherId,
//         fileName: fileName
//       });
//     });
//   } catch (error) {
//     console.error('Error in PDF storage:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });




// router.get("/transactions/:id/pdf", (req, res) => {
//   const voucherId = req.params.id;

//   const query = `
//     SELECT pdf_data, pdf_file_name, pdf_created_at 
//     FROM voucher 
//     WHERE VoucherID = ? AND pdf_data IS NOT NULL
//   `;

//   db.query(query, [voucherId], (err, results) => {
//     if (err) {
//       console.error('Error fetching PDF:', err);
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to fetch PDF',
//         error: err.message
//       });
//     }

//     if (results.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'PDF not found for this invoice'
//       });
//     }

//     const pdfInfo = results[0];
//     res.json({
//       success: true,
//       pdfData: pdfInfo.pdf_data,
//       fileName: pdfInfo.pdf_file_name,
//       createdAt: pdfInfo.pdf_created_at
//     });
//   });
// });

// router.get("/transactions/:id/download-pdf", (req, res) => {
//   const voucherId = req.params.id;

//   console.log('Downloading PDF for voucher:', voucherId);

//   const query = `
//     SELECT pdf_data, pdf_file_name 
//     FROM voucher 
//     WHERE VoucherID = ? AND pdf_data IS NOT NULL
//   `;

//   db.query(query, [voucherId], (err, results) => {
//     if (err) {
//       console.error('Error fetching PDF for download:', err);
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to fetch PDF'
//       });
//     }

//     if (results.length === 0) {
//       console.log('PDF not found for voucher:', voucherId);
//       return res.status(404).json({
//         success: false,
//         message: 'PDF not found for this invoice'
//       });
//     }

//     const pdfInfo = results[0];
//     console.log('PDF found:', pdfInfo.pdf_file_name);
// try {
//   let base64Data = pdfInfo.pdf_data;

//   // 🟢 FIX: Convert Buffer → String
//   if (Buffer.isBuffer(base64Data)) {
//     base64Data = base64Data.toString();
//   }

//   // 🟢 FIX: Ensure it's a string before checking .startsWith()
//   if (typeof base64Data === "string") {
//     if (base64Data.startsWith("data:application/pdf;base64,")) {
//       base64Data = base64Data.replace("data:application/pdf;base64,", "");
//     }
//   } else {
//     return res.status(400).json({ error: "Invalid PDF data format" });
//   }

//   // Convert base64 to buffer
//   const pdfBuffer = Buffer.from(base64Data, "base64");

//   // Set headers
//   res.setHeader("Content-Type", "application/pdf");
//   res.setHeader("Content-Disposition", `attachment; filename="${pdfInfo.pdf_file_name}"`);
//   res.setHeader("Content-Length", pdfBuffer.length);
//   res.setHeader("Cache-Control", "no-cache");

//   console.log("Sending PDF buffer, size:", pdfBuffer.length);

//   res.send(pdfBuffer);

// } catch (err) {
//   console.error("Error processing PDF:", err);
//   res.status(500).json({ error: "PDF processing failed" });
// }

//   });
// });


// router.get("/transactions/download-pdf", (req, res) => {
//   const { order_number } = req.query;

//   if (!order_number) {
//     return res.status(400).json({
//       success: false,
//       message: 'Order number is required'
//     });
//   }

//   console.log('Downloading PDF(s) for order:', order_number);

//   const query = `
//     SELECT pdf_data, pdf_file_name , status
//     FROM voucher 
//     WHERE order_number = ? AND pdf_data IS NOT NULL
//     ORDER BY created_at ASC
//   `;

//   db.query(query, [order_number], (err, results) => {
//     if (err) {
//       console.error('Error fetching PDFs:', err);
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to fetch PDFs'
//       });
//     }

//     if (results.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'PDFs not found for this order'
//       });
//     }

//     // Return all PDFs as an array in response
//     const pdfs = results.map((pdfInfo, index) => {
//       let base64Data = pdfInfo.pdf_data;
      
//       if (Buffer.isBuffer(base64Data)) {
//         base64Data = base64Data.toString();
//       }

//       if (typeof base64Data === "string") {
//         if (base64Data.startsWith("data:application/pdf;base64,")) {
//           base64Data = base64Data.replace("data:application/pdf;base64,", "");
//         }
//       }

//       return {
//         fileName: pdfInfo.pdf_file_name || `invoice_${index + 1}.pdf`,
//         status : pdfInfo.status,
//         data: base64Data
//       };
//     });

//     res.json({
//       success: true,
//       count: pdfs.length,
//       orderNumber: order_number,
//       pdfs: pdfs
//     });
//   });
// });

// function queryPromise(connection, sql, params = []) {
//   return new Promise((resolve, reject) => {
//     connection.query(sql, params, (err, results) => {
//       if (err) return reject(err);
//       resolve(results);
//     });
//   });
// }

// // ----------------------------------------------------------------------
// // PUT /creditnoteupdate/:id
// // ----------------------------------------------------------------------
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

//         if (originalVoucherRows.length === 0) {
//           throw new Error("Voucher not found");
//         }

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

//         // 🔴 NEW VALIDATION: Check if Credit Note quantity exceeds Sales quantity
//         const invoiceNumber = updateData.InvoiceNumber || originalVoucher.InvoiceNumber;
        
//         if (invoiceNumber) {
//           // Find the original Sales voucher for this invoice
//           const salesVoucherRows = await queryPromise(
//   connection,
//   `
//     SELECT *
//     FROM voucher
//     WHERE InvoiceNumber = ?
//       AND TransactionType IN ('Sales', 'stock transfer')
//   `,
//   [invoiceNumber]
// );

//           if (salesVoucherRows.length > 0) {
//             const salesVoucherId = salesVoucherRows[0].VoucherID;
            
//             // Get all sales details for this invoice
//             const salesDetails = await queryPromise(
//               connection,
//               "SELECT * FROM voucherdetails WHERE voucher_id = ?",
//               [salesVoucherId]
//             );

//             // Create a map of product_id+batch to sales quantity
//             const salesQuantityMap = new Map();
//             for (const salesItem of salesDetails) {
//               const key = `${salesItem.product_id}_${salesItem.batch}`;
//               salesQuantityMap.set(key, Number(salesItem.quantity) || 0);
//             }

//             // Validate each credit note item
//             for (const creditNoteItem of newBatchDetails) {
//               const key = `${creditNoteItem.product_id}_${creditNoteItem.batch}`;
//               const salesQuantity = salesQuantityMap.get(key) || 0;
//               const creditNoteQuantity = Number(creditNoteItem.quantity) || 0;

//               if (creditNoteQuantity > salesQuantity) {
//                 // 🔴 IMPORTANT: Rollback transaction before sending response
//                 connection.rollback(() => {
//                   connection.release();
//                   return res.status(400).json({ 
//                     success: false, 
//                     message: `Quantity exceeds sales quantity! Product: ${creditNoteItem.product}, Batch: ${creditNoteItem.batch}. Sales Quantity: ${salesQuantity}, Credit Note Quantity: ${creditNoteQuantity}`
//                   });
//                 });
//                 return; // Stop execution
//               }
//             }
//           } else {
//             // 🔴 Rollback and send error for no sales voucher found
//             connection.rollback(() => {
//               connection.release();
//               return res.status(400).json({ 
//                 success: false, 
//                 message: `No Sales voucher found for Invoice Number: ${invoiceNumber}`
//               });
//             });
//             return; // Stop execution
//           }
//         }

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
//             paid_amount = ?,
//                 data_type = ?

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
//    updateData.data_type || originalVoucher.data_type || null,
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
//         connection.commit((err) => {
//           if (err) {
//             console.log("COMMIT ERROR:", err);
//             connection.rollback(() => {
//               connection.release();
//               return res.status(500).json({ success: false, message: "Commit failed" });
//             });
//             return;
//           }
          
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

// router.put("/debitnoteupdate/:id", async (req, res) => {
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

//         if (originalVoucherRows.length === 0) {
//           throw new Error("Voucher not found");
//         }

//         const originalVoucher = originalVoucherRows[0];
//         const transactionType =
//           updateData.transactionType ||
//           originalVoucher.TransactionType ||
//           "DebitNote";

//         // 2️⃣ FETCH OLD VOUCHERDETAILS (to reverse stock)
//         const oldDetails = await queryPromise(
//           connection,
//           "SELECT * FROM voucherdetails WHERE voucher_id = ?",
//           [voucherId]
//         );

//         for (const item of oldDetails) {
//           const batchRows = await queryPromise(
//             connection,
//             "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch]
//           );

//           if (!batchRows[0]) continue;
//           const batch = batchRows[0];
//           const qty = Number(item.quantity) || 0;

//           // For Debit Note: Original was stock OUT, so reversal is stock IN
//           await queryPromise(
//             connection,
//             "UPDATE batches SET quantity = quantity + ?, stock_out = GREATEST(0, stock_out - ?) WHERE id = ?",
//             [qty, qty, batch.id]
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

//         const invoiceNumber = updateData.InvoiceNumber || originalVoucher.InvoiceNumber;
        
//         if (invoiceNumber) {
//       const purchaseVoucherRows = await queryPromise(
//   connection,
//   `
//     SELECT * 
//     FROM voucher 
//     WHERE InvoiceNumber = ?
//       AND TransactionType IN ('Purchase', 'stock inward')
//   `,
//   [invoiceNumber]
// );


//           if (purchaseVoucherRows.length > 0) {
//             const purchaseVoucherId = purchaseVoucherRows[0].VoucherID;
            
//             // Get all purchase details for this invoice
//             const purchaseDetails = await queryPromise(
//               connection,
//               "SELECT * FROM voucherdetails WHERE voucher_id = ?",
//               [purchaseVoucherId]
//             );

//             // Create a map of product_id+batch to purchase quantity
//             const purchaseQuantityMap = new Map();
//             for (const purchaseItem of purchaseDetails) {
//               const key = `${purchaseItem.product_id}_${purchaseItem.batch}`;
//               purchaseQuantityMap.set(key, Number(purchaseItem.quantity) || 0);
//             }

//             // Get all debit notes for this invoice (excluding current one being edited)
//             const allDebitNotes = await queryPromise(
//               connection,
//               `SELECT vd.* FROM voucherdetails vd 
//                JOIN voucher v ON vd.voucher_id = v.VoucherID 
//                WHERE v.InvoiceNumber = ? 
//                AND vd.transaction_type = 'DebitNote' 
//                AND v.VoucherID != ?`,
//               [invoiceNumber, voucherId]
//             );

//             // Calculate total debit note quantities already used
//             const usedDebitQuantityMap = new Map();
//             for (const debitItem of allDebitNotes) {
//               const key = `${debitItem.product_id}_${debitItem.batch}`;
//               const currentUsed = usedDebitQuantityMap.get(key) || 0;
//               usedDebitQuantityMap.set(key, currentUsed + Number(debitItem.quantity));
//             }

//             // Add the old debit note quantities (that we're editing)
//             for (const oldItem of oldDetails) {
//               const key = `${oldItem.product_id}_${oldItem.batch}`;
//               const currentUsed = usedDebitQuantityMap.get(key) || 0;
//               usedDebitQuantityMap.set(key, currentUsed + Number(oldItem.quantity));
//             }

//             // Validate each debit note item
//             for (const debitNoteItem of newBatchDetails) {
//               const key = `${debitNoteItem.product_id}_${debitNoteItem.batch}`;
//               const purchaseQuantity = purchaseQuantityMap.get(key) || 0;
//               const debitNoteQuantity = Number(debitNoteItem.quantity) || 0;
//               const alreadyUsedQuantity = usedDebitQuantityMap.get(key) || 0;
              
//               // Available quantity = Purchase Quantity - Already used Debit Note Quantities (excluding this item's old quantity)
//               const availableForNewDebit = purchaseQuantity - alreadyUsedQuantity + 
//                 (oldDetails.find(d => 
//                   d.product_id === debitNoteItem.product_id && 
//                   d.batch === debitNoteItem.batch
//                 )?.quantity || 0);

//               if (debitNoteQuantity > availableForNewDebit) {
//                 connection.rollback(() => {
//                   connection.release();
//                   return res.status(400).json({ 
//                     success: false, 
//                     message: `Quantity exceeds available quantity! Product: ${debitNoteItem.product}, Batch: ${debitNoteItem.batch}. Available: ${availableForNewDebit}, Debit Note Quantity: ${debitNoteQuantity}`
//                   });
//                 });
//                 return;
//               }
//             }
//           } else {
//             connection.rollback(() => {
//               connection.release();
//               return res.status(400).json({ 
//                 success: false, 
//                 message: `No Purchase voucher found for Invoice Number: ${invoiceNumber}`
//               });
//             });
//             return;
//           }
//         }

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
//             paid_amount = ?,
//             data_type = ?
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
//    updateData.data_type || originalVoucher.data_type || null,

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
//               "DebitNote",
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

//         // 7️⃣ UPDATE NEW STOCK (DEBIT NOTE = STOCK OUT)
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

//           // For Debit Note: This is stock OUT
//           await queryPromise(
//             connection,
//             "UPDATE batches SET quantity = GREATEST(0, quantity - ?), stock_out = stock_out + ? WHERE id = ?",
//             [it.quantity, it.quantity, batch.id]
//           );
//         }

//         // 8️⃣ COMMIT
//         connection.commit((err) => {
//           if (err) {
//             console.log("COMMIT ERROR:", err);
//             connection.rollback(() => {
//               connection.release();
//               return res.status(500).json({ success: false, message: "Commit failed" });
//             });
//             return;
//           }
          
//           connection.release();
//           res.json({
//             success: true,
//             message: "Debit Note updated successfully",
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













// // router.put("/creditnoteupdate/:id", async (req, res) => {
// //   const voucherId = req.params.id;
// //   const updateData = req.body;

// //   console.log("UPDATE RECEIVED => ", voucherId, updateData);

// //   db.getConnection((err, connection) => {
// //     if (err)
// //       return res.status(500).send({ error: "Database connection failed" });

// //     connection.beginTransaction(async (err) => {
// //       if (err)
// //         return res.status(500).send({ error: "Transaction could not start" });

// //       try {
// //         // 1️⃣ Fetch ORIGINAL VOUCHER
// //         const originalVoucherRows = await queryPromise(
// //           connection,
// //           "SELECT * FROM voucher WHERE VoucherID = ?",
// //           [voucherId]
// //         );

// //         if (originalVoucherRows.length === 0)
// //           throw new Error("Voucher not found");

// //         const originalVoucher = originalVoucherRows[0];
// //         const transactionType =
// //           updateData.transactionType ||
// //           originalVoucher.TransactionType ||
// //           "CreditNote";

// //         // 2️⃣ FETCH OLD VOUCHERDETAILS (to reverse stock)
// //         const oldDetails = await queryPromise(
// //           connection,
// //           "SELECT * FROM voucherdetails WHERE voucher_id = ?",
// //           [voucherId]
// //         );

// //         // Reverse OLD STOCK
// //         for (const item of oldDetails) {
// //           const batchRows = await queryPromise(
// //             connection,
// //             "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
// //             [item.product_id, item.batch]
// //           );

// //           if (!batchRows[0]) continue;
// //           const batch = batchRows[0];
// //           const qty = Number(item.quantity) || 0;

// //           // Credit Note = stock IN (reverse stock OUT of sales)
// //           await queryPromise(
// //             connection,
// //             "UPDATE batches SET quantity = quantity - ?, stock_in = IF(stock_in - ? >= 0, stock_in - ?, 0) WHERE id = ?",
// //             [qty, qty, qty, batch.id]
// //           );
// //         }

// //         // 3️⃣ DELETE OLD VOUCHERDETAILS
// //         await queryPromise(
// //           connection,
// //           "DELETE FROM voucherdetails WHERE voucher_id = ?",
// //           [voucherId]
// //         );

// //         // 4️⃣ PARSE NEW ITEMS
// //         let newBatchDetails =
// //           updateData.batchDetails ||
// //           updateData.items ||
// //           updateData.batch_details ||
// //           [];

// //         if (!Array.isArray(newBatchDetails)) {
// //           try {
// //             newBatchDetails = JSON.parse(newBatchDetails);
// //           } catch {
// //             newBatchDetails = [];
// //           }
// //         }

// //         newBatchDetails = newBatchDetails.map((it) => ({
// //           product: it.product || "",
// //           product_id: Number(it.product_id || it.productId || 0),
// //           batch: it.batch || it.batch_number || "",
// //           quantity: Number(it.quantity) || 0,
// //           price: Number(it.price) || 0,
// //           discount: Number(it.discount) || 0,
// //           gst: Number(it.gst) || 0,
// //           cgst: Number(it.cgst) || 0,
// //           sgst: Number(it.sgst) || 0,
// //           igst: Number(it.igst) || 0,
// //           cess: Number(it.cess) || 0,
// //           total: Number(it.total) || 0,
// //         }));

// //         // 5️⃣ UPDATE voucher TABLE (ONLY REAL FIELDS)
// //         await queryPromise(
// //           connection,
// //           `UPDATE voucher SET
// //             VchNo = ?,
// //             Date = ?,
// //             InvoiceNumber = ?,
// //             PartyName = ?,
// //             BasicAmount = ?,
// //             TaxAmount = ?,
// //             TotalAmount = ?,
// //             Subtotal = ?,
// //             SGSTAmount = ?,
// //             CGSTAmount = ?,
// //             IGSTAmount = ?,
// //             SGSTPercentage = ?,
// //             CGSTPercentage = ?,
// //             IGSTPercentage = ?,
// //             paid_amount = ?
// //           WHERE VoucherID = ?`,
// //           [
// //             updateData.VchNo || updateData.creditNoteNumber || originalVoucher.VchNo,
// //             updateData.Date || originalVoucher.Date,
// //             updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
// //             updateData.PartyName || originalVoucher.PartyName,

// //             Number(updateData.BasicAmount) || originalVoucher.BasicAmount,
// //             Number(updateData.TaxAmount) || originalVoucher.TaxAmount,
// //             Number(updateData.TotalAmount) || originalVoucher.TotalAmount,

// //             // Subtotal = BasicAmount
// //             Number(updateData.BasicAmount) || originalVoucher.Subtotal,

// //             Number(updateData.SGSTAmount) || 0,
// //             Number(updateData.CGSTAmount) || 0,
// //             Number(updateData.IGSTAmount) || 0,

// //             Number(updateData.SGSTPercentage) || 0,
// //             Number(updateData.CGSTPercentage) || 0,
// //             Number(updateData.IGSTPercentage) || 0,

// //             Number(updateData.TotalAmount) || originalVoucher.paid_amount,

// //             voucherId,
// //           ]
// //         );

// //         // 6️⃣ INSERT NEW voucherdetails ROWS
// //         for (const it of newBatchDetails) {
// //           await queryPromise(
// //             connection,
// //             `INSERT INTO voucherdetails 
// //               (voucher_id, product, product_id, transaction_type, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total, created_at)
// //              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
// //             [
// //               voucherId,
// //               it.product,
// //               it.product_id,
// //               "CreditNote",
// //               updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
// //               it.batch,
// //               it.quantity,
// //               it.price,
// //               it.discount,
// //               it.gst,
// //               it.cgst,
// //               it.sgst,
// //               it.igst,
// //               it.cess,
// //               it.total,
// //             ]
// //           );
// //         }

// //         // 7️⃣ UPDATE NEW STOCK (CREDIT NOTE = STOCK IN)
// //         for (const it of newBatchDetails) {
// //           const rows = await queryPromise(
// //             connection,
// //             "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
// //             [it.product_id, it.batch]
// //           );

// //           if (!rows[0]) {
// //             throw new Error(
// //               `Batch not found for product ${it.product_id}, batch ${it.batch}`
// //             );
// //           }

// //           const batch = rows[0];

// //           await queryPromise(
// //             connection,
// //             "UPDATE batches SET quantity = quantity + ?, stock_in = stock_in + ? WHERE id = ?",
// //             [it.quantity, it.quantity, batch.id]
// //           );
// //         }

// //         // 8️⃣ COMMIT
// //         connection.commit(() => {
// //           connection.release();
// //           res.json({
// //             success: true,
// //             message: "Credit Note updated successfully",
// //             voucherId,
// //           });
// //         });
// //       } catch (err) {
// //         console.log("UPDATE ERROR:", err);
// //         connection.rollback(() => {
// //           connection.release();
// //           res.status(500).json({ success: false, message: err.message });
// //         });
// //       }
// //     });
// //   });
// // });


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
//           connection,
//           "SELECT * FROM voucher WHERE VoucherID = ?",
//           [voucherId]
//         );

//         if (voucherResult.length === 0) {
//           throw new Error("Transaction not found");
//         }

//         const voucherData = voucherResult[0];
//         const transactionType = voucherData.TransactionType || "Sales";

//         // 2️⃣ Get batch details from voucherdetails table
//         const batchDetails = await queryPromise(
//           connection,
//           "SELECT * FROM voucherdetails WHERE voucher_id = ?",
//           [voucherId]
//         );

//         // -----------------------------------------------------------------------
//         // 3️⃣ Reverse stock based on transaction type
//         // -----------------------------------------------------------------------
//         if (batchDetails.length > 0) {
//           console.log(`Reversing STOCK for ${transactionType}`);

//           // Define which transactions are STOCK IN (add stock) vs STOCK OUT (remove stock)
//           const stockInTransactions = ["Purchase", "CreditNote", "stock inward"];
//           const stockOutTransactions = ["Sales", "DebitNote", "stock transfer"];
          
//           const isStockIn = stockInTransactions.includes(transactionType);
//           const isStockOut = stockOutTransactions.includes(transactionType);

//           if (!isStockIn && !isStockOut) {
//             console.log(`⚠️ Unknown transaction type: ${transactionType}, skipping stock reversal`);
//           } else {
//             for (const item of batchDetails) {
//               if (!item.product_id || !item.batch) continue;

//               const batchResult = await queryPromise(
//                 connection,
//                 "SELECT id, quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
//                 [item.product_id, item.batch]
//               );

//               if (batchResult.length > 0) {
//                 const batch = batchResult[0];
//                 const qty = Number(item.quantity) || 0;

//                 let currentQuantity = Number(batch.quantity) || 0;
//                 let currentStockIn = Number(batch.stock_in) || 0;
//                 let currentStockOut = Number(batch.stock_out) || 0;

//                 let newQuantity = currentQuantity;
//                 let newStockIn = currentStockIn;
//                 let newStockOut = currentStockOut;

//                 if (isStockIn) {
//                   // Reverse stock IN transaction: decrease stock_in and quantity
//                   newStockIn = Math.max(0, currentStockIn - qty);
//                   newQuantity = currentQuantity - qty;
                  
//                   console.log(`Reversing ${transactionType}: Subtracting ${qty} from stock_in for batch ${item.batch}`);
//                   console.log(`Current: qty=${currentQuantity}, stock_in=${currentStockIn}, stock_out=${currentStockOut}`);
//                   console.log(`New: qty=${newQuantity}, stock_in=${newStockIn}, stock_out=${newStockOut}`);
//                 } else if (isStockOut) {
//                   // Reverse stock OUT transaction: decrease stock_out and increase quantity
//                   newStockOut = Math.max(0, currentStockOut - qty);
//                   newQuantity = currentQuantity + qty;
                  
//                   console.log(`Reversing ${transactionType}: Subtracting ${qty} from stock_out for batch ${item.batch}`);
//                   console.log(`Current: qty=${currentQuantity}, stock_in=${currentStockIn}, stock_out=${currentStockOut}`);
//                   console.log(`New: qty=${newQuantity}, stock_in=${newStockIn}, stock_out=${newStockOut}`);
//                 }

//                 // Ensure quantities don't go negative
//                 newQuantity = Math.max(0, newQuantity);
//                 newStockIn = Math.max(0, newStockIn);
//                 newStockOut = Math.max(0, newStockOut);

//                 // Validate that newQuantity is a valid number
//                 if (isNaN(newQuantity)) {
//                   console.error(`❌ Invalid quantity calculated: ${newQuantity}. Using current quantity instead.`);
//                   newQuantity = currentQuantity;
//                 }
//                 if (isNaN(newStockIn)) {
//                   console.error(`❌ Invalid stock_in calculated: ${newStockIn}. Using current stock_in instead.`);
//                   newStockIn = currentStockIn;
//                 }
//                 if (isNaN(newStockOut)) {
//                   console.error(`❌ Invalid stock_out calculated: ${newStockOut}. Using current stock_out instead.`);
//                   newStockOut = currentStockOut;
//                 }

//                 await queryPromise(
//                   connection,
//                   "UPDATE batches SET quantity = ?, stock_in = ?, stock_out = ?, updated_at = NOW() WHERE id = ?",
//                   [newQuantity, newStockIn, newStockOut, batch.id]
//                 );

//                 console.log(
//                   `✔ ${transactionType} reversed batch ${item.batch}: ` +
//                   `qty=${newQuantity}, stock_in=${newStockIn}, stock_out=${newStockOut}`
//                 );
//               } else {
//                 console.warn(`⚠️ Batch ${item.batch} not found for product ${item.product_id} during ${transactionType} reversal`);
                
//                 // If batch doesn't exist but this was a stock IN transaction, we should create it
//                 if (isStockIn) {
//                   console.log(`➕ Creating batch ${item.batch} since it doesn't exist but was added in ${transactionType}`);
                  
//                   await queryPromise(
//                     connection,
//                     `INSERT INTO batches 
//                      (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
//                      VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
//                     [item.product_id, item.batch]
//                   );
//                   console.log(`✔ Created missing batch: ${item.batch}`);
//                 }
//               }
//             }
//           }
//         }

//         // -----------------------------------------------------------------------
//         // 4️⃣ Handle order status reversal if this was an invoice from an order
//         // -----------------------------------------------------------------------
//         if (voucherData.order_number) {
//           console.log(`🔄 This was an invoice from order ${voucherData.order_number}. Reversing order status...`);
          
//           try {
//             // Update order_items table
//             await queryPromise(
//               connection,
//               `
//               UPDATE order_items SET 
//                 invoice_number = NULL, 
//                 invoice_date = NULL, 
//                 invoice_status = 0,
//                 updated_at = NOW()
//               WHERE order_number = ? AND invoice_number = ?
//               `,
//               [voucherData.order_number, voucherData.InvoiceNumber]
//             );
            
//             // Update orders table
//             await queryPromise(
//               connection,
//               `
//               UPDATE orders SET 
//                 order_status = 'Pending',
//                 invoice_number = NULL,
//                 invoice_date = NULL,
//                 invoice_status = 0,
//                 updated_at = NOW()
//               WHERE order_number = ?
//               `,
//               [voucherData.order_number]
//             );
            
//             console.log(`✅ Order ${voucherData.order_number} status reverted to 'Pending'`);
//           } catch (error) {
//             console.error(`⚠️ Error reverting order status:`, error.message);
//             // Don't fail the entire deletion if order reversal fails
//           }
//         }

//         // -----------------------------------------------------------------------
//         // 5️⃣ Handle unpaid amount reversal if applicable
//         // -----------------------------------------------------------------------
//         if ((transactionType === "Sales" || transactionType === "stock transfer" || transactionType === "stock inward") && voucherData.PartyID) {
//           console.log(`💰 Reversing unpaid amount for PartyID: ${voucherData.PartyID}`);
          
//           try {
//             const tableCheck = await queryPromise(
//               connection,
//               "SHOW COLUMNS FROM accounts LIKE 'unpaid_amount'"
//             );
            
//             if (tableCheck.length > 0) {
//               const currentAccount = await queryPromise(
//                 connection,
//                 "SELECT unpaid_amount, credit_limit FROM accounts WHERE id = ?",
//                 [voucherData.PartyID]
//               );
              
//               if (currentAccount.length > 0) {
//                 const currentUnpaid = parseFloat(currentAccount[0].unpaid_amount) || 0;
//                 const totalAmount = parseFloat(voucherData.TotalAmount) || 0;
//                 const newUnpaid = Math.max(0, currentUnpaid - totalAmount);
                
//                 // Check if balance_amount column exists
//                 const balanceCheck = await queryPromise(
//                   connection,
//                   "SHOW COLUMNS FROM accounts LIKE 'balance_amount'"
//                 );
                
//                 if (balanceCheck.length > 0 && currentAccount[0].credit_limit) {
//                   const creditLimit = parseFloat(currentAccount[0].credit_limit) || 0;
//                   const newBalanceAmount = creditLimit - newUnpaid;
                  
//                   await queryPromise(
//                     connection,
//                     `
//                     UPDATE accounts 
//                     SET unpaid_amount = ?,
//                         balance_amount = ?,
//                         updated_at = NOW()
//                     WHERE id = ?
//                     `,
//                     [newUnpaid, newBalanceAmount, voucherData.PartyID]
//                   );
                  
//                   console.log(`✅ Unpaid amount reversed: ${totalAmount}, New unpaid: ${newUnpaid}, New balance: ${newBalanceAmount}`);
//                 } else {
//                   await queryPromise(
//                     connection,
//                     `
//                     UPDATE accounts 
//                     SET unpaid_amount = ?,
//                         updated_at = NOW()
//                     WHERE id = ?
//                     `,
//                     [newUnpaid, voucherData.PartyID]
//                   );
                  
//                   console.log(`✅ Unpaid amount reversed: ${totalAmount}, New unpaid: ${newUnpaid}`);
//                 }
//               }
//             }
//           } catch (error) {
//             console.error(`⚠️ Error reversing unpaid amount:`, error.message);
//             // Don't fail the entire deletion if unpaid reversal fails
//           }
//         }

//         // -----------------------------------------------------------------------
//         // 6️⃣ Delete voucherdetails
//         // -----------------------------------------------------------------------
//         await queryPromise(
//           connection,
//           "DELETE FROM voucherdetails WHERE voucher_id = ?",
//           [voucherId]
//         );

//         // -----------------------------------------------------------------------
//         // 7️⃣ Delete voucher record
//         // -----------------------------------------------------------------------
//         await queryPromise(
//           connection,
//           "DELETE FROM voucher WHERE VoucherID = ?",
//           [voucherId]
//         );

//         // -----------------------------------------------------------------------
//         // 8️⃣ Commit transaction
//         // -----------------------------------------------------------------------
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

          
//           console.log("✔ Transaction deleted & stock reversed successfully");

//           let message = "Invoice deleted successfully";
//           if (transactionType === "stock inward") {
//             message = "Stock inward transaction deleted & stock reversed";
//           } else if (transactionType === "stock transfer") {
//             message = "Stock transfer deleted & stock reversed";
//           } else {
//             message = `${transactionType} deleted & stock reversed successfully`;
//           }

//           res.send({
//             success: true,
//             message,
//             voucherId,
//             transactionType,
//             stockReverted: true,
//             orderReverted: voucherData.order_number ? true : false,
//             unpaidReverted: voucherData.PartyID ? true : false
//           });
//         });
//       } catch (error) {
//         console.error("❌ Error deleting transaction:", error);

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



// // 19-11
// // Get transaction by ID - Single API endpoint
// router.get("/transactions/:id", (req, res) => {
//   const voucherId = req.params.id;

//   const query = `
//     SELECT 
//       v.*, 
//       a.business_name,
//       a.email,
//       a.mobile_number,
//       a.gstin,
//       a.billing_address_line1,
//       a.billing_address_line2,
//       a.billing_city,
//       a.billing_state,
//       a.billing_country,
//       a.billing_pin_code,
//       a.shipping_address_line1,
//       a.shipping_address_line2,
//       a.shipping_city,
//       a.shipping_state,
//       a.shipping_country,
//       a.shipping_pin_code
//     FROM voucher v
//     LEFT JOIN accounts a ON v.PartyID = a.id
//     WHERE v.VoucherID = ?
//   `;

//   db.query(query, [voucherId], (err, results) => {
//     if (err) {
//       console.error("Error fetching transaction:", err);
//       return res.status(500).json({
//         success: false,
//         message: "Database error fetching transaction",
//         error: err.message,
//       });
//     }

//     if (results.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Transaction not found",
//       });
//     }

//     const transaction = results[0];

//     // Fetch batch details
//     const detailsQuery = `
//       SELECT 
//         product, 
//         product_id, 
//         batch, 
//         quantity, 
//         price, 
//         discount, 
//         gst, 
//         cgst, 
//         sgst, 
//         igst, 
//         cess, 
//         total
//       FROM voucherdetails
//       WHERE voucher_id = ?
//     `;

//     db.query(detailsQuery, [voucherId], (detailsErr, detailsResults) => {
//       if (detailsErr) {
//         console.error("Error fetching batch details:", detailsErr);
//         return res.status(500).json({
//           success: false,
//           message: "Database error fetching batch details",
//           error: detailsErr.message,
//         });
//       }

//       // Combine all data
//       const responseData = {
//         ...transaction,
//         batch_details: detailsResults || [],
//         items: detailsResults || [] // Add items for compatibility
//       };

//       res.json({
//         success: true,
//         data: responseData,
//       });
//     });
//   });
// });


// router.get("/transactions", (req, res) => {

//   // Fetch vouchers + customer details
//   const voucherQuery = `
//     SELECT 
//       v.*,
//       a.business_name,
//       a.email,
//       a.mobile_number,
//       a.gstin,
//       a.billing_address_line1,
//       a.billing_address_line2,
//       a.billing_city,
//       a.billing_state,
//       a.billing_country,
//       a.billing_pin_code,
//       a.shipping_address_line1,
//       a.shipping_address_line2,
//       a.shipping_city,
//       a.shipping_state,
//       a.shipping_country,
//       a.shipping_pin_code
//     FROM voucher v
//     LEFT JOIN accounts a ON v.PartyID = a.id
//     ORDER BY v.VoucherID DESC
//   `;

//   db.query(voucherQuery, (err, vouchers) => {
//     if (err) {
//       console.error("Error fetching vouchers:", err);
//       return res.status(500).send(err);
//     }

//     // Fetch all voucherdetails (line items)
//     const detailsQuery = `
//       SELECT 
//         vd.*,
//         p.goods_name,
//         p.unit
//       FROM voucherdetails vd
//       LEFT JOIN products p ON vd.product_id = p.id
//     `;

//     db.query(detailsQuery, (err, details) => {
//       if (err) {
//         console.error("Error fetching voucher details:", err);
//         return res.status(500).send(err);
//       }

//       // Group details by voucher_id
//       const detailsByVoucher = {};
//       details.forEach(row => {
//         if (!detailsByVoucher[row.voucher_id]) {
//           detailsByVoucher[row.voucher_id] = [];
//         }
//         detailsByVoucher[row.voucher_id].push(row);
//       });

//       // Attach details to each voucher
//       const finalResult = vouchers.map(v => {
//         const vDetails = detailsByVoucher[v.VoucherID] || [];

//         return {
//           ...v,
//           items: vDetails,
//           totalItems: vDetails.length,
//           totalQuantity: vDetails.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0),
//           totalAmount: vDetails.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0)
//         };
//       });

//       res.send(finalResult);
//     });
//   });
// });

// router.get('/invoices/:invoiceNumber', async (req, res) => {
//   let connection;

//   try {
//     connection = await new Promise((resolve, reject) => {
//       db.getConnection((err, conn) => {
//         if (err) reject(err);
//         else resolve(conn);
//       });
//     });

//     const { invoiceNumber } = req.params;

//     const query = `
//       SELECT 
//         v.VoucherID,
//         v.TransactionType,
//         v.VchNo,
//         v.product_id,
//         v.batch_id,
//         v.InvoiceNumber,
//         v.Date,
//         v.PaymentTerms,
//         v.Freight,
//         v.TotalPacks,
//         v.TaxAmount,
//         v.Subtotal,
//         v.assigned_staff,
//         v.BillSundryAmount,
//         v.TotalAmount,
//         v.ChequeNo,
//         v.ChequeDate,
//         v.BankName,
//         v.AccountID,
//         v.AccountName,
//         v.business_name,
//         v.PartyID,
//         a.name AS PartyName,
//         v.BasicAmount,
//         v.ValueOfGoods,
//         v.EntryDate,
//         v.SGSTPercentage,
//         v.CGSTPercentage,
//         v.IGSTPercentage,
//         v.SGSTAmount,
//         v.CGSTAmount,
//         v.IGSTAmount,
//         v.TaxSystem,
//         v.paid_amount,
//         v.created_at,
//         v.balance_amount,
//         v.status,
//         v.paid_date,
//         v.pdf_data,
//         v.DC,
//         v.pdf_file_name,
//         v.pdf_created_at
//       FROM voucher v
//       LEFT JOIN accounts a ON v.PartyID = a.id
//       WHERE v.InvoiceNumber = ?
//       ORDER BY 
//         CASE 
//           WHEN v.TransactionType = 'Sales' THEN 1
//           WHEN v.TransactionType = 'Receipt' THEN 2
//           WHEN v.TransactionType = 'CreditNote' THEN 3
//           WHEN v.TransactionType = 'purchase voucher' THEN 4
//           WHEN v.TransactionType = 'Purchase' THEN 5
//           WHEN v.TransactionType = 'stock transfer' THEN 5
//                    WHEN v.TransactionType = 'stock inward' THEN 6
 
//           ELSE 6
//         END,
//         v.created_at ASC
//     `;

//     const vouchers = await new Promise((resolve, reject) => {
//       connection.execute(query, [invoiceNumber], (err, results) => {
//         if (err) reject(err);
//         else resolve(results);
//       });
//     });

//     if (vouchers.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Invoice not found"
//       });
//     }

//     const voucherIDs = vouchers.map(v => v.VoucherID);

//     // Load line items from voucherdetails
//     const itemQuery = `
//       SELECT 
//         vd.*,
//         p.goods_name,
//         p.unit
//       FROM voucherdetails vd
//       LEFT JOIN products p ON p.id = vd.product_id
//       WHERE vd.voucher_id IN (?)
//     `;

//     const items = await new Promise((resolve, reject) => {
//       connection.query(itemQuery, [voucherIDs], (err, results) => {
//         if (err) reject(err);
//         else resolve(results);
//       });
//     });

//     const groupedItems = {};
//     voucherIDs.forEach(id => groupedItems[id] = []);
//     items.forEach(i => groupedItems[i.voucher_id].push(i));

//     vouchers.forEach(v => {
//       v.items = groupedItems[v.VoucherID] || [];
//     });

//     // Build categorized response
//     res.json({
//       success: true,
//       data: {
//         sales: vouchers.find(v => v.TransactionType === "Sales") || null,
//         receipts: vouchers.filter(v => v.TransactionType === "Receipt"),
//         creditnotes: vouchers.filter(v => v.TransactionType === "CreditNote"),
//         purchases: vouchers.filter(v => v.TransactionType === "Purchase"),
//         purchasevoucher: vouchers.filter(v => v.TransactionType === "purchase voucher"),
//          stocktransfer: vouchers.find(v => v.TransactionType === "stock transfer") || null, // ADD THIS
//         allEntries: vouchers
//       }
//     });

//   } catch (err) {
//     console.error("Error fetching invoice:", err);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: err.message
//     });
//   } finally {
//     if (connection) connection.release();
//   }
// });




// router.get("/last-invoice", (req, res) => {
//   const query = "SELECT VchNo FROM voucher WHERE TransactionType IN ('Sales', 'stock transfer') ORDER BY VoucherID DESC LIMIT 1";

//   db.query(query, (err, results) => {
//     if (err) {
//       console.error('Error fetching last invoice number:', err);
//       return res.status(500).send(err);
//     }

//     if (results.length === 0) {
//       return res.send({ lastInvoiceNumber: null });
//     }

//     res.send({ lastInvoiceNumber: results[0].VchNo });
//   });
// });


// router.put("/transactions/:id", async (req, res) => {
//   const voucherId = req.params.id;
//   const updateData = req.body;

//   console.log("👤 UPDATE - Staff Data Received:", {
//     staffid: updateData.selectedStaffId,
//     assigned_staff: updateData.assigned_staff
//   });

//   db.getConnection((err, connection) => {
//     if (err) return res.status(500).send({ error: "Database connection failed" });

//     connection.beginTransaction(async (err) => {
//       if (err)
//         return res.status(500).send({ error: "Transaction failed to start" });

//       try {
//         // 1️⃣ FETCH ORIGINAL VOUCHER
//         const originalVoucher = await queryPromise(
//           connection,
//           "SELECT * FROM voucher WHERE VoucherID = ?",
//           [voucherId]
//         );

//         if (originalVoucher.length === 0)
//           throw new Error("Transaction not found");

//         const originalTransactionType =
//           originalVoucher[0].TransactionType || "Sales";

//         console.log("🔎 Original transaction:", originalTransactionType);

//         // Fetch batch details from voucherdetails table
//         let originalBatchDetails = [];
//         try {
//           const voucherDetails = await queryPromise(
//             connection,
//             "SELECT * FROM voucherdetails WHERE voucher_id = ?",
//             [voucherId]
//           );
//           originalBatchDetails = voucherDetails.map(detail => ({
//             product: detail.product,
//             product_id: detail.product_id,
//             batch: detail.batch,
//             quantity: detail.quantity,
//             price: detail.price,
//             discount: detail.discount,
//             gst: detail.gst,
//             cgst: detail.cgst,
//             sgst: detail.sgst,
//             igst: detail.igst,
//             cess: detail.cess,
//             total: detail.total
//           }));
//         } catch {
//           originalBatchDetails = [];
//         }

//         // -------------------------------------------------------------------
//         // 2️⃣ REVERSE OLD STOCK (UNDO original stock effect)
//         // -------------------------------------------------------------------
//         for (const item of originalBatchDetails) {
//           if (!item.batch || !item.product_id) continue;

//           console.log("♻️ Reversing:", originalTransactionType, item);

//           // First, check current batch stock
//           const batchCheck = await queryPromise(
//             connection,
//             "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch]
//           );

//           if (batchCheck.length === 0) {
//             console.warn(`⚠️ Batch ${item.batch} not found during reversal - creating it`);
            
//             // Create the batch if it doesn't exist
//             await queryPromise(
//               connection,
//               `INSERT INTO batches 
//                (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
//                VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
//               [item.product_id, item.batch]
//             );
//             console.log(`✔ Created missing batch: ${item.batch}`);
//           }

//           // Re-fetch batch data after potential creation
//           const updatedBatchCheck = await queryPromise(
//             connection,
//             "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch]
//           );

//           const currentQuantity = parseFloat(updatedBatchCheck[0].quantity);
//           const currentStockOut = parseFloat(updatedBatchCheck[0].stock_out);
//           const currentStockIn = parseFloat(updatedBatchCheck[0].stock_in);
//           const itemQuantity = parseFloat(item.quantity);

//           // Check if transaction adds stock (Purchase, CreditNote, stock inward) or removes stock (Sales, DebitNote, stock transfer)
//           const isStockInTransaction = originalTransactionType === "Purchase" || 
//                                        originalTransactionType === "CreditNote" || 
//                                        originalTransactionType === "stock inward";
          
//           if (isStockInTransaction) {
//             // Reverse stock addition: subtract from quantity and stock_in
//             if (currentQuantity < itemQuantity) {
//               console.warn(`⚠️ Insufficient stock for reversal in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}. Adjusting...`);
              
//               const finalQuantity = Math.max(0, currentQuantity - itemQuantity);
//               const finalStockIn = Math.max(0, currentStockIn - itemQuantity);
              
//               await queryPromise(
//                 connection,
//                 "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
//                 [finalQuantity, finalStockIn, item.product_id, item.batch]
//               );
//             } else {
//               await queryPromise(
//                 connection,
//                 "UPDATE batches SET quantity = quantity - ?, stock_in = stock_in - ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
//                 [itemQuantity, itemQuantity, item.product_id, item.batch]
//               );
//             }

//             console.log(`✔ Reversed ${originalTransactionType} for batch ${item.batch}`);

//           } else {
//             // Reverse stock removal: add back to quantity and subtract from stock_out
//             if (currentStockOut < itemQuantity) {
//               console.warn(`⚠️ stock_out less than reversal quantity in batch ${item.batch}. Current: ${currentStockOut}, Required: ${item.quantity}. Adjusting...`);
              
//               const finalStockOut = Math.max(0, currentStockOut - itemQuantity);
              
//               await queryPromise(
//                 connection,
//                 "UPDATE batches SET quantity = quantity + ?, stock_out = ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
//                 [itemQuantity, finalStockOut, item.product_id, item.batch]
//               );
//             } else {
//               await queryPromise(
//                 connection,
//                 "UPDATE batches SET quantity = quantity + ?, stock_out = stock_out - ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
//                 [itemQuantity, itemQuantity, item.product_id, item.batch]
//               );
//             }

//             console.log(`✔ Reversed ${originalTransactionType} for batch ${item.batch}`);
//           }
//         }

//         await queryPromise(
//           connection,
//           "DELETE FROM voucherdetails WHERE voucher_id = ?",
//           [voucherId]
//         );

//         let newBatchDetails = [];
//         if (updateData.batchDetails) {
//           newBatchDetails = Array.isArray(updateData.batchDetails)
//             ? updateData.batchDetails
//             : JSON.parse(updateData.batchDetails || "[]");
//         }

//         let vchNo = updateData.invoiceNumber || originalVoucher[0].VchNo;
//         let invoiceNumber =
//           updateData.invoiceNumber || originalVoucher[0].InvoiceNumber;

//         // 🔥 UPDATED: Include staff fields in the UPDATE query
//         await queryPromise(
//           connection,
//           `UPDATE voucher 
//            SET VchNo = ?, InvoiceNumber = ?, Date = ?, PartyName = ?, 
//                BasicAmount = ?, TaxAmount = ?, TotalAmount = ?,
//                staffid = ?, assigned_staff = ?  -- 🔥 NEW STAFF FIELDS
//            WHERE VoucherID = ?`,
//           [
//             vchNo,
//             invoiceNumber,
//             updateData.invoiceDate || originalVoucher[0].Date,
//             updateData.supplierInfo?.name || originalVoucher[0].PartyName,
//             parseFloat(updateData.taxableAmount) ||
//             parseFloat(originalVoucher[0].BasicAmount),
//             parseFloat(updateData.totalGST) ||
//             parseFloat(originalVoucher[0].TaxAmount),
//             parseFloat(updateData.grandTotal) ||
//             parseFloat(originalVoucher[0].TotalAmount),
//             // 🔥 NEW: Staff data
//             updateData.selectedStaffId || updateData.staffid || originalVoucher[0].staffid,
//             updateData.assigned_staff || originalVoucher[0].assigned_staff,
//             voucherId,
//           ]
//         );

//         console.log("✅ Staff data updated in voucher:", {
//           staffid: updateData.selectedStaffId || updateData.staffid,
//           assigned_staff: updateData.assigned_staff
//         });

//         // -------------------------------------------------------------------
//         // INSERT NEW voucherDetails
//         // -------------------------------------------------------------------
//         for (const item of newBatchDetails) {
//           await queryPromise(
//             connection,
//             `INSERT INTO voucherdetails 
//               (voucher_id, product, product_id, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total)
//              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//             [
//               voucherId,
//               item.product || "",
//               item.product_id || "",
//               invoiceNumber,
//               item.batch || "",
//               parseFloat(item.quantity) || 0,
//               parseFloat(item.price) || 0,
//               parseFloat(item.discount) || 0,
//               parseFloat(item.gst) || 0,
//               parseFloat(item.cgst) || 0,
//               parseFloat(item.sgst) || 0,
//               parseFloat(item.igst) || 0,
//               parseFloat(item.cess) || 0,
//               parseFloat(item.total) || 0,
//             ]
//           );
//         }

//         // -------------------------------------------------------------------
//         // 4️⃣ APPLY **NEW** STOCK CHANGES (WITH BATCH CREATION IF NEEDED)
//         // -------------------------------------------------------------------
//         for (const item of newBatchDetails) {
//           if (!item.batch || !item.product_id) continue;

//           const itemQuantity = parseFloat(item.quantity);

//           // Check if batch exists before applying changes
//           const batchExists = await queryPromise(
//             connection,
//             "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch]
//           );

//           // If batch doesn't exist, create it first
//           if (batchExists.length === 0) {
//             console.log(`➕ Creating new batch: ${item.batch} for product ${item.product_id}`);
            
//             await queryPromise(
//               connection,
//               `INSERT INTO batches 
//                (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
//                VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
//               [item.product_id, item.batch]
//             );
//             console.log(`✔ Created new batch: ${item.batch}`);
//           }

//           const currentBatch = await queryPromise(
//             connection,
//             "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
//             [item.product_id, item.batch]
//           );

//           const currentQuantity = parseFloat(currentBatch[0].quantity);

//           const isStockInTransaction = originalTransactionType === "Purchase" || 
//                                        originalTransactionType === "CreditNote" || 
//                                        originalTransactionType === "stock inward";
          
//           if (isStockInTransaction) {
//             await queryPromise(
//               connection,
//               "UPDATE batches SET quantity = quantity + ?, stock_in = stock_in + ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
//               [itemQuantity, itemQuantity, item.product_id, item.batch]
//             );

//             console.log(`✔ ${originalTransactionType} applied - added stock to batch ${item.batch}`);

//           } else {
//             if (currentQuantity < itemQuantity) {
//               throw new Error(
//                 `Insufficient quantity for ${originalTransactionType} update in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}`
//               );
//             }

//             await queryPromise(
//               connection,
//               "UPDATE batches SET quantity = quantity - ?, stock_out = stock_out + ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
//               [itemQuantity, itemQuantity, item.product_id, item.batch]
//             );

//             console.log(`✔ ${originalTransactionType} applied - reduced stock from batch ${item.batch}`);
//           }
//         }

//         // -------------------------------------------------------------------
//         // COMMIT TRANSACTION
//         // -------------------------------------------------------------------
//         connection.commit((commitErr) => {
//           if (commitErr) {
//             return connection.rollback(() => {
//               connection.release();
//               res.status(500).send({ error: commitErr.message });
//             });
//           }

//           connection.release();
//           res.json({
//             success: true,
//             message: "Transaction updated successfully",
//             voucherId,
//             staffid: updateData.selectedStaffId || updateData.staffid,
//             assigned_staff: updateData.assigned_staff
//           });
//         });
//       } catch (err) {
//         console.error("❌ Error:", err);

//         connection.rollback(() => {
//           connection.release();
//           res.status(500).json({ success: false, message: err.message });
//         });
//       }
//     });
//   });
// });
// router.get("/ledger", (req, res) => {
//   // Fetch all vouchers ordered by PartyID and Date
//   const query = `
//     SELECT 
//       VoucherID AS id,
//       VchNo AS voucherID,
//       Date AS date,
//       TransactionType AS trantype,
//       AccountID,
//       AccountName,
//       PartyID,
//       PartyName,
//       paid_amount AS Pamount,
//       TotalAmount AS Amount,
//       DC,
//       balance_amount,
//       created_at
//     FROM voucher
//     WHERE PartyID IS NOT NULL
//     ORDER BY PartyID, Date ASC, VoucherID ASC
//   `;

//   db.query(query, (err, results) => {
//     if (err) {
//       console.error("Error fetching voucher data:", err);
//       return res.status(500).json({ message: "Database error", error: err });
//     }

//     console.log("Transaction types found:", [...new Set(results.map(r => r.trantype))]);
    
//     const dataWithRecalculatedBalances = recalculateRunningBalances(results);

//     res.status(200).json(dataWithRecalculatedBalances);
//   });
// });

// function recalculateRunningBalances(transactions) {
//   const parties = {};

//   transactions.forEach(transaction => {
//     const partyId = transaction.PartyID;
    
//     if (!partyId) return; 
    
//     if (!parties[partyId]) {
//       parties[partyId] = {
//         PartyID: partyId,
//         PartyName: transaction.PartyName,
//         transactions: []
//       };
//     }
    
//     parties[partyId].transactions.push(transaction);
//   });

//   const results = [];

//   // Calculate running balance for each party
//   Object.keys(parties).forEach(partyId => {
//     let runningBalance = 0;
//     const partyData = parties[partyId];
//     const partyTransactions = partyData.transactions;

//     // Sort transactions by date and voucher ID
//     partyTransactions.sort((a, b) => {
//       const dateA = new Date(a.date);
//       const dateB = new Date(b.date);
//       if (dateA.getTime() !== dateB.getTime()) {
//         return dateA.getTime() - dateB.getTime();
//       }
//       return a.id - b.id;
//     });

//     // Process each transaction for this party
//     partyTransactions.forEach(transaction => {
//       const amount = parseFloat(transaction.Amount) || 0;
//       const trantype = transaction.trantype;
      
  
      
//       if (trantype === 'Purchase') {
//         runningBalance += amount; 
//         transaction.DC = 'C'; // Ensure DC is 'C' for Purchase
//       } 
//       else if (trantype === 'purchase voucher' || trantype === 'DebitNote') {
//         runningBalance -= amount; 
//         transaction.DC = 'D'; 
//       }
//       else {
//         // For other transaction types, use the DC from database
//         if (transaction.DC === 'D') {
//           runningBalance -= amount;
//         } else if (transaction.DC === 'C') {
//           runningBalance += amount;
//         }
//       }

//       // Add to results with recalculated balance
//       results.push({
//         ...transaction,
//         balance_amount: runningBalance.toFixed(2)
//       });
//     });
//   });

//   // Sort final results by PartyID and date
//   return results.sort((a, b) => {
//     if (a.PartyID !== b.PartyID) {
//       return a.PartyID - b.PartyID;
//     }
    
//     const dateA = new Date(a.date);
//     const dateB = new Date(b.date);
//     if (dateA.getTime() !== dateB.getTime()) {
//       return dateA.getTime() - dateB.getTime();
//     }
    
//     return a.id - b.id;
//   });
// }

// router.post("/transaction", (req, res) => {
//   const transactionData = req.body;
//   console.log('📦 ALL RECEIVED DATA:', transactionData);

//   // Determine transaction type
//   let transactionType = transactionData.TransactionType || "";
//  const dataType = transactionData.data_type || null; 
//   const normalizedType = transactionType.toLowerCase().trim();
  
//   const orderNumber = transactionData.orderNumber || transactionData.order_number || null;
  
//   if ((normalizedType === "stock transfer" || normalizedType === "stocktransfer") && orderNumber) {
//     console.log("🔄 Stock Transfer detected with order number");
//     transactionType = "stock transfer"; // Keep as stock transfer
//   } else if ((normalizedType === "stock transfer") && !orderNumber) {
//     console.log("⚠️ Stock Transfer specified but no order number - Reverting to Sales");
//     transactionType = "stock transfer";
//   } else if (normalizedType === "stock inward") {
//     console.log("📥 Stock Inward transaction detected");
//     transactionType = "stock inward";
//   }

//   console.log("Processing as:", transactionType);
//   console.log("Order Number:", orderNumber);

//   db.getConnection((err, connection) => {
//     if (err) {
//       console.error("DB Connection Error:", err);
//       return res.status(500).send({ error: "Database connection failed" });
//     }

//     connection.beginTransaction(async (err) => {
//       if (err) {
//         connection.release();
//         console.error("Begin Transaction Error:", err);
//         return res.status(500).send({ error: "Transaction failed" });
//       }

//       try {
//         const result = await processTransaction(
//           transactionData,
//           transactionType,
//           connection,
//            dataType // Pass dataType (could be null)
//         );

//         const { voucherId, invoiceNumber, vchNo, batchDetails, grandTotal } = result;

//      connection.commit(async (commitErr) => {     // ← Add async here!
//     if (commitErr) {
//         console.error("Commit Error:", commitErr);

//         return connection.rollback(() => {
//             connection.release();
//             res.status(500).send({
//                 error: "Transaction commit failed",
//                 details: commitErr.message,
//             });
//         });
//     }

//     connection.release();

// try {
//     const normalizedType = (transactionType || "")
//         .toLowerCase()
//         .trim()
//         .replace(/\s+/g, " ");

//     if (
//         orderNumber &&
//         (normalizedType === "sales" || normalizedType === "stock transfer")
//     ) {
//         const mobile =
//             transactionData.fullAccountDetails?.mobile_number || null;

//         if (!mobile) {
//             console.log(`No mobile number for order ${orderNumber}`);
//             return;
//         }

//         const cleanMobile = mobile.toString().replace(/\D/g, "");

//         if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
//             console.log(`Invalid mobile number: ${cleanMobile}`);
//             return;
//         }

//         // 🔥 EXACT TEMPLATE MESSAGE (VARIABLES REPLACED)
//         const smsMessage =
// `Your invoice ${invoiceNumber} for order #${orderNumber} is ready.
// Total Amount: ${grandTotal} - SHREE SHASHWATRAJ AGRO PRIVATE LIMITED`;

//         const smsResponse = await axios.get(
//             "https://www.smsjust.com/blank/sms/user/urlsms.php",
//             {
//                 params: {
//                     username: process.env.SMS_USERNAME,
//                     pass: process.env.SMS_PASSWORD,
//                     senderid: process.env.SMS_SENDERID,
//                     dest_mobileno: cleanMobile,
//                     message: smsMessage, // ✅ THIS IS REQUIRED
//                     dltentityid: process.env.SMS_ENTITYID,
//                     dlttempid: process.env.SMS_INVOICEREADYTEMPLATEID,
//                     response: "y"
//                 }
//             }
//         );

//         console.log(`✅ SMS SENT to ${cleanMobile}`);
//         console.log("SMSJust response:", smsResponse.data);
//     }
// } catch (err) {
//     console.error("❌ SMS failed (non-blocking):", err.message);
// }



//           let message =
//             transactionType === "CreditNote"
//               ? "Credit Note created"
//               : transactionType === "Purchase"
//               ? "Purchase Transaction completed"
//               : transactionType === "DebitNote"
//               ? "Debit Note created"
//               : transactionType === "stock transfer"
//               ? "Stock Transfer completed"
//               : transactionType === "stock inward"
//               ? "Stock Inward completed"
//               : "Sales Transaction completed";

//           res.send({
//             success: true,
//             message,
//             voucherId,
//             invoiceNumber,
//             vchNo,
//             items: batchDetails,
//           });
//         });
//       } catch (error) {
//         console.error("Transaction Error:", error);

//         connection.rollback(() => {
//           connection.release();

//           res.status(500).send({
//             error: `${transactionType} transaction failed`,
//             details: error.message,
//           });
//         });
//       }
//     });
//   });
// });

// const processTransaction = async (transactionData, transactionType, connection, dataType ) => {
//   const maxIdResult = await queryPromise(
//     connection,
//     "SELECT COALESCE(MAX(VoucherID),0)+1 AS nextId FROM voucher"
//   );
//   const nextVoucherId = maxIdResult[0].nextId;

//   const orderMode = (transactionData.order_mode || transactionData.orderMode || "").toUpperCase();
//   const isKacha = orderMode === "KACHA";
  
//   console.log(`📊 Order Mode from request: ${orderMode}, Is Kacha: ${isKacha}`);

//   const staffIncentive = parseFloat(transactionData.staff_incentive) || 
//                         parseFloat(transactionData.originalOrder?.staff_incentive) || 
//                         0;
  
//   console.log(`💰 Staff Incentive from request: ${staffIncentive}`);

//   let items = [];

//   let totalDiscount = 0;
//   let totalCreditCharge = 0;

//   if (Array.isArray(transactionData.items)) items = transactionData.items;
//   else if (Array.isArray(transactionData.batch_details)) items = transactionData.batch_details;
//   else if (Array.isArray(transactionData.batchDetails)) items = transactionData.batchDetails;
//   else items = [];

//   // Process items
//   items = items.map((i) => {
//     const itemStaffIncentive = parseFloat(i.staff_incentive) || 0;
//     const quantity = parseFloat(i.quantity) || 1;

//     const discountAmount = parseFloat(i.discount_amount) || 0;
//     const creditCharge = parseFloat(i.credit_charge) || 0;
    
//     totalDiscount += discountAmount;  
//     totalCreditCharge += creditCharge;

//     if (isKacha) {
//       console.log(`🔄 Converting item ${i.product} to KACHA mode - removing GST`);
//       return {
//         product: i.product || "",
//         product_id: parseInt(i.product_id || i.productId) || null,
//         batch: i.batch || i.batch_number || "DEFAULT",
//         quantity: quantity,
//         price: parseFloat(i.price) || 0,
//         discount: parseFloat(i.discount) || 0,
//         discount_amount: discountAmount,
//         credit_charge: creditCharge,
//         gst: 0,
//         cgst: 0,
//         sgst: 0,
//         igst: 0,
//         cess: 0,
//         total: parseFloat(i.total) || (quantity * parseFloat(i.price)),
//         mfg_date: i.mfg_date || null,
//         staff_incentive: itemStaffIncentive
//       };
//     } else {
//       const gstPercentage = parseFloat(i.gst) || 0;
//       const cgstPercentageFromFrontend = parseFloat(i.cgst) || 0;
//       const sgstPercentageFromFrontend = parseFloat(i.sgst) || 0;
      
//       const cgstToStore = cgstPercentageFromFrontend * quantity;  
//       const sgstToStore = sgstPercentageFromFrontend * quantity;  
      
//       console.log(`📊 Item ${i.product}: Storing CGST=${cgstToStore}, SGST=${sgstToStore} (${cgstPercentageFromFrontend} × ${quantity})`);
      
//       return {
//         product: i.product || "",
//         product_id: parseInt(i.product_id || i.productId) || null,
//         batch: i.batch || i.batch_number || "DEFAULT",
//         quantity: quantity,
//         price: parseFloat(i.price) || 0,
//         discount: parseFloat(i.discount) || 0,
//         discount_amount: discountAmount,
//         credit_charge: creditCharge,
//         gst: gstPercentage,
//         cgst: cgstToStore, 
//         sgst: sgstToStore,  
//         igst: parseFloat(i.igst) || 0,
//         cess: parseFloat(i.cess) || 0,
//         total: parseFloat(i.total) || (quantity * parseFloat(i.price)),
//         mfg_date: i.mfg_date || null,
//         staff_incentive: itemStaffIncentive
//       };
//     }
//   });

//   const orderNumber = transactionData.orderNumber || transactionData.order_number || null;
//   console.log("🛒 Order Number from request:", orderNumber);

//   const selectedItemIds = transactionData.selectedItemIds || transactionData.selected_item_ids || [];
//   const hasItemSelection = selectedItemIds && selectedItemIds.length > 0;
  
//   console.log("📋 Has item selection:", hasItemSelection ? `Yes (${selectedItemIds.length} items)` : "No");

//   if (orderNumber && (transactionType === "Sales" || transactionType === "stock transfer")) {
//     console.log("✅ This is an order conversion. Updating order items and order status...");
    
//     const invoiceNumber = transactionData.InvoiceNumber || transactionData.invoiceNumber || `INV${Date.now()}`;
//     const invoiceDate = transactionData.Date || new Date().toISOString().split('T')[0];
    
//     try {
//       if (hasItemSelection && selectedItemIds.length > 0) {
//         const placeholders = selectedItemIds.map(() => '?').join(',');
//         const updateParams = [invoiceNumber, invoiceDate, orderNumber, ...selectedItemIds];
        
//         await queryPromise(
//           connection,
//           `
//           UPDATE order_items SET 
//             invoice_number = ?, 
//             invoice_date = ?, 
//             invoice_status = 1, 
//             updated_at = NOW()
//           WHERE order_number = ? 
//             AND id IN (${placeholders})
//           `,
//           updateParams
//         );
        
//         console.log(`✅ Updated ${selectedItemIds.length} selected items in order ${orderNumber} with invoice ${invoiceNumber}`);
        
//       } else {
//         await queryPromise(
//           connection,
//           `
//           UPDATE order_items SET 
//             invoice_number = ?, 
//             invoice_date = ?, 
//             invoice_status = 1, 
//             updated_at = NOW()
//           WHERE order_number = ?
//           `,
//           [invoiceNumber, invoiceDate, orderNumber]
//         );
        
//         const countResult = await queryPromise(
//           connection,
//           "SELECT COUNT(*) as count FROM order_items WHERE order_number = ?",
//           [orderNumber]
//         );
        
//         console.log(`✅ Updated ALL ${countResult[0].count} items in order ${orderNumber} with invoice ${invoiceNumber}`);
//       }
      
//       // Update orders table
//       console.log(`🔄 Updating order status in orders table for: ${orderNumber}`);
      
//       await queryPromise(
//         connection,
//         `
//         UPDATE orders SET 
//           order_status = 'Invoice',
//           invoice_number = ?,
//           invoice_date = ?,
//           invoice_status = 1,
//           updated_at = NOW()
//         WHERE order_number = ?
//         `,
//         [invoiceNumber, invoiceDate, orderNumber]
//       );
      
//       console.log(`✅ Order ${orderNumber} status updated to 'Invoiced' in orders table with invoice ${invoiceNumber}`);
      
//     } catch (error) {
//       if (error.code === 'ER_BAD_FIELD_ERROR') {
//         if (error.message.includes('updated_at')) {
//           console.log("ℹ️ 'updated_at' column not found, updating without it...");
          
//           if (hasItemSelection && selectedItemIds.length > 0) {
//             const placeholders = selectedItemIds.map(() => '?').join(',');
//             const updateParams = [invoiceNumber, invoiceDate, orderNumber, ...selectedItemIds];
            
//             await queryPromise(
//               connection,
//               `
//               UPDATE order_items SET 
//                 invoice_number = ?, 
//                 invoice_date = ?, 
//                 invoice_status = 1
//               WHERE order_number = ? 
//                 AND id IN (${placeholders})
//               `,
//               updateParams
//             );
//           } else {
//             await queryPromise(
//               connection,
//               `
//               UPDATE order_items SET 
//                 invoice_number = ?, 
//                 invoice_date = ?, 
//                 invoice_status = 1
//               WHERE order_number = ?
//               `,
//               [invoiceNumber, invoiceDate, orderNumber]
//             );
//           }
          
//           await queryPromise(
//             connection,
//             `
//             UPDATE orders SET 
//               order_status = 'Invoice',
//               invoice_number = ?,
//               invoice_date = ?,
//                invoice_status = 1
//             WHERE order_number = ?
//             `,
//             [invoiceNumber, invoiceDate, orderNumber]
//           );
          
//         } else if (error.message.includes('invoice_status')) {
//           console.log("ℹ️ 'invoice_status' column not found in orders table, updating without it...");
          
//           await queryPromise(
//             connection,
//             `
//             UPDATE orders SET 
//               order_status = 'Invoice',
//               invoice_number = ?,
//               invoice_date = ?
//             WHERE order_number = ?
//             `,
//             [invoiceNumber, invoiceDate, orderNumber]
//           );
//         }
//       } else {
//         console.error(`❌ Error updating order ${orderNumber}:`, error.message);
//         throw error;
//       }
//     }
//   }

//   let voucherBatchNumber = null;
  
//   if (items.length > 0 && items[0].batch) {
//     voucherBatchNumber = items[0].batch;
//     console.log(`✅ Using batch number for voucher table: ${voucherBatchNumber}`);
//   }

//   let invoiceNumber =
//     transactionData.InvoiceNumber ||
//     transactionData.invoiceNumber ||
//     "INV001";

//   let vchNo = invoiceNumber;

//   if (transactionType === "CreditNote") {
//     vchNo =
//       transactionData.VchNo ||
//       transactionData.vchNo ||
//       transactionData.creditNoteNumber ||
//       "CNOTE001";
//   }

//   if (transactionType === "DebitNote") {
//     vchNo =
//       transactionData.VchNo ||
//       transactionData.vchNo ||
//       transactionData.debitNoteNumber ||
//       "DNOTE001";
//   }

//   if (transactionType === "Purchase") {
//     vchNo =
//       transactionData.InvoiceNumber ||
//       transactionData.invoiceNumber ||
//       "PINV001";
//   }

//   if (transactionType === "stock transfer") {
//     vchNo =
//       transactionData.InvoiceNumber ||
//       transactionData.invoiceNumber ||
//       "ST001";
//   }

//   if (transactionType === "stock inward") {
//     vchNo =
//       transactionData.InvoiceNumber ||
//       transactionData.invoiceNumber ||
//       "SI001";
//   }

//   // TOTALS CALCULATION
//   let taxableAmount, totalGST, grandTotal;
  
//   if (isKacha) {
//     console.log("🔴 KACHA Order Mode Detected - Calculating totals without GST");
    
//     taxableAmount = parseFloat(transactionData.BasicAmount) ||
//                    parseFloat(transactionData.taxableAmount) ||
//                    parseFloat(transactionData.Subtotal) ||
//                    items.reduce((sum, i) => sum + i.total, 0);
    
//     totalGST = 0;
//     grandTotal = taxableAmount + totalCreditCharge;
    
//   } else {
//     taxableAmount = parseFloat(transactionData.BasicAmount) ||
//                     parseFloat(transactionData.taxableAmount) ||
//                     parseFloat(transactionData.Subtotal) ||
//                     items.reduce((sum, i) => sum + (i.quantity * i.price), 0);
    
//     totalGST = parseFloat(transactionData.TaxAmount) ||
//                parseFloat(transactionData.totalGST) ||
//                items.reduce((sum, i) => {
//                  const itemTotal = i.quantity * i.price;
//                  const discountAmount = itemTotal * (i.discount / 100);
//                  const amountAfterDiscount = itemTotal - discountAmount;
//                  return sum + (amountAfterDiscount * (i.gst / 100));
//                }, 0);
    
//     grandTotal = parseFloat(transactionData.TotalAmount) ||
//                  parseFloat(transactionData.grandTotal) ||
//                  taxableAmount + totalGST + totalCreditCharge;
//   }

//   console.log(`💰 Totals - Taxable: ${taxableAmount}, GST: ${totalGST}, Grand Total: ${grandTotal}`);
//   console.log(`💰 Staff Incentive: ${staffIncentive}`);

//   // ACCOUNT / PARTY DETAILS
//   const supplier = transactionData.supplierInfo || {};
//   const customer = transactionData.customerData || {};

//   let partyID =
//     supplier.party_id ||
//     customer.party_id ||
//     transactionData.PartyID ||
//     null;

//   let accountID =
//     supplier.account_id ||
//     customer.account_id ||
//     transactionData.AccountID ||
//     null;

//   const partyName =
//     supplier.name ||
//     supplier.business_name ||
//     customer.business_name ||
//     customer.name ||
//     transactionData.PartyName ||
//     "";

//   const account_name = transactionData.account_name ||  
//                      supplier.account_name ||          
//                      customer.account_name ||          
//                      transactionData.AccountName ||     
//                      "";

//   const business_name = transactionData.business_name || 
//                        supplier.business_name ||         
//                        customer.business_name ||        
//                        transactionData.businessName ||  
//                        "";

//   // VOUCHER DATA
//   const voucherData = {
//     VoucherID: nextVoucherId,
//     TransactionType: transactionType,
//       data_type: dataType, // This will be NULL if not provided
//     VchNo: vchNo,
//     InvoiceNumber: invoiceNumber,
//     order_number: orderNumber, 
//     order_mode: orderMode,
//     due_date: transactionData.due_date || null,
//     Date: transactionData.Date || new Date().toISOString().split("T")[0],
//     PaymentTerms: transactionData.PaymentTerms || "Immediate",
//     Freight: parseFloat(transactionData.Freight) || 0,
//     TotalPacks: items.length,
//     TaxAmount: totalGST,
//     Subtotal: taxableAmount,
//     BillSundryAmount: parseFloat(transactionData.BillSundryAmount) || 0,
//     TotalAmount: grandTotal,
//     paid_amount: parseFloat(transactionData.paid_amount) || grandTotal,
//     total_discount: totalDiscount,
//     total_credit_charge: totalCreditCharge,
//     AccountID: accountID,
//     AccountName: account_name,      
//     business_name: business_name,   
//     PartyID: partyID,
//       retailer_mobile: transactionData.customerInfo?.phone || 
//                   transactionData.fullAccountDetails?.mobile_number || 0,
                 
                
//     PartyName: partyName,
//     BasicAmount: taxableAmount,
//     ValueOfGoods: taxableAmount,
//     EntryDate: new Date(),
//     SGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.SGSTPercentage) || 0),
//     CGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.CGSTPercentage) || 0),
//     IGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.IGSTPercentage) || (items[0]?.igst || 0)),
//     SGSTAmount: isKacha ? 0 : (parseFloat(transactionData.SGSTAmount) || 0),
//     CGSTAmount: isKacha ? 0 : (parseFloat(transactionData.CGSTAmount) || 0),
//     IGSTAmount: isKacha ? 0 : (parseFloat(transactionData.IGSTAmount) || 0),
//     description_preview: transactionData.description_preview || 
//                         (transactionData.description ? 
//                          transactionData.description.substring(0, 200) : ''),
//     note_preview: transactionData.note_preview || 
//                  (transactionData.note ? transactionData.note.substring(0, 200) : ''),
//     TaxSystem: isKacha ? "KACHA_NO_GST" : (transactionData.TaxSystem || "GST"),
//     product_id: items[0]?.product_id || null,
//     batch_id: voucherBatchNumber,
//     DC: transactionType === "CreditNote" ? "C" : "D",
//     ChequeNo: transactionData.ChequeNo || "",
//     ChequeDate: transactionData.ChequeDate || null,
//     BankName: transactionData.BankName || "",
//     staffid: transactionData.staffid || null,
//     assigned_staff: transactionData.assigned_staff || null,
//     staff_incentive: staffIncentive,
//     created_at: new Date(),
//     balance_amount: parseFloat(transactionData.balance_amount) || 0,
//     status: transactionData.status || "active",
//     paid_date: transactionData.paid_date || null,
//     pdf_data: transactionData.pdf_data || null,
//     pdf_file_name: transactionData.pdf_file_name || null,
//     pdf_created_at: transactionData.pdf_created_at || null
//   };

//   console.log("🔍 DEBUG - Staff Incentive in voucher:", voucherData.staff_incentive);

//   // INSERT VOUCHER
//   await queryPromise(
//     connection,
//     "INSERT INTO voucher SET ?",
//     [voucherData]
//   );

//   // INSERT VOUCHER DETAILS
//   const insertDetailQuery = `
//     INSERT INTO voucherdetails (
//       voucher_id, product, product_id, transaction_type, InvoiceNumber,
//       batch, quantity, price, discount,
//       gst, cgst, sgst, igst, cess, total, created_at
//     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
//   `;

//   for (const i of items) {
//     const itemGST = isKacha ? 0 : i.gst;
//     const itemCGST = isKacha ? 0 : i.cgst;
//     const itemSGST = isKacha ? 0 : i.sgst;
//     const itemIGST = isKacha ? 0 : i.igst;
//     const itemCess = isKacha ? 0 : i.cess;
    
//     await queryPromise(connection, insertDetailQuery, [
//       nextVoucherId,
//       i.product,
//       i.product_id,
//       transactionType,
//       invoiceNumber,
//       i.batch,
//       i.quantity,
//       i.price,
//       i.discount,
//       itemGST,
//       itemCGST,
//       itemSGST,
//       itemIGST,
//       itemCess,
//       i.total,
//     ]);
//   }

//   // STOCK MANAGEMENT - For Sales and stock transfer transactions
//   for (const i of items) {
//     if (transactionType === "Sales" || transactionType === "DebitNote" || transactionType === "stock transfer") {
      
//       let remainingQuantity = i.quantity;
      
//       const specificBatch = i.batch || i.batch_number || i.batchNumber;
//       const shouldUseSpecificBatch = specificBatch && specificBatch !== "DEFAULT";
//       const isFromOrder = orderNumber;
      
//       console.log(`🔄 Stock Deduction - Order: ${isFromOrder ? 'Yes' : 'No'}, Batch: ${specificBatch || 'None'}, Qty: ${remainingQuantity}`);
      
//       if (shouldUseSpecificBatch) {
//         console.log(`🔍 Deducting from specific batch: ${specificBatch} for product ${i.product_id}`);
        
//         try {
//           const batchCheck = await queryPromise(
//             connection,
//             `
//             SELECT batch_number, quantity 
//             FROM batches 
//             WHERE product_id = ? 
//               AND batch_number = ? 
//               AND quantity >= ?
//             `,
//             [i.product_id, specificBatch, remainingQuantity]
//           );
          
//           if (batchCheck.length === 0) {
//             const batchExists = await queryPromise(
//               connection,
//               `
//               SELECT batch_number, quantity 
//               FROM batches 
//               WHERE product_id = ? 
//                 AND batch_number = ?
//               `,
//               [i.product_id, specificBatch]
//             );
            
//             if (batchExists.length === 0) {
//               throw new Error(`Batch ${specificBatch} not found for product ID ${i.product_id}`);
//             } else {
//               throw new Error(`Insufficient stock in batch ${specificBatch} for product ID ${i.product_id}. Available: ${batchExists[0].quantity}, Required: ${remainingQuantity}`);
//             }
//           }
          
//           await queryPromise(
//             connection,
//             `
//             UPDATE batches 
//               SET quantity = quantity - ?, 
//                   stock_out = stock_out + ?, 
//                   updated_at = NOW()
//             WHERE product_id = ? 
//               AND batch_number = ?
//             `,
//             [remainingQuantity, remainingQuantity, i.product_id, specificBatch]
//           );
          
//           console.log(`✅ Successfully deducted ${remainingQuantity} from batch ${specificBatch}`);
//           remainingQuantity = 0;
          
//         } catch (error) {
//           console.error(`❌ Error with specific batch ${specificBatch}:`, error.message);
//           throw error;
//         }
        
//       } else if (isFromOrder) {
//         // Order-based sale - use FIFO with mfg_date
//         console.log(`📦 Order-based sale - Using FIFO with MFG date for product ${i.product_id}`);
        
//         const batches = await queryPromise(
//           connection,
//           `
//           SELECT batch_number, quantity, mfg_date 
//           FROM batches 
//           WHERE product_id = ? 
//             AND quantity > 0 
//           ORDER BY mfg_date ASC
//           `,
//           [i.product_id]
//         );
        
//         console.log(`📊 Found ${batches.length} batches for product ${i.product_id}`);
        
//         if (batches.length === 0) {
//           throw new Error(`No stock available for product ID ${i.product_id}`);
//         }
        
//         for (const batch of batches) {
//           if (remainingQuantity <= 0) break;
          
//           const batchQtyAvailable = batch.quantity;
//           const batchNumber = batch.batch_number;
          
//           const deductQty = Math.min(remainingQuantity, batchQtyAvailable);
          
//           if (deductQty > 0) {
//             console.log(`➖ Deducting ${deductQty} from batch ${batchNumber} (MFG: ${batch.mfg_date})`);
            
//             await queryPromise(
//               connection,
//               `
//               UPDATE batches 
//                 SET quantity = quantity - ?, 
//                     stock_out = stock_out + ?, 
//                     updated_at = NOW()
//               WHERE product_id = ? 
//                 AND batch_number = ? 
//                 AND quantity >= ?
//               `,
//               [deductQty, deductQty, i.product_id, batchNumber, deductQty]
//             );
            
//             remainingQuantity -= deductQty;
//           }
//         }
        
//       } else {
//         // Regular sale (not from order)
//         console.log(`🛍️ Regular sale - Using any available stock for product ${i.product_id}`);
        
//         const batches = await queryPromise(
//           connection,
//           `
//           SELECT batch_number, quantity
//           FROM batches 
//           WHERE product_id = ? 
//             AND quantity > 0 
//           ORDER BY created_at ASC
//           `,
//           [i.product_id]
//         );
        
//         console.log(`📊 Found ${batches.length} batches for product ${i.product_id}`);
        
//         if (batches.length === 0) {
//           throw new Error(`No stock available for product ID ${i.product_id}`);
//         }
        
//         for (const batch of batches) {
//           if (remainingQuantity <= 0) break;
          
//           const batchQtyAvailable = batch.quantity;
//           const batchNumber = batch.batch_number;
          
//           const deductQty = Math.min(remainingQuantity, batchQtyAvailable);
          
//           if (deductQty > 0) {
//             console.log(`➖ Deducting ${deductQty} from batch ${batchNumber}`);
            
//             await queryPromise(
//               connection,
//               `
//               UPDATE batches 
//                 SET quantity = quantity - ?, 
//                     stock_out = stock_out + ?, 
//                     updated_at = NOW()
//               WHERE product_id = ? 
//                 AND batch_number = ? 
//                 AND quantity >= ?
//               `,
//               [deductQty, deductQty, i.product_id, batchNumber, deductQty]
//             );
            
//             remainingQuantity -= deductQty;
//           }
//         }
//       }
      
//       if (remainingQuantity > 0) {
//         throw new Error(`Insufficient stock for product ID ${i.product_id}. Required: ${i.quantity}, Fulfilled: ${i.quantity - remainingQuantity}, Shortage: ${remainingQuantity} units`);
//       }
      
//     } else if (transactionType === "Purchase" || transactionType === "CreditNote" || transactionType === "stock inward") {
//       // ADD STOCK LOGIC for Purchase, CreditNote, and stock inward
//       console.log(`➕ Adding ${i.quantity} to product ${i.product_id}, batch: ${i.batch || i.batch_number} (Transaction: ${transactionType})`);
      
//       const batchToUse = i.batch || i.batch_number || i.batchNumber || "DEFAULT";
      
//       // First check if batch exists
//       const batchCheck = await queryPromise(
//         connection,
//         `
//         SELECT batch_number FROM batches 
//         WHERE product_id = ? AND batch_number = ?
//         `,
//         [i.product_id, batchToUse]
//       );
      
//       if (batchCheck.length > 0) {
//         // Update existing batch
//         await queryPromise(
//           connection,
//           `
//           UPDATE batches 
//             SET quantity = quantity + ?, 
//                 stock_in = stock_in + ?, 
//                 updated_at = NOW()
//           WHERE product_id = ? AND batch_number = ?
//           `,
//           [i.quantity, i.quantity, i.product_id, batchToUse]
//         );
//         console.log(`📝 Updated existing batch ${batchToUse}`);
//       } else {
//         // Insert new batch
//         await queryPromise(
//           connection,
//           `
//           INSERT INTO batches (product_id, batch_number, quantity, stock_in, mfg_date, created_at, updated_at)
//           VALUES (?, ?, ?, ?, ?, NOW(), NOW())
//         `,
//           [i.product_id, batchToUse, i.quantity, i.quantity, i.mfg_date]
//         );
//         console.log(`📝 Created new batch ${batchToUse}`);
//       }
//     }
//   }

//   if ((transactionType === "Sales" || transactionType === "stock transfer" || transactionType === "stock inward") && partyID && orderNumber) {
//     console.log(`💰 UNPAID AMOUNT UPDATE - ${transactionType} with order number detected`);
//     console.log(`   PartyID: ${partyID}, TotalAmount: ${grandTotal}, Order Number: ${orderNumber}`);
    
//     try {
//       // Check if accounts table has unpaid_amount column
//       const tableCheck = await queryPromise(
//         connection,
//         "SHOW COLUMNS FROM accounts LIKE 'unpaid_amount'"
//       );
      
//       if (tableCheck.length === 0) {
//         console.warn("⚠️ 'unpaid_amount' column not found in accounts table.");
//       } else {
//         // First check if credit_limit column exists
//         const creditLimitCheck = await queryPromise(
//           connection,
//           "SHOW COLUMNS FROM accounts LIKE 'credit_limit'"
//         );
        
//         // Get current account data including credit_limit
//         let currentAccount;
//         if (creditLimitCheck.length > 0) {
//           currentAccount = await queryPromise(
//             connection,
//             "SELECT unpaid_amount, credit_limit FROM accounts WHERE id = ?",
//             [partyID]
//           );
//         } else {
//           currentAccount = await queryPromise(
//             connection,
//             "SELECT unpaid_amount FROM accounts WHERE id = ?",
//             [partyID]
//           );
//         }
        
//         if (currentAccount.length === 0) {
//           console.warn(`⚠️ Account with id ${partyID} not found in accounts table.`);
//         } else {
//           const currentUnpaid = parseFloat(currentAccount[0].unpaid_amount) || 0;
//           const newUnpaid = currentUnpaid + grandTotal;
          
//           // Check if balance_amount column exists
//           const balanceCheck = await queryPromise(
//             connection,
//             "SHOW COLUMNS FROM accounts LIKE 'balance_amount'"
//           );
          
//           let updateQuery, updateParams;
          
//           if (balanceCheck.length > 0 && creditLimitCheck.length > 0) {
//             // Both balance_amount and credit_limit columns exist
//             const creditLimit = parseFloat(currentAccount[0].credit_limit) || 0;
//             const newBalanceAmount = creditLimit - newUnpaid;
            
//             updateQuery = `
//             UPDATE accounts 
//             SET unpaid_amount = ?,
//                 balance_amount = ?,
//                 updated_at = NOW()
//             WHERE id = ?
//             `;
//             updateParams = [newUnpaid, newBalanceAmount, partyID];
            
//             const oldBalanceAmount = creditLimit - currentUnpaid;
//             console.log(`✅ BALANCE AMOUNT CALCULATED - Old: ${oldBalanceAmount}, New: ${newBalanceAmount}, Difference: -${grandTotal}`);
//           } else if (balanceCheck.length > 0 && creditLimitCheck.length === 0) {
//             // balance_amount exists but credit_limit doesn't - can't calculate balance
//             console.warn("⚠️ 'balance_amount' column exists but 'credit_limit' column not found. Cannot calculate balance.");
//             updateQuery = `
//             UPDATE accounts 
//             SET unpaid_amount = ?,
//                 updated_at = NOW()
//             WHERE id = ?
//             `;
//             updateParams = [newUnpaid, partyID];
//           } else {
//             // balance_amount column doesn't exist, update only unpaid_amount
//             updateQuery = `
//             UPDATE accounts 
//             SET unpaid_amount = ?,
//                 updated_at = NOW()
//             WHERE id = ?
//             `;
//             updateParams = [newUnpaid, partyID];
//             console.log("ℹ️ 'balance_amount' column not found. Only updating unpaid_amount.");
//           }
          
//           // Update the accounts table
//           await queryPromise(connection, updateQuery, updateParams);
          
//           console.log(`✅ UNPAID AMOUNT UPDATED IN ACCOUNTS TABLE`);
//           console.log(`   PartyID: ${partyID}`);
//           console.log(`   Previous Unpaid: ${currentUnpaid}`);
//           console.log(`   Added Amount: ${grandTotal}`);
//           console.log(`   New Unpaid: ${newUnpaid}`);
//         }
//       }
//     } catch (error) {
//       console.error(`❌ ERROR updating unpaid amount:`, error.message);
//     }

    
//   }

//   return {
//     voucherId: nextVoucherId,
//     invoiceNumber,
//     vchNo,
//     batchDetails: items,
//     taxableAmount,
//     totalGST,
//     totalDiscount,
//     totalCreditCharge,
//     grandTotal,
//     staffIncentive: staffIncentive,
//     orderNumber: orderNumber,
//     orderMode: orderMode,
//     isKacha: isKacha,
//     updatedItemCount: hasItemSelection ? selectedItemIds.length : 'all',
//     orderStatusUpdated: orderNumber ? true : false,
//     transactionType: transactionType
//   };


  
// };



// router.get("/voucherdetail", async (req, res) => {
//   try {
//     const query = `
//       SELECT 
//         MIN(vd.id) AS id,
//         vd.product,
//         vd.product_id,
//         vd.batch,
//         v.Date,
//         v.Subtotal,
//         v.order_mode,
//         v.PartyName AS retailer,  -- Renamed to retailer
//         v.staffid,
//         a.name AS assigned_staff,  -- Get staff name from accounts table
//         a.address AS staff_address,
//         SUM(vd.quantity) AS quantity,
//         SUM(vd.price) AS price,
//         SUM(vd.discount) AS discount,
//         SUM(vd.gst) AS gst,
//         SUM(vd.cgst) AS cgst,
//         SUM(vd.sgst) AS sgst,
//         SUM(vd.igst) AS igst,
//         SUM(vd.cess) AS cess,
//         SUM(vd.total) AS total,
//         MIN(vd.created_at) AS created_at,
//         MAX(vd.update_at) AS update_at,
//         GROUP_CONCAT(DISTINCT v.InvoiceNumber SEPARATOR ', ') AS InvoiceNumber,
//         GROUP_CONCAT(DISTINCT v.PartyName SEPARATOR ', ') AS PartyNames,
//         GROUP_CONCAT(DISTINCT vd.voucher_id) AS voucher_ids,
//         COUNT(*) AS transaction_count
//       FROM voucherdetails vd
      
//       LEFT JOIN voucher v 
//         ON vd.voucher_id = v.VoucherID

//       LEFT JOIN accounts a 
//         ON v.staffid = a.id   -- staff → accounts match
        
//       WHERE v.TransactionType = 'Sales'

//       GROUP BY 
//         vd.product_id, 
//         vd.batch, 
//         vd.product, 
//         v.PartyName, 
//         v.staffid, 
//         a.name,
//         a.address

//       ORDER BY created_at DESC
//     `;

//     db.query(query, (err, results) => {
//       if (err) {
//         console.error("Error fetching voucher details:", err);
//         return res.status(500).json({
//           success: false,
//           message: "Error fetching voucher details"
//         });
//       }

//       res.json({
//         success: true,
//         data: results,
//         totalCount: results.length
//       });
//     });
//   } catch (error) {
//     console.error("Error in voucherdetails API:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error"
//     });
//   }
// });



// router.get('/order/:order_number', async (req, res) => {
//     try {
//         const orderNumber = req.params.order_number;

//         if (!orderNumber) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Order number is required'
//             });
//         }

//         const query = `
//             SELECT 
//                 VoucherID, TransactionType, VchNo, product_id, batch_id, 
//                 batch_number, InvoiceNumber, order_number, Date, PaymentTerms, 
//                 Freight, TotalPacks, TaxAmount, Subtotal, BillSundryAmount, 
//                 TotalAmount, ChequeNo, ChequeDate, BankName, AccountID, 
//                 AccountName, PartyID, PartyName, BasicAmount, ValueOfGoods, 
//                 EntryDate, SGSTPercentage, CGSTPercentage, IGSTPercentage, 
//                 SGSTAmount, CGSTAmount, IGSTAmount, TaxSystem, paid_amount, 
//                 created_at, balance_amount, status, paid_date, pdf_data, 
//                 DC, staffid, assigned_staff, pdf_file_name, pdf_created_at, 
//                 note_preview, description_preview, order_mode
//             FROM voucher
//             WHERE order_number = ?
//             ORDER BY created_at DESC
//         `;

//         const results = await new Promise((resolve, reject) => {
//             db.query(query, [orderNumber], (err, rows) => {
//                 if (err) return reject(err);
//                 resolve(rows);
//             });
//         });

//         if (!results || results.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'No vouchers found for the given order number'
//             });
//         }

//         res.status(200).json({
//             success: true,
//             count: results.length,
//             data: results
//         });

//     } catch (error) {
//         console.error('Error fetching vouchers:', error.message);

//         res.status(500).json({
//             success: false,
//             message: 'Server error while fetching vouchers',
//             error: error.message
//         });
//     }
// });



// router.post('/orders/send-retailer-alert', async (req, res) => {
//   const {
//     order_number,
//     retailer_mobile,
//     retailer_id,
//     customer_name,
//     items_with_issues,
//     message
//   } = req.body;

//   try {
//     // 1. Update order status
//     db.query(
//       `UPDATE orders SET 
//         modification_required = 1,
//         modification_reason = 'Item out of stock',
//         order_status = 'Modification Required',
//         updated_at = NOW()
//        WHERE order_number = ?`,
//       [order_number],
//       (error) => {
//         if (error) console.error('Error updating order:', error);
//       }
//     );

//     // 2. Update order items
//     items_with_issues.forEach(item => {
//       const stock_status = item.shortage > 0 ? 'INSUFFICIENT_STOCK' : 'OUT_OF_STOCK';
      
//       db.query(
//         `UPDATE order_items SET 
//           stock_status = ?,
//           admin_approval = 'pending_modification',
//           updated_at = NOW()
//          WHERE order_number = ? 
//            AND product_id = ?`,
//         [stock_status, order_number, item.product_id],
//         (error) => {
//           if (error) console.error('Error updating item:', error);
//         }
//       );
//     });

//   const notificationMessage = items_with_issues
//   .map((item, index) =>
//     `${index + 1}. ${item.item_name}\n` +
//     `Ordered ${item.ordered_quantity}, Available ${item.available_quantity}, Shortage ${item.shortage} units`
//   )
//   .join('\n\n');


//     // 4. Store notification with retailer_id
//     db.query(
//       `INSERT INTO notifications SET 
//         user_type = 'RETAILER',
//         retailer_mobile = ?,
//         retailer_id = ?,
//         order_number = ?,
//         title = 'Order Modification Required',
//         message = ?,
//         created_at = NOW()`,
//       [retailer_mobile, retailer_id, order_number, notificationMessage],
//       (error, results) => {
//         if (error) {
//           console.error('Error creating notification:', error);
//           return res.status(500).json({ 
//             success: false, 
//             error: 'Failed to create notification' 
//           });
//         }

//         res.json({
//           success: true,
//           message: 'Alert sent to retailer successfully',
//           notification_id: results.insertId
//         });
//       }
//     );

//   } catch (error) {
//     console.error('Error sending retailer alert:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to send alert to retailer'
//     });
//   }
// });

// // 4. Get notifications by retailer_id
// router.get('/notifications/retailer-id/:retailer_id', async (req, res) => {
//   const { retailer_id } = req.params;

//   db.query(
//     `SELECT * FROM notifications 
//      WHERE retailer_id = ? 
//        AND user_type = 'RETAILER'
//        AND is_read = 0
//      ORDER BY created_at DESC`,
//     [retailer_id],
//     (error, notifications) => {
//       if (error) {
//         return res.status(500).json({
//           success: false,
//           error: 'Failed to fetch notifications'
//         });
//       }

//       res.json({
//         success: true,
//         notifications
//       });
//     }
//   );
// });


// router.put('/notifications/mark-read-by-order', async (req, res) => {
//   const { order_number, retailer_id } = req.body;

//   try {
//     await queryPromise(
//       db,
//       `UPDATE notifications SET is_read = 1 
//        WHERE order_number = ? 
//          AND retailer_id = ? 
//          AND is_read = 0`,
//       [order_number, retailer_id]
//     );

//     res.json({
//       success: true,
//       message: 'Notification marked as read'
//     });

//   } catch (error) {
//     console.error('Error marking notification as read:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to mark notification as read'
//     });
//   }
// });


// module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios'); // ADD THIS LINE

// Get next sales invoice number
router.get("/next-invoice-number", async (req, res) => {
  try {
    const query = `
      SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 4) AS UNSIGNED)) as maxNumber 
      FROM voucher 
      WHERE TransactionType IN ('Sales', 'stock transfer') 
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
        
        if (invoiceNumber) {
          // Find the original Sales voucher for this invoice
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
            data_type = ?
          WHERE VoucherID = ?
        `;

        // Get the tax amount from updateData or use original value
        const taxAmount = Number(updateData.TaxAmount) || originalVoucher.TaxAmount;
        const igstPercentage = Number(updateData.IGSTPercentage) || originalVoucher.IGSTPercentage || 0;
        
        const values = [
          updateData.VchNo ||
            updateData.creditNoteNumber ||
            originalVoucher.VchNo,

          voucherDate, // ✅ MySQL-safe datetime

          updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
          updateData.PartyName || originalVoucher.PartyName,

          Number(updateData.BasicAmount) || originalVoucher.BasicAmount,
          taxAmount, // Store TaxAmount in TaxAmount column
          Number(updateData.TotalAmount) || originalVoucher.TotalAmount,

          // Subtotal = BasicAmount
          Number(updateData.BasicAmount) || originalVoucher.Subtotal,

          0, // SGSTAmount - set to 0 for IGST
          0, // CGSTAmount - set to 0 for IGST
          taxAmount, // IGSTAmount - store TaxAmount here

          0, // SGSTPercentage - set to 0 for IGST
          0, // CGSTPercentage - set to 0 for IGST
          igstPercentage, // IGSTPercentage - store IGST percentage here

          Number(updateData.TotalAmount) || originalVoucher.paid_amount,

          updateData.data_type || originalVoucher.data_type || null,

          voucherId // ✅ FIXED: Using actual voucherId from request params
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
          "DebitNote";

        // 2️⃣ FETCH OLD VOUCHERDETAILS (to reverse stock)
        const oldDetails = await queryPromise(
          connection,
          "SELECT * FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

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

        const invoiceNumber = updateData.InvoiceNumber || originalVoucher.InvoiceNumber;
        
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

        // 5️⃣ UPDATE voucher TABLE (ONLY REAL FIELDS)
        
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
            data_type = ?
          WHERE VoucherID = ?`,
          [
            updateData.VchNo || updateData.creditNoteNumber || originalVoucher.VchNo,

            // ✅ FIXED DATETIME
            toMySQLDateTime(updateData.Date || originalVoucher.Date),

            updateData.InvoiceNumber || originalVoucher.InvoiceNumber,
            updateData.PartyName || originalVoucher.PartyName,

            Number(updateData.BasicAmount) || originalVoucher.BasicAmount,
            taxAmount, // Store in TaxAmount column
            Number(updateData.TotalAmount) || originalVoucher.TotalAmount,

            // Subtotal = BasicAmount
            Number(updateData.BasicAmount) || originalVoucher.Subtotal,

            // For IGST: Set SGST and CGST to 0
            hasIGST ? 0 : (Number(updateData.SGSTAmount) || originalVoucher.SGSTAmount || 0),
            hasIGST ? 0 : (Number(updateData.CGSTAmount) || originalVoucher.CGSTAmount || 0),
            // For IGST: Store tax amount in IGSTAmount
            hasIGST ? taxAmount : (Number(updateData.IGSTAmount) || originalVoucher.IGSTAmount || 0),

            // For IGST: Set SGST and CGST percentages to 0
            hasIGST ? 0 : (Number(updateData.SGSTPercentage) || originalVoucher.SGSTPercentage || 0),
            hasIGST ? 0 : (Number(updateData.CGSTPercentage) || originalVoucher.CGSTPercentage || 0),
            // Store IGST percentage
            hasIGST ? igstPercentage : (Number(updateData.IGSTPercentage) || originalVoucher.IGSTPercentage || 0),

            Number(updateData.TotalAmount) || originalVoucher.paid_amount,
            updateData.data_type || originalVoucher.data_type || null,

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
         stocktransfer: vouchers.find(v => v.TransactionType === "stock transfer") || null, // ADD THIS
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

  console.log("👤 UPDATE - Staff Data Received:", {
    staffid: updateData.selectedStaffId,
    assigned_staff: updateData.assigned_staff
  });

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
        // 2️⃣ REVERSE OLD STOCK (UNDO original stock effect)
        // -------------------------------------------------------------------
        for (const item of originalBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          console.log("♻️ Reversing:", originalTransactionType, item);

          // First, check current batch stock
          const batchCheck = await queryPromise(
            connection,
            "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          if (batchCheck.length === 0) {
            console.warn(`⚠️ Batch ${item.batch} not found during reversal - creating it`);
            
            // Create the batch if it doesn't exist
            await queryPromise(
              connection,
              `INSERT INTO batches 
               (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
               VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
              [item.product_id, item.batch]
            );
            console.log(`✔ Created missing batch: ${item.batch}`);
          }

          // Re-fetch batch data after potential creation
          const updatedBatchCheck = await queryPromise(
            connection,
            "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          const currentQuantity = parseFloat(updatedBatchCheck[0].quantity);
          const currentStockOut = parseFloat(updatedBatchCheck[0].stock_out);
          const currentStockIn = parseFloat(updatedBatchCheck[0].stock_in);
          const itemQuantity = parseFloat(item.quantity);

          // Check if transaction adds stock (Purchase, CreditNote, stock inward) or removes stock (Sales, DebitNote, stock transfer)
          const isStockInTransaction = originalTransactionType === "Purchase" || 
                                       originalTransactionType === "CreditNote" || 
                                       originalTransactionType === "stock inward";
          
          if (isStockInTransaction) {
            // Reverse stock addition: subtract from quantity and stock_in
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
            // Reverse stock removal: add back to quantity and subtract from stock_out
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
        let invoiceNumber =
          updateData.invoiceNumber || originalVoucher[0].InvoiceNumber;

        // 🔥 UPDATED: Include staff fields in the UPDATE query
        await queryPromise(
          connection,
          `UPDATE voucher 
           SET VchNo = ?, InvoiceNumber = ?, Date = ?, PartyName = ?, 
               BasicAmount = ?, TaxAmount = ?, TotalAmount = ?,
               staffid = ?, assigned_staff = ?  -- 🔥 NEW STAFF FIELDS
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
            // 🔥 NEW: Staff data
            updateData.selectedStaffId || updateData.staffid || originalVoucher[0].staffid,
            updateData.assigned_staff || originalVoucher[0].assigned_staff,
            voucherId,
          ]
        );

        console.log("✅ Staff data updated in voucher:", {
          staffid: updateData.selectedStaffId || updateData.staffid,
          assigned_staff: updateData.assigned_staff
        });

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

          const itemQuantity = parseFloat(item.quantity);

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
            if (currentQuantity < itemQuantity) {
              throw new Error(
                `Insufficient quantity for ${originalTransactionType} update in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}`
              );
            }

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
            staffid: updateData.selectedStaffId || updateData.staffid,
            assigned_staff: updateData.assigned_staff
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


    if (isKacha) {
      return {
        product: i.product || "",
        product_id: parseInt(i.product_id || i.productId) || null,
        batch: i.batch || i.batch_number || "DEFAULT",
        quantity: billingQuantity, // For billing records
        stock_deduction_quantity: stockDeductionQuantity, // For stock management
        price: parseFloat(i.price) || 0,
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
        // Store flash offer details
        flash_offer: flashOffer,
        buy_quantity: buyQuantity,
        get_quantity: getQuantity
      };
    } else {
      const gstPercentage = parseFloat(i.gst) || 0;
      const cgstPercentageFromFrontend = parseFloat(i.cgst) || 0;
      const sgstPercentageFromFrontend = parseFloat(i.sgst) || 0;
      
      // Use billing quantity for GST calculations
      const cgstToStore = cgstPercentageFromFrontend * billingQuantity;  
      const sgstToStore = sgstPercentageFromFrontend * billingQuantity;
      
      return {
        product: i.product || "",
        product_id: parseInt(i.product_id || i.productId) || null,
        batch: i.batch || i.batch_number || "DEFAULT",
        quantity: billingQuantity, // For billing records
        stock_deduction_quantity: stockDeductionQuantity, // For stock management
        price: parseFloat(i.price) || 0,
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
        // Store flash offer details
        flash_offer: flashOffer,
        buy_quantity: buyQuantity,
        get_quantity: getQuantity
      };
    }
  });

  const orderNumber = transactionData.orderNumber || transactionData.order_number || null;
  console.log("🛒 Order Number from request:", orderNumber);

  const selectedItemIds = transactionData.selectedItemIds || transactionData.selected_item_ids || [];
  const hasItemSelection = selectedItemIds && selectedItemIds.length > 0;
  
  console.log("📋 Has item selection:", hasItemSelection ? `Yes (${selectedItemIds.length} items)` : "No");
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

  // VOUCHER DATA with FLASH OFFER field
  const voucherData = {
    VoucherID: nextVoucherId,
    TransactionType: transactionType,
    data_type: dataType,
    VchNo: vchNo,
    InvoiceNumber: invoiceNumber,
    order_number: orderNumber, 
    order_mode: orderMode,
    // ADD FLASH OFFER FIELD
    flash_offer: items.some(item => item.flash_offer === 1) ? 1 : 0,
    due_date: transactionData.due_date || null,
    Date: transactionData.Date || new Date().toISOString().split("T")[0],
    PaymentTerms: transactionData.PaymentTerms || "Immediate",
    Freight: parseFloat(transactionData.Freight) || 0,
    TotalPacks: items.length,
    TaxAmount: totalGST,
    Subtotal: taxableAmount,
    BillSundryAmount: parseFloat(transactionData.BillSundryAmount) || 0,
    TotalAmount: grandTotal,
    paid_amount: parseFloat(transactionData.paid_amount) || grandTotal,
    total_discount: totalDiscount,
    total_credit_charge: totalCreditCharge,
    AccountID: accountID,
    AccountName: account_name,      
    business_name: business_name,   
    PartyID: partyID,
    retailer_mobile: transactionData.customerInfo?.phone || 
                transactionData.fullAccountDetails?.mobile_number || 0,
    PartyName: partyName,
    BasicAmount: taxableAmount,
    
    ValueOfGoods: taxableAmount,
    EntryDate: new Date(),
    SGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.SGSTPercentage) || 0),
    CGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.CGSTPercentage) || 0),
    IGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.IGSTPercentage) || (items[0]?.igst || 0)),
    SGSTAmount: isKacha ? 0 : (parseFloat(transactionData.SGSTAmount) || 0),
    CGSTAmount: isKacha ? 0 : (parseFloat(transactionData.CGSTAmount) || 0),
    IGSTAmount: isKacha ? 0 : (parseFloat(transactionData.IGSTAmount) || 0),
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
    staffid: transactionData.staffid || null,
    assigned_staff: transactionData.assigned_staff || null,
    staff_incentive: staffIncentive,
    created_at: new Date(),
    balance_amount: parseFloat(transactionData.balance_amount) || 0,
    status: transactionData.status || "active",
    paid_date: transactionData.paid_date || null,
    pdf_data: transactionData.pdf_data || null,
    pdf_file_name: transactionData.pdf_file_name || null,
    pdf_created_at: transactionData.pdf_created_at || null
  };

  console.log("🔍 DEBUG - Staff Incentive in voucher:", voucherData.staff_incentive);
  console.log("🔍 DEBUG - Flash Offer in voucher:", voucherData.flash_offer);

  // INSERT VOUCHER
  await queryPromise(
    connection,
    "INSERT INTO voucher SET ?",
    [voucherData]
  );

 // FIXED INSERT QUERY - Added missing field
const insertDetailQuery = `
  INSERT INTO voucherdetails (
    voucher_id, product, product_id, transaction_type, InvoiceNumber,
    batch, quantity, get_quantity, price, discount,
    gst, cgst, sgst, igst, cess, total, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
    i.price,            
    i.discount,         
    itemGST,              
    itemCGST,             
    itemSGST,           
    itemIGST,           
    itemCess,             
    i.total,              
   
  ]);
}



  // STOCK MANAGEMENT - For Sales and stock transfer transactions
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
          const batchCheck = await queryPromise(
            connection,
            `
            SELECT batch_number, quantity 
            FROM batches 
            WHERE product_id = ? 
              AND batch_number = ? 
              AND quantity >= ?
            `,
            [i.product_id, specificBatch, remainingQuantity]
          );
          
          if (batchCheck.length === 0) {
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
              throw new Error(`Batch ${specificBatch} not found for product ID ${i.product_id}`);
            } else {
              throw new Error(`Insufficient stock in batch ${specificBatch} for product ID ${i.product_id}. Available: ${batchExists[0].quantity}, Required: ${remainingQuantity}`);
            }
          }
          
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
          
          console.log(`✅ Successfully deducted ${remainingQuantity} from batch ${specificBatch}`);
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
        // Regular sale (not from order)
        console.log(`🛍️ Regular sale - Using any available stock for product ${i.product_id}`);
        
        const batches = await queryPromise(
          connection,
          `
          SELECT batch_number, quantity
          FROM batches 
          WHERE product_id = ? 
            AND quantity > 0 
          ORDER BY created_at ASC
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
            console.log(`➖ Deducting ${deductQty} from batch ${batchNumber}`);
            
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

module.exports = router;

