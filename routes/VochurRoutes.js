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




router.put("/creditnoteupdate/:id", async (req, res) => {
  const voucherId = req.params.id;
  const updateData = req.body;

  console.log("UPDATE RECEIVED => ", voucherId, updateData);

  db.getConnection((err, connection) => {
    if (err) return res.status(500).send({ error: "Database connection failed" });

    connection.beginTransaction(async (err) => {
      if (err) return res.status(500).send({ error: "Transaction could not start" });

      try {
        // 1️⃣ Fetch original voucher
        const originalVoucher = await queryPromise(
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
        );

        if (originalVoucher.length === 0) throw new Error("Voucher not found");

        const transactionType =
          updateData.transactionType ||
          originalVoucher[0].TransactionType ||
          "Sales";

        // Parse old batch details
        let originalBatchDetails = [];
        try {
          originalBatchDetails = JSON.parse(originalVoucher[0].BatchDetails || "[]");
        } catch {
          originalBatchDetails = [];
        }

        // 2️⃣ Reverse OLD STOCK
        for (const item of originalBatchDetails) {
          if (!item.product_id || !item.batch) continue;

          const [batch] = await queryPromise(
            "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch],
            connection
          );

          if (!batch) continue;

          const qty = Number(item.quantity) || 0;

          if (transactionType === "Sales") {
            await queryPromise(
              "UPDATE batches SET quantity = quantity + ?, stock_out = stock_out - ? WHERE id = ?",
              [qty, qty, batch.id],
              connection
            );
          } else if (transactionType === "CreditNote") {
            await queryPromise(
              "UPDATE batches SET quantity = quantity - ?, stock_in = stock_in - ? WHERE id = ?",
              [qty, qty, batch.id],
              connection
            );
          }
        }

        // Delete old voucherdetails
        await queryPromise(
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId],
          connection
        );

        // 3️⃣ HANDLE NEW BatchDetails
        let batchData =
          updateData.batchDetails || updateData.BatchDetails || updateData.items;

        let newBatchDetails = [];

        try {
          newBatchDetails = Array.isArray(batchData)
            ? batchData
            : JSON.parse(batchData || "[]");
        } catch {
          newBatchDetails = [];
        }

        const totalQty = newBatchDetails.reduce(
          (sum, item) => sum + (Number(item.quantity) || 0),
          0
        );

        const grandTotal =
          Number(updateData.TotalAmount) ||
          Number(updateData.grandTotal) ||
          Number(originalVoucher[0].TotalAmount);

        // 4️⃣ UPDATE voucher + set paid_amount = grandTotal
        await queryPromise(
          `
          UPDATE voucher SET 
            VchNo = ?, 
            Date = ?, 
            InvoiceNumber = ?, 
            PartyName = ?, 
            BasicAmount = ?, 
            TaxAmount = ?, 
            TotalAmount = ?, 
            TotalQty = ?, 
            BatchDetails = ?, 
            TransactionType = ?,
            paid_amount = ?    -- automatically add grandTotal to paid_amount
          WHERE VoucherID = ?
        `,
          [
            updateData.VchNo ||
              updateData.creditNoteNumber ||
              originalVoucher[0].VchNo,

            updateData.Date ||
              updateData.invoiceDate ||
              originalVoucher[0].Date,

            updateData.InvoiceNumber ||
              updateData.originalInvoiceNumber ||
              updateData.InvoiceNo ||
              originalVoucher[0].InvoiceNumber,

            updateData.PartyName ||
              updateData.customerData?.business_name ||
              originalVoucher[0].PartyName,

            Number(updateData.BasicAmount) ||
              Number(updateData.taxableAmount) ||
              Number(originalVoucher[0].BasicAmount),

            Number(updateData.TaxAmount) ||
              Number(updateData.totalGST) ||
              Number(originalVoucher[0].TaxAmount),

            grandTotal,

            totalQty,

            JSON.stringify(newBatchDetails),

            transactionType,

            grandTotal, // ✅ paid_amount = grandTotal

            voucherId,
          ],
          connection
        );

        // 5️⃣ INSERT NEW voucherdetails
        for (const item of newBatchDetails) {
          await queryPromise(
            `
            INSERT INTO voucherdetails 
            (voucher_id, product, product_id, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              voucherId,
              item.product || "",
              item.product_id || 0,
              item.InvoiceNumber || "",
              item.batch || "",
              Number(item.quantity) || 0,
              Number(item.price) || 0,
              Number(item.discount) || 0,
              Number(item.gst) || 0,
              Number(item.cgst) || 0,
              Number(item.sgst) || 0,
              Number(item.igst) || 0,
              Number(item.cess) || 0,
              Number(item.total) || 0,
            ],
            connection
          );
        }

        // 6️⃣ UPDATE NEW STOCK
        for (const item of newBatchDetails) {
          const [batch] = await queryPromise(
            "SELECT * FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch],
            connection
          );

          if (!batch) throw new Error(`Batch not found: ${item.batch}`);

          const qty = Number(item.quantity) || 0;

          if (transactionType === "Sales") {
            if (batch.quantity < qty)
              throw new Error(`Insufficient stock for batch ${item.batch}`);

            await queryPromise(
              "UPDATE batches SET quantity = quantity - ?, stock_out = stock_out + ? WHERE id = ?",
              [qty, qty, batch.id],
              connection
            );
          } else if (transactionType === "CreditNote") {
            await queryPromise(
              "UPDATE batches SET quantity = quantity + ?, stock_in = stock_in + ? WHERE id = ?",
              [qty, qty, batch.id],
              connection
            );
          }
        }

        connection.commit(() => {
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

//         // 2️⃣ Get batch details from voucherdetails table instead of voucher table
//         const batchDetails = await queryPromise(
//           "SELECT * FROM voucherdetails WHERE voucher_id = ?",
//           [voucherId],
//           connection
//         );

//         // 3️⃣ Reverse batch stock if Sales transaction
//         if (voucherData.TransactionType === "Sales" && batchDetails.length > 0) {
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

//               // Recalculate available quantity
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

//         // 3️⃣➖ Reverse batch stock if CreditNote transaction
//        // 3️⃣➖ Reverse batch stock if CreditNote transaction
// if (voucherData.TransactionType === "CreditNote" && batchDetails.length > 0) {
//   for (const item of batchDetails) {
//     if (!item.product_id || !item.batch) continue;

//     // Get batch record
//     const batchResult = await queryPromise(
//       "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
//       [item.product_id, item.batch],
//       connection
//     );

//     if (batchResult.length > 0) {
//       const batch = batchResult[0];
//       const qty = parseFloat(item.quantity) || 0;

//       // Reverse stock_in for CreditNote - decrease stock_in by voucherdetails quantity
//       const newStockIn = (parseFloat(batch.stock_in) || 0) - qty;

//       // Recalculate available quantity
//       const batchOpening = parseFloat(batch.opening_stock) || 0;
//       const batchOut = parseFloat(batch.stock_out) || 0;
//       const newQuantity = batchOpening + newStockIn - batchOut;

//       await queryPromise(
//         "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE id = ?",
//         [newQuantity, newStockIn, batch.id],
//         connection
//       );

//       console.log(
//         `Reversed batch ${item.batch} for product ${item.product_id}: quantity -> ${newQuantity}, stock_in decreased by ${qty} -> ${newStockIn}`
//       );
//     }
//   }
// }

//         // 4️⃣ Delete related voucher details
//         await queryPromise("DELETE FROM voucherdetails WHERE voucher_id = ?", [voucherId], connection);

//         // 5️⃣ Delete voucher itself
//         await queryPromise("DELETE FROM voucher WHERE VoucherID = ?", [voucherId], connection);

//         // 6️⃣ Commit transaction
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
//           console.log("Transaction and related details deleted successfully");
//           res.send({
//             success: true,
//             message: "Invoice and related batch details deleted successfully",
//             voucherId,
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

        // 2️⃣ Get batch details from voucherdetails table
        const batchDetails = await queryPromise(
          "SELECT * FROM voucherdetails WHERE voucher_id = ?",
          [voucherId],
          connection
        );

        // -----------------------------------------------------------------------
        // 3️⃣ Reverse stock for SALES
        // -----------------------------------------------------------------------
        if (voucherData.TransactionType === "Sales" && batchDetails.length > 0) {
          console.log("Reversing STOCK for SALES");

          for (const item of batchDetails) {
            if (!item.product_id || !item.batch) continue;

            const batchResult = await queryPromise(
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch],
              connection
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
                "UPDATE batches SET quantity = ?, stock_out = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockOut, batch.id],
                connection
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
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch],
              connection
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
                "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockIn, batch.id],
                connection
              );

              console.log(
                `✔ CREDIT NOTE reversed batch ${item.batch}: qty=${newQuantity}, stock_in=${newStockIn}`
              );
            }
          }
        }

        // -----------------------------------------------------------------------
        // 3️⃣➖ Reverse stock for PURCHASE (YOUR REQUEST)
        // -----------------------------------------------------------------------
        if (voucherData.TransactionType === "Purchase" && batchDetails.length > 0) {
          console.log("Reversing STOCK for PURCHASE");

          for (const item of batchDetails) {
            if (!item.product_id || !item.batch) continue;

            const batchResult = await queryPromise(
              "SELECT id, opening_stock, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
              [item.product_id, item.batch],
              connection
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
                "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE id = ?",
                [newQuantity, newStockIn, batch.id],
                connection
              );

              console.log(
                `✔ PURCHASE reversed batch ${item.batch}: qty=${newQuantity}, stock_in=${newStockIn}`
              );
            }
          }
        }

        // -----------------------------------------------------------------------
        // 4️⃣ Delete voucherdetails
        // -----------------------------------------------------------------------
        await queryPromise(
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId],
          connection
        );

        // -----------------------------------------------------------------------
        // 5️⃣ Delete voucher record
        // -----------------------------------------------------------------------
        await queryPromise(
          "DELETE FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
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



// 19-11
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


router.get("/transactions", (req, res) => {
  const query = `
    SELECT 
      v.*, 
      JSON_UNQUOTE(v.BatchDetails) as batch_details,
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
  console.log("Received transaction data:", transactionData);

  const transactionType = transactionData.transactionType || "Sales";
  console.log("Processing as:", transactionType);

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
        const result = await processTransaction(transactionData, transactionType, connection);
        const { voucherId, invoiceNumber, vchNo, batchDetails, grandTotal } = result;
        console.log("Grand Total:", grandTotal);

        // ⭐⭐⭐ Fetch correct InvoiceNumber from voucher table after insert
        const invoiceQuery = `
          SELECT InvoiceNumber 
          FROM voucher 
          WHERE VoucherID = ?
          LIMIT 1
        `;
        const invoiceRows = await queryPromise(invoiceQuery, [voucherId], connection);
        const finalInvoiceNumber = invoiceRows[0]?.InvoiceNumber;

        console.log("✔ Final InvoiceNumber from DB:", finalInvoiceNumber);

        // ---- Insert into voucherdetails ----
        const insertDetailQuery = `
          INSERT INTO voucherdetails (
            voucher_id, product, product_id, InvoiceNumber,
            batch, quantity, price, discount,
            gst, cgst, sgst, igst, cess, total, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        for (const item of batchDetails) {
          await queryPromise(insertDetailQuery, [
            voucherId,
            item.product,
            item.product_id,
            finalInvoiceNumber,
            item.batch,
            item.quantity,
            item.price,
            item.discount,
            item.gst,
            item.cgst,
            item.sgst,
            item.igst,
            item.cess,
            grandTotal,
          ], connection);
        }

        // Commit
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

          // Return based on transaction type
          if (transactionType === "CreditNote") {
            res.send({
              success: true,
              message: "Credit note created successfully",
              voucherId,
              creditNoteNumber: vchNo,
              invoiceNumber: finalInvoiceNumber,
              batchDetails,
            });
          } else if (transactionType === "Purchase") {
            res.send({
              success: true,
              message: "Purchase transaction completed successfully",
              voucherId,
              invoiceNumber: finalInvoiceNumber,
              batchDetails,
            });
          } else {
            res.send({
              success: true,
              message: "Sales transaction completed successfully",
              voucherId,
              invoiceNumber: finalInvoiceNumber,
              batchDetails,
            });
          }
        });

      } catch (error) {
        console.error("Transaction error:", error);
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

// -------------------------------------------------------------
//  PROCESS TRANSACTION FUNCTION WITH UPDATED_QUANTITY LOGIC
// -------------------------------------------------------------

const processTransaction = async (transactionData, transactionType, connection) => {
  const maxIdResult = await queryPromise(
    "SELECT COALESCE(MAX(VoucherID), 0) + 1 AS nextId FROM voucher",
    [],
    connection
  );
  const nextVoucherId = maxIdResult[0].nextId;

  let batchDetails = [];

  if (Array.isArray(transactionData.batchDetails)) {
    batchDetails = transactionData.batchDetails;
  } else if (Array.isArray(transactionData.items)) {
    batchDetails = transactionData.items;
  } else {
    batchDetails = JSON.parse(transactionData.batchDetails || "[]");
  }

  batchDetails = batchDetails.map((item) => ({
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

  // Invoice + VchNo logic
  let vchNo, invoiceNumber;

  if (transactionType === "CreditNote") {
    vchNo = transactionData.creditNoteNumber || "CNOTE001";
    invoiceNumber = transactionData.invoiceNumber || "INV001";
  } else if (transactionType === "Purchase") {
    vchNo = transactionData.invoiceNumber || "PINV001";
    invoiceNumber = transactionData.invoiceNumber || "PINV001";
  } else {
    vchNo = transactionData.invoiceNumber || "INV001";
    invoiceNumber = transactionData.invoiceNumber || "INV001";
  }

  const totalQty = batchDetails.reduce((sum, item) => sum + item.quantity, 0);
  const supplierInfo = transactionData.supplierInfo || {};
  const customerData = transactionData.customerData || {};

  let accountID =
    transactionData.selectedSupplierId ||
    supplierInfo.account_id ||
    customerData.account_id ||
    null;

  let partyID =
    transactionData.selectedSupplierId ||
    supplierInfo.party_id ||
    customerData.party_id ||
    null;

  const accountName =
    supplierInfo.businessName ||
    supplierInfo.business_name ||
    customerData.business_name ||
    customerData.name ||
    "";

  const partyName =
    supplierInfo.name ||
    supplierInfo.businessName ||
    supplierInfo.business_name ||
    customerData.business_name ||
    customerData.name ||
    "";

  const taxableAmount =
    parseFloat(transactionData.taxableAmount) ||
    batchDetails.reduce((sum, item) => sum + item.quantity * item.price, 0);

  const totalGST =
    parseFloat(transactionData.totalGST) ||
    batchDetails.reduce(
      (sum, item) => sum + item.quantity * item.price * (item.gst / 100),
      0
    );

  const grandTotal =
    parseFloat(transactionData.grandTotal) || taxableAmount + totalGST;

  // For CreditNote, set updated_quantity same as TotalQty initially
  let updated_quantity = totalQty;

  const voucherData = {
    VoucherID: nextVoucherId,
    TransactionType: transactionType,
    VchNo: vchNo,
    InvoiceNumber: invoiceNumber,
    Date:
      transactionData.invoiceDate ||
      transactionData.noteDate ||
      new Date().toISOString().split("T")[0],
    PaymentTerms: "Immediate",
    Freight: 0,
    updated_quantity: updated_quantity, // ⭐ Set initial updated_quantity
    TotalQty: totalQty,
    TotalPacks: batchDetails.length,
    TotalQty1: totalQty,
    TaxAmount: totalGST,
    Subtotal: taxableAmount,
    BillSundryAmount: 0,
    TotalAmount: grandTotal,
    paid_amount: grandTotal,
    AccountID: accountID,
    AccountName: accountName,
    PartyID: partyID,
    PartyName: partyName,
    BasicAmount: taxableAmount,
    ValueOfGoods: taxableAmount,
    EntryDate: new Date(),
    CGSTAmount: 0,
    SGSTAmount: 0,
    IGSTAmount: parseFloat(transactionData.totalIGST) || 0,
    IGSTPercentage: parseFloat(transactionData.items?.[0]?.igst) || 0,
    TaxSystem: "GST",
    product_id: batchDetails.length > 0 ? batchDetails[0].product_id : null,
    batch_id: batchDetails.length > 0 ? batchDetails[0].batch : null,
    DC: transactionType === "CreditNote" ? "C" : "D",
    BatchDetails: JSON.stringify(batchDetails),
  };

  voucherData.InvoiceNumber =
    transactionData.InvoiceNumber || voucherData.InvoiceNumber;

  // Insert voucher
  const voucherResult = await queryPromise(
    "INSERT INTO voucher SET ?",
    voucherData,
    connection
  );
  const voucherId = voucherResult.insertId || nextVoucherId;

  // Update batches
  for (const item of batchDetails) {
    if (transactionType === "CreditNote" || transactionType === "Purchase") {
      await queryPromise(
        `
          UPDATE batches
          SET quantity = quantity + ?, stock_in = stock_in + ?, updated_at = NOW()
          WHERE product_id = ? AND batch_number = ?
        `,
        [item.quantity, item.quantity, item.product_id, item.batch],
        connection
      );
    } else {
      await queryPromise(
        `
          UPDATE batches
          SET quantity = quantity - ?, stock_out = stock_out + ?, updated_at = NOW()
          WHERE product_id = ? AND batch_number = ? AND quantity >= ?
        `,
        [
          item.quantity,
          item.quantity,
          item.product_id,
          item.batch,
          item.quantity,
        ],
        connection
      );
    }
  }

  if (transactionType === "CreditNote") {
    const originalInvoiceNumber = transactionData.originalInvoiceNumber || transactionData.InvoiceNumber;
    
    console.log("🔄 Processing CreditNote - Finding original sales transaction for:", {
      originalInvoiceNumber,
      batchDetails
    });

    // Find the original sales transaction
    const findOriginalSalesQuery = `
      SELECT VoucherID, BatchDetails, updated_quantity, TotalQty
      FROM voucher 
      WHERE TransactionType = 'Sales' 
        AND InvoiceNumber = ?
      LIMIT 1
    `;
    
    const originalSalesRows = await queryPromise(findOriginalSalesQuery, [originalInvoiceNumber], connection);
    
    if (originalSalesRows.length > 0) {
      const originalSales = originalSalesRows[0];
      console.log("📋 Found original sales transaction:", {
        voucherId: originalSales.VoucherID,
        originalUpdatedQty: originalSales.updated_quantity,
        originalTotalQty: originalSales.TotalQty
      });

      let originalBatchDetails = [];
      try {
        originalBatchDetails = JSON.parse(originalSales.BatchDetails || "[]");
      } catch (e) {
        console.error("Error parsing original batch details:", e);
        originalBatchDetails = [];
      }

      console.log("🔄 Original batch details:", originalBatchDetails);

      // Create a map for easy lookup of original quantities
      const originalItemsMap = new Map();
      originalBatchDetails.forEach(item => {
        const key = `${item.product_id}-${item.batch}`;
        originalItemsMap.set(key, {
          quantity: parseFloat(item.quantity) || 0,
          product_id: item.product_id,
          batch: item.batch
        });
      });

      console.log("🗺️ Original items map:", Array.from(originalItemsMap.entries()));

      // Calculate total credit note quantity to subtract
      let totalCreditNoteQty = 0;
      
      for (const creditItem of batchDetails) {
        const key = `${creditItem.product_id}-${creditItem.batch}`;
        const originalItem = originalItemsMap.get(key);
        
        if (originalItem) {
          const creditQty = parseFloat(creditItem.quantity) || 0;
          totalCreditNoteQty += creditQty;
          
          console.log("➖ Subtracting quantity:", {
            product_id: creditItem.product_id,
            batch: creditItem.batch,
            originalQty: originalItem.quantity,
            creditQty: creditQty
          });
        } else {
          console.warn("⚠️ No matching original item found for:", key);
        }
      }

      // Calculate new updated_quantity for original sales
      const originalUpdatedQty = parseFloat(originalSales.updated_quantity) || parseFloat(originalSales.TotalQty) || 0;
      const newUpdatedQty = Math.max(0, originalUpdatedQty - totalCreditNoteQty);

      console.log("🧮 Updated quantity calculation:", {
        originalUpdatedQty,
        totalCreditNoteQty,
        newUpdatedQty
      });

      // Update the original sales transaction's updated_quantity
      if (totalCreditNoteQty > 0) {
        const updateSalesQuery = `
          UPDATE voucher 
          SET updated_quantity = ? 
          WHERE VoucherID = ?
        `;
        
        await queryPromise(updateSalesQuery, [newUpdatedQty, originalSales.VoucherID], connection);
        
        console.log("✅ Updated original sales transaction:", {
          voucherId: originalSales.VoucherID,
          oldUpdatedQty: originalUpdatedQty,
          newUpdatedQty: newUpdatedQty
        });
      }
    } else {
      console.warn("⚠️ No original sales transaction found for invoice:", originalInvoiceNumber);
    }
  }

  return { voucherId, invoiceNumber, vchNo, batchDetails, grandTotal };
};

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
//     console.log()

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
//         v.TotalQty,
//         v.TotalPacks,
//         v.TotalQty1,
//         v.TaxAmount,
//         v.Subtotal,
//         v.BillSundryAmount,
//         v.TotalAmount,
//         v.ChequeNo,
//         v.ChequeDate,
//         v.BankName,
//         v.AccountID,
//         v.AccountName,
//         v.PartyID,
//         a.name AS PartyName,   -- Correct Party Name from accounts table
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
//         v.BatchDetails,
//         v.paid_amount,
//         v.created_at,
//         v.balance_amount,
//         v.receipt_number,
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
//           ELSE 5
//         END,
//         v.created_at ASC
//     `;

//     const results = await new Promise((resolve, reject) => {
//       connection.execute(query, [invoiceNumber], (error, results) => {
//         if (error) reject(error);
//         else resolve(results);
//       });
//     });

//     if (results.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Invoice not found'
//       });
//     }

//     // Group by TransactionType
//     const salesEntry = results.find(r => r.TransactionType === 'Sales');
//     const receiptEntries = results.filter(r => r.TransactionType === 'Receipt');
//     const creditNoteEntries = results.filter(r => r.TransactionType === 'CreditNote');
//     const purchasevoucherEntries = results.filter(r => r.TransactionType === 'purchase voucher');

//     // Check if there are receipts for the party
//     const hasReceipts = receiptEntries.length > 0;

//     // Final response - conditionally include credit notes
//     const responseData = {
//       success: true,
//       data: {
//         sales: salesEntry,
//         receipts: receiptEntries,
//         allEntries: results,
//         purchasevoucher:purchasevoucherEntries
//       }
//     };

//     // Only include credit notes if there are receipts
//     if (hasReceipts) {
//       responseData.data.creditnotes = creditNoteEntries;
//     } else {
//       responseData.data.creditnotes = []; // or you can omit this field entirely
//     }

//     res.json(responseData);

//   } catch (error) {
//     console.error('Error fetching invoice:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error'
//     });
//   } finally {
//     if (connection) {
//       connection.release();
//     }
//   }
// });

// Get last invoice number

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
        v.TotalQty,
        v.TotalPacks,
        v.TotalQty1,
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
        v.BatchDetails,
        v.paid_amount,
        v.created_at,
        v.balance_amount,
        v.receipt_number,
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

    // Group by TransactionType
    const salesEntry = results.find(r => r.TransactionType === 'Sales');
    const receiptEntries = results.filter(r => r.TransactionType === 'Receipt');
    const creditNoteEntries = results.filter(r => r.TransactionType === 'CreditNote');
    const purchasevoucherEntries = results.filter(r => r.TransactionType === 'purchase voucher');

    // ✅ New: Purchase Invoices
    const purchaseEntries = results.filter(r => r.TransactionType === 'Purchase');

    const hasReceipts = receiptEntries.length > 0;

    const responseData = {
      success: true,
      data: {
        sales: salesEntry,
        receipts: receiptEntries,
        purchases: purchaseEntries,          // ✅ Added purchases
        allEntries: results,
        purchasevoucher: purchasevoucherEntries
      }
    };

    // Include credit notes if receipts exist
responseData.data.creditnotes = creditNoteEntries;

    res.json(responseData);

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
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId],
          connection
        );

        if (originalVoucher.length === 0)
          throw new Error("Transaction not found");

        const originalTransactionType =
          originalVoucher[0].TransactionType || "Sales";

        console.log("🔎 Original transaction:", originalTransactionType);

        let originalBatchDetails = [];
        try {
          originalBatchDetails = originalVoucher[0].BatchDetails
            ? JSON.parse(originalVoucher[0].BatchDetails)
            : [];
        } catch {
          originalBatchDetails = [];
        }

        // -------------------------------------------------------------------
        // 2️⃣ REVERSE OLD STOCK (UNDO original stock effect)
        // -------------------------------------------------------------------

        for (const item of originalBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          console.log("♻️ Reversing:", originalTransactionType, item);

          if (originalTransactionType === "Purchase") {
            // PURCHASE reversal → reverse the incoming goods
            const q = `
              UPDATE batches
              SET quantity = quantity - ?,
                  stock_in = stock_in - ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ? AND quantity >= ?
            `;

            const r = await queryPromise(
              q,
              [item.quantity, item.quantity, item.product_id, item.batch, item.quantity],
              connection
            );

            if (r.affectedRows === 0) {
              throw new Error(
                `Cannot reverse Purchase: insufficient stock in batch ${item.batch}`
              );
            }

            console.log(`✔ Reversed PURCHASE for batch ${item.batch}`);

          } else if (originalTransactionType === "CreditNote") {
            // CREDIT NOTE reversal → undo credit note addition
            const q = `
              UPDATE batches
              SET quantity = quantity - ?,
                  stock_in = stock_in - ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ? AND quantity >= ?
            `;

            const r = await queryPromise(
              q,
              [item.quantity, item.quantity, item.product_id, item.batch, item.quantity],
              connection
            );

            if (r.affectedRows === 0) {
              throw new Error(
                `Cannot reverse Credit Note: insufficient stock in batch ${item.batch}`
              );
            }

            console.log(`✔ Reversed CREDIT NOTE for batch ${item.batch}`);

          } else {
            // SALES reversal → return stock
            const q = `
              UPDATE batches
              SET quantity = quantity + ?,
                  stock_out = stock_out - ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ?
            `;

            const r = await queryPromise(
              q,
              [item.quantity, item.quantity, item.product_id, item.batch],
              connection
            );

            if (r.affectedRows === 0) {
              throw new Error(
                `Batch ${item.batch} not found during SALES reversal`
              );
            }

            console.log(`✔ Reversed SALES for batch ${item.batch}`);
          }
        }

        // -------------------------------------------------------------------
        // DELETE EXISTING VOUCHER DETAILS
        // -------------------------------------------------------------------
        await queryPromise(
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId],
          connection
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

        const totalQty = newBatchDetails.reduce(
          (sum, item) => sum + (parseFloat(item.quantity) || 0),
          0
        );

        let vchNo = updateData.invoiceNumber || originalVoucher[0].VchNo;
        let invoiceNumber =
          updateData.invoiceNumber || originalVoucher[0].InvoiceNumber;

        await queryPromise(
          `UPDATE voucher 
           SET VchNo = ?, InvoiceNumber = ?, Date = ?, PartyName = ?, 
               BasicAmount = ?, TaxAmount = ?, TotalAmount = ?, TotalQty = ?, 
               BatchDetails = ?
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
            totalQty,
            JSON.stringify(newBatchDetails),
            voucherId,
          ],
          connection
        );

        // -------------------------------------------------------------------
        // INSERT NEW voucherDetails
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          await queryPromise(
            `INSERT INTO voucherdetails 
              (voucher_id, product, product_id, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              voucherId,
              item.product || "",
              item.product_id || "",
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
            ],
            connection
          );
        }

        // -------------------------------------------------------------------
        // 4️⃣ APPLY **NEW** STOCK CHANGES
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          if (originalTransactionType === "Purchase") {
            // PURCHASE → Add stock
            const q = `
              UPDATE batches
              SET quantity = quantity + ?,
                  stock_in = stock_in + ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ?
            `;

            const r = await queryPromise(
              q,
              [item.quantity, item.quantity, item.product_id, item.batch],
              connection
            );

            if (r.affectedRows === 0) {
              throw new Error(
                `Batch ${item.batch} not found while updating PURCHASE`
              );
            }

            console.log(`✔ PURCHASE applied batch ${item.batch}`);

          } else if (originalTransactionType === "CreditNote") {
            // CREDIT NOTE → Add to stock
            const q = `
              UPDATE batches
              SET quantity = quantity + ?,
                  stock_in = stock_in + ?
              WHERE product_id = ? AND batch_number = ?
            `;

            await queryPromise(
              q,
              [item.quantity, item.quantity, item.product_id, item.batch],
              connection
            );

            console.log(`✔ CREDIT NOTE applied batch ${item.batch}`);

          } else {
            // SALES → Reduce stock
            const q = `
              UPDATE batches
              SET quantity = quantity - ?,
                  stock_out = stock_out + ?,
                  updated_at = NOW()
              WHERE product_id = ? AND batch_number = ? AND quantity >= ?
            `;

            const r = await queryPromise(
              q,
              [item.quantity, item.quantity, item.product_id, item.batch, item.quantity],
              connection
            );

            if (r.affectedRows === 0) {
              throw new Error(
                `Insufficient quantity for SALES update in batch ${item.batch}`
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