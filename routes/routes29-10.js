const express = require('express');
const router = express.Router();
const db = require('../db');

// ------------------------------
// Get next receipt number
// ------------------------------
router.get('/next-receipt-number', async (req, res) => {
  try {
    db.execute(
      'SELECT receipt_number FROM receipts ORDER BY receipt_number DESC LIMIT 1',
      (error, results) => {
        if (error) {
          console.error('Database error fetching next receipt number:', error);
          return res.status(500).json({ error: 'Failed to fetch next receipt number' });
        }

        let nextReceiptNumber = 'REC001';
        if (results && results.length > 0) {
          const lastNumber = results[0].receipt_number;
          const match = lastNumber.match(/REC(\d+)/);
          if (match) {
            const nextNum = parseInt(match[1], 10) + 1;
            nextReceiptNumber = `REC${nextNum.toString().padStart(3, '0')}`;
          }
        }

        res.json({ nextReceiptNumber });
      }
    );
  } catch (error) {
    console.error('Error in next receipt number route:', error);
    res.status(500).json({ error: 'Failed to fetch next receipt number' });
  }
});

// ------------------------------
// Create new receipt and update voucher
router.post('/receipts', async (req, res) => {
  let connection;
  try {
    // Get DB connection
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    // Start transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    const {
      receipt_number,
      retailer_id,
      retailer_name,
      amount,
      currency,
      payment_method,
      receipt_date,
      note,
      bank_name,
      transaction_date,
      reconciliation_option,
      invoice_number
    } = req.body;

    // Validate receipt_number
    if (!receipt_number || !receipt_number.match(/^REC\d+$/)) {
      throw new Error('Invalid receipt number format');
    }

    // Check if receipt number already exists
    const existingReceipt = await new Promise((resolve, reject) => {
      connection.execute(
        `SELECT receipt_number FROM receipts WHERE receipt_number = ?`,
        [receipt_number],
        (err, results) => {
          if (err) reject(err);
          else resolve(results[0]);
        }
      );
    });

    if (existingReceipt) {
      throw new Error(`Receipt number ${receipt_number} already exists`);
    }

    const receiptAmount = parseFloat(amount || 0);

    // Step 1: Insert receipt in receipts table
    const receiptResult = await new Promise((resolve, reject) => {
      connection.execute(
        `INSERT INTO receipts (
          receipt_number, retailer_id, amount, currency, payment_method,
          receipt_date, note, bank_name, transaction_date, reconciliation_option
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receipt_number,
          retailer_id || null,
          receiptAmount,
          currency || 'INR',
          payment_method || 'Direct Deposit',
          receipt_date || new Date(),
          note || '',
          bank_name || '',
          transaction_date || null,
          reconciliation_option || 'Do Not Reconcile',
        ],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    // Step 2: Apply receipt to existing Sales vouchers
    if (retailer_id) {
      let voucherQuery = `SELECT * FROM voucher WHERE PartyID = ? AND TransactionType='Sales'`;
      const queryParams = [retailer_id];

      if (invoice_number) {
        voucherQuery += ` AND InvoiceNumber = ?`;
        queryParams.push(invoice_number);
      }

      voucherQuery += ` ORDER BY Date ASC, VoucherID ASC`;

      const vouchers = await new Promise((resolve, reject) => {
        connection.execute(voucherQuery, queryParams, (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      if (vouchers && vouchers.length > 0) {
        let remainingAmount = receiptAmount;
        const currentDate = new Date();

        // Get previous receipt balance to calculate current balance
        const previousReceipts = await new Promise((resolve, reject) => {
          connection.execute(
            `SELECT * FROM voucher WHERE PartyID = ? AND TransactionType='Receipt' ORDER BY VoucherID DESC LIMIT 1`,
            [retailer_id],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            }
          );
        });

        let previousBalance = 0;
        if (previousReceipts && previousReceipts.length > 0) {
          previousBalance = parseFloat(previousReceipts[0].balance_amount || 0);
        } else {
          // If no previous receipts, use sales total amount as starting balance
          previousBalance = parseFloat(vouchers[0].TotalAmount || 0);
        }

        for (const voucher of vouchers) {
          if (remainingAmount <= 0) break;

          const totalAmount = parseFloat(voucher.TotalAmount || 0);
          
          // Calculate current balance based on previous receipt balance
          const currentBalance = previousBalance;
          const amountToApply = Math.min(remainingAmount, currentBalance);
          if (amountToApply <= 0) continue;

          remainingAmount -= amountToApply;
          const updatedBalanceAmount = currentBalance - amountToApply;

          // FIXED: DO NOT update sales voucher at all - keep it original
          // No UPDATE query for sales voucher

          // FIXED: Create receipt entry with cumulative calculations
          await new Promise((resolve, reject) => {
            connection.execute(
              `INSERT INTO voucher (
                TransactionType, VchNo, InvoiceNumber, Date, PaymentTerms, Freight,
                TotalQty, TotalPacks, TotalQty1, TaxAmount, Subtotal, BillSundryAmount,
                TotalAmount, ChequeNo, ChequeDate, BankName, AccountID, AccountName,
                PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate,
                SGSTPercentage, CGSTPercentage, IGSTPercentage, SGSTAmount, CGSTAmount, IGSTAmount,
                TaxSystem, BatchDetails, paid_amount, balance_amount, receipt_number, status, paid_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                'Receipt',
                receipt_number,
                voucher.InvoiceNumber,
                currentDate,
                'Immediate',
                0.00,
                0.00,
                0,
                0,
                0.00,
                amountToApply,
                0.00,
                currentBalance, // TotalAmount = previous balance (not amount paid)
                null,
                null,
                bank_name || '',
                voucher.AccountID,
                voucher.AccountName,
                voucher.PartyID,
                retailer_name || voucher.PartyName,
                amountToApply,
                amountToApply,
                currentDate,
                0.00,
                0.00,
                0.00,
                0.00,
                0.00,
                0.00,
                'GST',
                '[]',
                amountToApply, // paid_amount = amount paid in this receipt
                updatedBalanceAmount, // balance_amount = remaining balance after this payment
                receipt_number,
                updatedBalanceAmount <= 0.01 ? 'Paid' : 'Partial',
                currentDate
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });

          // Update previous balance for next iteration
          previousBalance = updatedBalanceAmount;
        }

        // If leftover amount, create advance payment row
        if (remainingAmount > 0) {
          await new Promise((resolve, reject) => {
            connection.execute(
              `INSERT INTO voucher (
                TransactionType, VchNo, Date, TotalAmount, BankName,
                PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate,
                paid_amount, balance_amount, receipt_number, status, paid_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                'Receipt',
                receipt_number,
                currentDate,
                previousBalance, // Show previous balance as TotalAmount
                bank_name,
                retailer_id,
                retailer_name,
                remainingAmount,
                remainingAmount,
                currentDate,
                remainingAmount,
                0,
                receipt_number,
                'Paid',
                currentDate
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
      } else {
        // No sales vouchers found: simple receipt entry (advance payment)
        await new Promise((resolve, reject) => {
          connection.execute(
            `INSERT INTO voucher (
              TransactionType, VchNo, Date, TotalAmount, BankName,
              PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate,
              paid_amount, balance_amount, receipt_number, status, paid_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              'Receipt',
              receipt_number,
              new Date(),
              receiptAmount,
              bank_name,
              retailer_id,
              retailer_name,
              receiptAmount,
              receiptAmount,
              new Date(),
              receiptAmount,
              0,
              receipt_number,
              'Paid',
              new Date()
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    }

    // Commit transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.status(201).json({
      id: receiptResult.insertId,
      message: 'Receipt created and applied to vouchers successfully',
      receipt_number
    });

  } catch (error) {
    if (connection) {
      await new Promise(resolve => connection.rollback(() => resolve()));
    }
    console.error('Error in create receipt route:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'VoucherID must be AUTO_INCREMENT in voucher table' });
    }
    res.status(500).json({ error: error.message || 'Failed to create receipt' });
  } finally {
    if (connection) connection.release();
  }
});





// ------------------------------
// Get receipt with voucher details
// ------------------------------
router.get('/receipts-with-vouchers', async (req, res) => {
  try {
    const query = `
      SELECT 
        r.*,
        a.business_name,
        a.name as account_name,
        GROUP_CONCAT(DISTINCT v.InvoiceNumber) as related_invoices,
        SUM(v.TotalAmount) as total_invoice_amount,
        SUM(v.paid_amount) as total_paid_amount,
        SUM(v.balance_amount) as total_balance_amount
      FROM receipts r
      LEFT JOIN accounts a ON r.retailer_id = a.id
      LEFT JOIN voucher v ON r.retailer_id = v.PartyID AND FIND_IN_SET(r.receipt_number, v.receipt_number)
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `;

    db.execute(query, (error, results) => {
      if (error) {
        console.error('Database error fetching receipts with vouchers:', error);
        return res.status(500).json({ error: 'Failed to fetch receipts' });
      }

      res.json(results || []);
    });
  } catch (error) {
    console.error('Error in receipts with vouchers route:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// ------------------------------
// Get last receipt (fallback)
// ------------------------------
router.get('/last-receipt', async (req, res) => {
  try {
    db.execute(
      'SELECT receipt_number FROM receipts ORDER BY id DESC LIMIT 1',
      (error, results) => {
        if (error) {
          console.error('Database error fetching last receipt:', error);
          return res.status(500).json({ error: 'Failed to fetch last receipt' });
        }

        if (results && results.length > 0) {
          res.json({ lastReceiptNumber: results[0].receipt_number });
        } else {
          res.json({ lastReceiptNumber: null });
        }
      }
    );
  } catch (error) {
    console.error('Error in last receipt route:', error);
    res.status(500).json({ error: 'Failed to fetch last receipt' });
  }
});

// ------------------------------
// Get all receipts
// ------------------------------
router.get('/receipts', async (req, res) => {
  try {
    db.execute(
      `SELECT r.*, a.business_name, a.name as payee_name 
       FROM receipts r 
       LEFT JOIN accounts a ON r.retailer_id = a.id 
       ORDER BY r.created_at DESC`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching receipts:', error);
          return res.status(500).json({ error: 'Failed to fetch receipts' });
        }

        res.json(results || []);
      }
    );
  } catch (error) {
    console.error('Error in receipts route:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// ------------------------------
// Get receipt by ID
// ------------------------------
router.get('/receipts/:id', async (req, res) => {
  try {
    db.execute(
      `SELECT r.*, a.business_name, a.name as payee_name 
       FROM receipts r 
       LEFT JOIN accounts a ON r.retailer_id = a.id 
       WHERE r.id = ?`,
      [req.params.id],
      (error, results) => {
        if (error) {
          console.error('Database error fetching receipt:', error);
          return res.status(500).json({ error: 'Failed to fetch receipt' });
        }

        if (!results || results.length === 0) {
          return res.status(404).json({ error: 'Receipt not found' });
        }

        res.json(results[0]);
      }
    );
  } catch (error) {
    console.error('Error in receipt by ID route:', error);
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});

// ------------------------------
// Update receipt by ID
// ------------------------------
router.put('/receipts/:id', async (req, res) => {
  try {
    const {
      retailer_id,
      amount,
      currency,
      payment_method,
      receipt_date,
      note,
      bank_name,
      transaction_date,
      reconciliation_option,
    } = req.body;

    db.execute(
      `UPDATE receipts SET 
        retailer_id = ?, amount = ?, currency = ?, payment_method = ?,
        receipt_date = ?, note = ?, bank_name = ?, transaction_date = ?,
        reconciliation_option = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        retailer_id,
        amount,
        currency,
        payment_method,
        receipt_date,
        note,
        bank_name,
        transaction_date,
        reconciliation_option,
        req.params.id
      ],
      (error, results) => {
        if (error) {
          console.error('Database error updating receipt:', error);
          return res.status(500).json({ error: 'Failed to update receipt' });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Receipt not found' });
        }

        res.json({ message: 'Receipt updated successfully' });
      }
    );
  } catch (error) {
    console.error('Error in update receipt route:', error);
    res.status(500).json({ error: 'Failed to update receipt' });
  }
});

// ------------------------------
// Delete receipt by ID
// ------------------------------
router.delete('/receipts/:id', async (req, res) => {
  let connection;
  try {
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // First get receipt details
    const receipt = await new Promise((resolve, reject) => {
      connection.execute(
        'SELECT receipt_number, retailer_id, amount FROM receipts WHERE id = ?',
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results[0]);
        }
      );
    });

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Step 1: Update vouchers to remove this receipt
    if (receipt.retailer_id) {
      const vouchers = await new Promise((resolve, reject) => {
        connection.execute(
          'SELECT * FROM voucher WHERE PartyID = ? AND FIND_IN_SET(?, receipt_number)',
          [receipt.retailer_id, receipt.receipt_number],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      for (const voucher of vouchers) {
        // Remove this receipt number from voucher
        const currentReceiptNumbers = voucher.receipt_number.split(', ').filter(rn => rn !== receipt.receipt_number);
        const newReceiptNumber = currentReceiptNumbers.join(', ') || null;
        
        // Recalculate paid amount and balance
        const receiptAmount = parseFloat(receipt.amount);
        const newPaidAmount = Math.max(0, parseFloat(voucher.paid_amount) - receiptAmount);
        const newBalanceAmount = parseFloat(voucher.TotalAmount) - newPaidAmount;
        const newStatus = newBalanceAmount <= 0 ? 'Paid' : (newPaidAmount > 0 ? 'Partial' : 'Pending');

        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE voucher SET 
              paid_amount = ?, 
              balance_amount = ?, 
              receipt_number = ?,
              status = ?
             WHERE VoucherID = ?`,
            [
              newPaidAmount,
              newBalanceAmount,
              newReceiptNumber,
              newStatus,
              voucher.VoucherID
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });
      }
    }

    // Step 2: Delete the receipt
    await new Promise((resolve, reject) => {
      connection.execute(
        'DELETE FROM receipts WHERE id = ?',
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results);
        }
      );
    });

    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({ message: 'Receipt deleted successfully' });

  } catch (error) {
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }

    console.error('Error in delete receipt route:', error);
    res.status(500).json({ error: 'Failed to delete receipt' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});






router.post('/receipts', upload.single('transaction_proof'), async (req, res) => {
  let connection;

  try {
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await connection.promise().beginTransaction();

    const {
      retailer_id,
      retailer_name,
      amount,
      bank_name,
      invoice_number,
      product_id,
      batch_id, // This should be the batch_id
      batch,    // This should be the batch_number
      quantity,
      price,
      discount,
      gst,
      cgst,
      sgst,
      igst,
      cess,
      total,
      TransactionType
    } = req.body;

    // 🔥 CONDITIONAL TRANSACTION TYPE
    let safeTransactionType =
      TransactionType === "purchase voucher"
        ? "purchase voucher"
        : "Receipt";

    const receiptAmount = parseFloat(amount || 0);
    const currentDate = new Date();
    const safeInvoiceNumber = invoice_number || null;

    // FILE UPLOAD
    let transaction_proof_filename = null;
    if (req.file) transaction_proof_filename = req.file.filename;

    // Debug logging
    console.log("🔍 Receipt Form Data:", {
      batch_id: batch_id,
      batch: batch,
      product_id: product_id,
      retailer_name: retailer_name
    });

    // -------------------------------------------
    // 1️⃣ Generate NEXT receipt number using VchNo
    // -------------------------------------------
    let queryCondition =
      safeTransactionType === "purchase voucher"
        ? "TransactionType = 'purchase voucher'"
        : "TransactionType = 'Receipt'";

    const [recRows] = await connection.promise().query(
      `SELECT VchNo 
       FROM voucher 
       WHERE ${queryCondition}
       ORDER BY VoucherID DESC
       LIMIT 1`
    );

    let nextReceipt = "REC001";

    if (recRows.length > 0) {
      const match = recRows[0].VchNo?.match(/REC(\d+)/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        nextReceipt = "REC" + nextNum.toString().padStart(3, "0");
      }
    }

    console.log("Generated Receipt No:", nextReceipt);
    console.log("Transaction Type:", safeTransactionType);

    // -------------------------------------------
    // 2️⃣ INSERT RECEIPT INTO VOUCHER TABLE (with batch_id)
    // -------------------------------------------
    const [receiptInsert] = await connection.promise().execute(
      `INSERT INTO voucher (
        TransactionType, VchNo, product_id, batch_id, InvoiceNumber, Date,
        PaymentTerms, Freight, TotalPacks, TaxAmount, Subtotal, BillSundryAmount,
        TotalAmount, ChequeNo, ChequeDate, BankName, AccountID, AccountName, 
        PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate, SGSTPercentage, 
        CGSTPercentage, IGSTPercentage, SGSTAmount, CGSTAmount, IGSTAmount, 
        TaxSystem, paid_amount, created_at, balance_amount, status, paid_date, 
        pdf_data, DC, pdf_file_name, pdf_created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'Immediate', 0, 0, 0, ?, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0,
              'GST', ?, ?, 0, 'Paid', ?, ?, 'C', ?, ?)`,
      [
        safeTransactionType,
        nextReceipt,
        product_id || null,
        batch_id || null, // ✅ Store batch_id in voucher table
        safeInvoiceNumber,
        currentDate,

        receiptAmount, // Subtotal
        receiptAmount, // TotalAmount
        bank_name || null,
        retailer_id || null,
        retailer_name || "",
        retailer_id || null,
        retailer_name || "",
        receiptAmount, // BasicAmount
        receiptAmount, // ValueOfGoods

        currentDate,
        receiptAmount, // paid_amount
        currentDate,   // created_at
        currentDate,   // paid_date
        null,          // pdf_data
        transaction_proof_filename,
        currentDate    // pdf_created_at
      ]
    );

    const receiptVoucherId = receiptInsert.insertId;

    console.log("✅ Voucher Inserted - VoucherID:", receiptVoucherId, "batch_id:", batch_id);

    // ---------------------------------------------------
    // 3️⃣ INSERT INTO VOUCHERDETAILS TABLE (with batch number)
    // ---------------------------------------------------
    // FIXED: Remove JavaScript comments from SQL query
    await connection.promise().execute(
      `INSERT INTO voucherdetails (
        voucher_id,
        product,
        product_id,
        InvoiceNumber,
        batch,           -- This stores batch number (batch_number)
        quantity,
        price,
        discount,
        gst,
        cgst,
        sgst,
        igst,
        cess,
        total,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptVoucherId,
        retailer_name || "",
        product_id || null,
        safeInvoiceNumber,
        batch || null,   // ✅ Store batch number here (not batch_id)
        quantity || 0,
        price || 0,
        discount || 0,
        gst || 0,
        cgst || 0,
        sgst || 0,
        igst || 0,
        cess || 0,
        total || receiptAmount,
        currentDate
      ]
    );

    console.log("✅ VoucherDetails Inserted - batch:", batch);

    // ---------------------------------------------------
    // 4️⃣ APPLY PAYMENT TO SALES VOUCHERS (ONLY RECEIPT)
    // ---------------------------------------------------
    if (retailer_id && safeTransactionType === "Receipt") {
      const [sales] = await connection.promise().query(
        `SELECT * FROM voucher 
         WHERE PartyID = ? AND TransactionType = 'Sales' 
         ORDER BY VoucherID ASC`,
        [retailer_id]
      );

      let remaining = receiptAmount;

      for (const s of sales) {
        if (remaining <= 0) break;

        const total = parseFloat(s.TotalAmount || 0);
        const paid = parseFloat(s.paid_amount || 0);
        const balance = total - paid;

        if (balance <= 0) continue;

        const apply = Math.min(remaining, balance);

        const newPaid = paid + apply;
        const newBalance = total - newPaid;
        const status = newBalance <= 0 ? "Paid" : "Partial";

        await connection.promise().execute(
          `UPDATE voucher 
           SET paid_amount = ?, balance_amount = ?, status = ?, paid_date = ? 
           WHERE VoucherID = ?`,
          [newPaid, newBalance, status, currentDate, s.VoucherID]
        );

        remaining -= apply;
      }
    }

    // -------------------------------------------
    // 5️⃣ COMMIT
    // -------------------------------------------
    await connection.promise().commit();

    res.json({
      success: true,
      message: `${safeTransactionType} created successfully`,
      receipt_no: nextReceipt,
      voucherId: receiptVoucherId,
      transaction_proof: transaction_proof_filename,
      transactionType: safeTransactionType,
      stored_batch_id: batch_id,    // For debugging
      stored_batch_number: batch    // For debugging
    });

  } catch (error) {
    if (connection) await connection.promise().rollback();
    console.error("Error creating receipt:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});




router.post('/receipts', upload.single('transaction_proof'), async (req, res) => {
  let connection;

  try {
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await connection.promise().beginTransaction();

    const {
      retailer_id,
      retailer_name,
      amount,
      bank_name,
      invoice_number,
      product_id,
      batch_id,
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
      TransactionType
    } = req.body;

    let safeTransactionType =
      TransactionType === "purchase voucher"
        ? "purchase voucher"
        : "Receipt";

    const receiptAmount = parseFloat(amount || 0);
    const currentDate = new Date();
    const safeInvoiceNumber = invoice_number || null;

    // IMPORTANT: Get the uploaded file from req.file
    let transaction_proof_filename = null;
    if (req.file) {
      transaction_proof_filename = req.file.filename; // This should be the uploaded file name
      console.log("📁 Uploaded transaction proof file:", transaction_proof_filename);
      console.log("📁 File details:", {
        originalname: req.file.originalname,
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size
      });
    } else {
      console.log("⚠️ No transaction proof file uploaded");
    }

    // -------------------------------------------
    // GET STAFF INFORMATION FROM ORIGINAL TRANSACTION
    // -------------------------------------------
    let staffIdForReceipt = null;
    let assignedStaffNameForReceipt = null;

    if (safeInvoiceNumber) {
      const [transactionRows] = await connection.promise().query(
        `SELECT staffid, assigned_staff 
         FROM voucher 
         WHERE (TransactionType = 'Stock Transfer' OR TransactionType = 'Sales')
         AND InvoiceNumber = ? 
         LIMIT 1`,
        [safeInvoiceNumber]
      );

      if (transactionRows.length > 0) {
        staffIdForReceipt = transactionRows[0].staffid;
        assignedStaffNameForReceipt = transactionRows[0].assigned_staff;
        
        console.log("👤 Staff info for receipt:", {
          staffIdForReceipt,
          assignedStaffNameForReceipt
        });
      }
    }

    // -------------------------------------------
    // 1️⃣ Generate NEXT receipt number
    // -------------------------------------------
    let queryCondition =
      safeTransactionType === "purchase voucher"
        ? "TransactionType = 'purchase voucher'"
        : "TransactionType = 'Receipt'";

    const [recRows] = await connection.promise().query(
      `SELECT VchNo 
       FROM voucher 
       WHERE ${queryCondition}
       ORDER BY VoucherID DESC
       LIMIT 1`
    );

    let nextReceipt = "REC001";
    if (recRows.length > 0) {
      const match = recRows[0].VchNo?.match(/REC(\d+)/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        nextReceipt = "REC" + nextNum.toString().padStart(3, "0");
      }
    }

    console.log("Generated Receipt No:", nextReceipt);
    console.log("Transaction Type:", safeTransactionType);

    // -------------------------------------------
    // 2️⃣ INSERT RECEIPT INTO VOUCHER TABLE (WITH STAFF INFO)
    // -------------------------------------------
    const [receiptInsert] = await connection.promise().execute(
      `INSERT INTO voucher (
        TransactionType, VchNo, product_id, batch_id, InvoiceNumber, Date,
        PaymentTerms, Freight, TotalPacks, TaxAmount, Subtotal, BillSundryAmount,
        TotalAmount, ChequeNo, ChequeDate, BankName, AccountID, AccountName, 
        PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate, SGSTPercentage, 
        CGSTPercentage, IGSTPercentage, SGSTAmount, CGSTAmount, IGSTAmount, 
        TaxSystem, paid_amount, created_at, balance_amount, status, paid_date, 
        pdf_data, DC, pdf_file_name, pdf_created_at, transaction_proof,
        staffid, assigned_staff
      )
      VALUES (?, ?, ?, ?, ?, ?, 'Immediate', 0, 0, 0, ?, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0,
              'GST', ?, ?, 0, 'Paid', ?, ?, 'C', ?, ?, ?, ?, ?)`,
      [
        safeTransactionType,
        nextReceipt,
        product_id || null,
        batch_id || null,
        safeInvoiceNumber,
        currentDate,
        receiptAmount,
        receiptAmount,
        bank_name || null,
        retailer_id || null,
        retailer_name || "",
        retailer_id || null,
        retailer_name || "",
        receiptAmount,
        receiptAmount,
        currentDate,
        receiptAmount,
        currentDate,
        currentDate,
        null,
        null, // pdf_file_name
        currentDate,
        transaction_proof_filename, // transaction_proof
        staffIdForReceipt, // staffid
        assignedStaffNameForReceipt // assigned_staff
      ]
    );

    const receiptVoucherId = receiptInsert.insertId;

    // ---------------------------------------------------
    // 3️⃣ INSERT INTO VOUCHERDETAILS TABLE
    // ---------------------------------------------------
    await connection.promise().execute(
      `INSERT INTO voucherdetails (
        voucher_id,
        product,
        product_id,
        InvoiceNumber,
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
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptVoucherId,
        retailer_name || "",
        product_id || null,
        safeInvoiceNumber,
        batch || null,
        quantity || 0,
        price || 0,
        discount || 0,
        gst || 0,
        cgst || 0,
        sgst || 0,
        igst || 0,
        cess || 0,
        total || receiptAmount,
        currentDate
      ]
    );

    // ---------------------------------------------------
    // 4️⃣ UNPAID AMOUNT DEDUCTION (Only for transactions with order_number)
    // ---------------------------------------------------
    if (safeTransactionType === "Receipt" && retailer_id) {
      console.log(`🔍 Checking if unpaid amount deduction is applicable...`);
      
      try {
        // First, find the transaction to check if it has order_number
        const [transactionRows] = await connection.promise().query(
          `SELECT TransactionType, order_number, TotalAmount 
           FROM voucher 
           WHERE (TransactionType = 'Stock Transfer' OR TransactionType = 'Sales')
           AND InvoiceNumber = ? 
           LIMIT 1`,
          [safeInvoiceNumber]
        );

        if (transactionRows.length > 0) {
          const transactionRow = transactionRows[0];
          const transactionType = transactionRow.TransactionType;
          const orderNumber = transactionRow.order_number;
          
          console.log("📊 Transaction Found for unpaid deduction check:", {
            invoiceNumber: safeInvoiceNumber,
            transactionType: transactionType,
            order_number: orderNumber,
            retailer_id: retailer_id
          });

          // ONLY proceed with unpaid amount deduction if order_number exists
          if (orderNumber) {
            console.log(`✅ Order number found (${orderNumber}), proceeding with unpaid amount deduction`);
            console.log(`💰 UNPAID AMOUNT DEDUCTION - PartyID: ${retailer_id}, Amount: ${receiptAmount}`);
            
            const tableCheck = await connection.promise().query(
              "SHOW COLUMNS FROM accounts LIKE 'unpaid_amount'"
            );
            
            if (tableCheck[0].length === 0) {
              console.warn("⚠️ 'unpaid_amount' column not found in accounts table.");
            } else {
              const [currentAccount] = await connection.promise().query(
                "SELECT unpaid_amount FROM accounts WHERE id = ?",
                [retailer_id]
              );
              
              if (currentAccount.length === 0) {
                console.warn(`⚠️ Account with id ${retailer_id} not found in accounts table.`);
              } else {
                const currentUnpaid = parseFloat(currentAccount[0].unpaid_amount) || 0;
                const newUnpaid = currentUnpaid - receiptAmount;
                
                await connection.promise().query(
                  `
                  UPDATE accounts 
                  SET unpaid_amount = ?,
                      updated_at = NOW()
                  WHERE id = ?
                  `,
                  [newUnpaid, retailer_id]
                );
                
                console.log(`✅ UNPAID AMOUNT UPDATED - Old: ${currentUnpaid}, New: ${newUnpaid}, Difference: -${receiptAmount}`);
              }
            }
          } else {
            console.log(`❌ Order number is NULL/empty. UNPAID AMOUNT DEDUCTION SKIPPED.`);
            console.log(`ℹ️ Only transactions with order_number qualify for unpaid amount updates`);
          }
        } else {
          console.log(`⚠️ No matching Stock Transfer or Sales found for InvoiceNumber: ${safeInvoiceNumber}`);
          console.log(`ℹ️ Unpaid amount deduction requires matching transaction`);
        }
      } catch (error) {
        console.error(`❌ ERROR in unpaid amount deduction check:`, error.message);
      }
    }

    if (safeTransactionType === "Receipt" && safeInvoiceNumber) {
      console.log("🔍 Looking for matching transaction with InvoiceNumber:", safeInvoiceNumber);
      
      // Find transaction with order_number
      const [transactionRows] = await connection.promise().query(
        `SELECT staffid, staff_incentive, TransactionType, order_number 
         FROM voucher 
         WHERE (TransactionType = 'Stock Transfer' OR TransactionType = 'Sales')
         AND InvoiceNumber = ? 
         LIMIT 1`,
        [safeInvoiceNumber]
      );

      if (transactionRows.length > 0) {
        const transactionRow = transactionRows[0];
        const staffIdFromTransfer = transactionRow.staffid;
        const transactionType = transactionRow.TransactionType;
        const orderNumber = transactionRow.order_number;
        
        console.log("📊 Transaction Row Found:", {
          invoiceNumber: safeInvoiceNumber,
          transactionType: transactionType,
          order_number: orderNumber,
          staff_id_from_transfer: staffIdFromTransfer,
          staff_incentive_percentage: transactionRow.staff_incentive,
          receipt_paid_amount: receiptAmount
        });

        // IMPORTANT: Only proceed if order_number exists
        if (orderNumber) {
          console.log("✅ Order number exists, proceeding with staff incentive calculation");
          
          if (staffIdFromTransfer) {
            let staffIncentivePercentage = 0;
            
            if (transactionRow.staff_incentive !== null && transactionRow.staff_incentive !== undefined) {
              staffIncentivePercentage = parseFloat(transactionRow.staff_incentive);
            }
            
            console.log("ℹ️ Staff Incentive Percentage from transaction:", staffIncentivePercentage);

            if (staffIncentivePercentage > 0) {
              const calculatedIncentive = (receiptAmount * staffIncentivePercentage) / 100;
              const roundedIncentive = parseFloat(calculatedIncentive.toFixed(2));
              
              console.log("💰 Incentive Calculation:", {
                receiptAmount: receiptAmount,
                staffIncentivePercentage: staffIncentivePercentage + "%",
                calculatedIncentive: roundedIncentive
              });

              const [accountExists] = await connection.promise().query(
                `SELECT id, staff_incentive, name FROM accounts WHERE id = ?`,
                [staffIdFromTransfer]
              );

              console.log("🔍 Looking for staff in accounts table with ID:", staffIdFromTransfer);
              console.log("🔍 Account found:", accountExists.length > 0 ? accountExists[0] : "No account found");

              if (accountExists.length > 0) {
                const currentIncentive = accountExists[0].staff_incentive !== null 
                  ? parseFloat(accountExists[0].staff_incentive) || 0 
                  : 0;
                
                const newTotalIncentive = currentIncentive + roundedIncentive;
                const staffName = accountExists[0].name || "Unknown";
                
                await connection.promise().execute(
                  `UPDATE accounts SET staff_incentive = ? WHERE id = ?`,
                  [newTotalIncentive, staffIdFromTransfer]
                );
                
                console.log("✅ Incentive added to staff account:", {
                  accounts_id: staffIdFromTransfer,
                  staff_name: staffName,
                  transaction_type: transactionType,
                  order_number: orderNumber,
                  previous_incentive: currentIncentive,
                  added_incentive: roundedIncentive,
                  new_total_incentive: newTotalIncentive
                });
              } else {
                console.log("❌ Staff not found in accounts table with ID:", staffIdFromTransfer);
              }
            } else {
              console.log("ℹ️ No staff_incentive percentage found or it's 0 in transaction row");
            }
          } else {
            console.log("⚠️ No staffid found in transaction row");
          }
        } else {
          console.log("❌ Order number is NULL/empty. Staff incentive calculation SKIPPED.");
          console.log("ℹ️ Only transactions with order_number qualify for staff incentives");
        }
      } else {
        console.log("⚠️ No matching Stock Transfer or Sales found for InvoiceNumber:", safeInvoiceNumber);
      }
    }

    await connection.promise().commit();

    res.json({
      success: true,
      message: `${safeTransactionType} created successfully`,
      receipt_no: nextReceipt,
      voucherId: receiptVoucherId,
      transaction_proof: transaction_proof_filename,
      transactionType: safeTransactionType,
      stored_batch_id: batch_id,
      stored_batch_number: batch,
      staffid: staffIdForReceipt, // Include in response
      assigned_staff: assignedStaffNameForReceipt // Include in response
    });

  } catch (error) {
    if (connection) await connection.promise().rollback();
    console.error("Error creating receipt:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
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
        VoucherID,
        InvoiceNumber,
        TotalAmount,
        paid_amount,
        balance_amount,
        paid_date,
        status,
        PartyName,
        Date,
        PartyID,
        TaxAmount,
        Subtotal
      FROM voucher 
      WHERE InvoiceNumber = ?
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
    
    res.json({
      success: true,
      data: results[0]
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


router.post('/receipts', async (req, res) => {
  let connection;
  try {
    // Get DB connection
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    // Start transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    const {
      receipt_number,
      retailer_id,
      retailer_name,
      amount,
      currency,
      payment_method,
      receipt_date,
      note,
      bank_name,
      transaction_date,
      reconciliation_option,
      invoice_number
    } = req.body;

    // Validate receipt_number
    if (!receipt_number || !receipt_number.match(/^REC\d+$/)) {
      throw new Error('Invalid receipt number format');
    }

    // Check if receipt number already exists
    const existingReceipt = await new Promise((resolve, reject) => {
      connection.execute(
        `SELECT receipt_number FROM receipts WHERE receipt_number = ?`,
        [receipt_number],
        (err, results) => {
          if (err) reject(err);
          else resolve(results[0]);
        }
      );
    });

    if (existingReceipt) {
      throw new Error(`Receipt number ${receipt_number} already exists`);
    }

    const receiptAmount = parseFloat(amount || 0);

    // Step 1: Insert receipt in receipts table
    const receiptResult = await new Promise((resolve, reject) => {
      connection.execute(
        `INSERT INTO receipts (
          receipt_number, retailer_id, amount, currency, payment_method,
          receipt_date, note, bank_name, transaction_date, reconciliation_option
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receipt_number,
          retailer_id || null,
          receiptAmount,
          currency || 'INR',
          payment_method || 'Direct Deposit',
          receipt_date || new Date(),
          note || '',
          bank_name || '',
          transaction_date || null,
          reconciliation_option || 'Do Not Reconcile',
        ],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    // Step 2: Apply receipt to existing Sales vouchers
    if (retailer_id) {
      let voucherQuery = `SELECT * FROM voucher WHERE PartyID = ? AND TransactionType='Sales'`;
      const queryParams = [retailer_id];

      if (invoice_number) {
        voucherQuery += ` AND InvoiceNumber = ?`;
        queryParams.push(invoice_number);
      }

      voucherQuery += ` ORDER BY Date ASC, VoucherID ASC`;

      const vouchers = await new Promise((resolve, reject) => {
        connection.execute(voucherQuery, queryParams, (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      if (vouchers && vouchers.length > 0) {
        let remainingAmount = receiptAmount;
        const currentDate = new Date();

        // Get previous receipt balance to calculate current balance
        const previousReceipts = await new Promise((resolve, reject) => {
          connection.execute(
            `SELECT * FROM voucher WHERE PartyID = ? AND TransactionType='Receipt' ORDER BY VoucherID DESC LIMIT 1`,
            [retailer_id],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            }
          );
        });

        let previousBalance = 0;
        if (previousReceipts && previousReceipts.length > 0) {
          previousBalance = parseFloat(previousReceipts[0].balance_amount || 0);
        } else {
          // If no previous receipts, use sales total amount as starting balance
          previousBalance = parseFloat(vouchers[0].TotalAmount || 0);
        }

        for (const voucher of vouchers) {
          if (remainingAmount <= 0) break;

          const totalAmount = parseFloat(voucher.TotalAmount || 0);
          
          // Calculate current balance based on previous receipt balance
          const currentBalance = previousBalance;
          const amountToApply = Math.min(remainingAmount, currentBalance);
          if (amountToApply <= 0) continue;

          remainingAmount -= amountToApply;
          const updatedBalanceAmount = currentBalance - amountToApply;

          // FIXED: DO NOT update sales voucher at all - keep it original
          // No UPDATE query for sales voucher

          // FIXED: Create receipt entry with cumulative calculations
          await new Promise((resolve, reject) => {
            connection.execute(
              `INSERT INTO voucher (
                TransactionType, VchNo, InvoiceNumber, Date, PaymentTerms, Freight,
                TotalQty, TotalPacks, TotalQty1, TaxAmount, Subtotal, BillSundryAmount,
                TotalAmount, ChequeNo, ChequeDate, BankName, AccountID, AccountName,
                PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate,
                SGSTPercentage, CGSTPercentage, IGSTPercentage, SGSTAmount, CGSTAmount, IGSTAmount,
                TaxSystem, BatchDetails, paid_amount, balance_amount, receipt_number, status, paid_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                'Receipt',
                receipt_number,
                voucher.InvoiceNumber,
                currentDate,
                'Immediate',
                0.00,
                0.00,
                0,
                0,
                0.00,
                amountToApply,
                0.00,
                currentBalance, // TotalAmount = previous balance (not amount paid)
                null,
                null,
                bank_name || '',
                voucher.AccountID,
                voucher.AccountName,
                voucher.PartyID,
                retailer_name || voucher.PartyName,
                amountToApply,
                amountToApply,
                currentDate,
                0.00,
                0.00,
                0.00,
                0.00,
                0.00,
                0.00,
                'GST',
                '[]',
                amountToApply, // paid_amount = amount paid in this receipt
                updatedBalanceAmount, // balance_amount = remaining balance after this payment
                receipt_number,
                updatedBalanceAmount <= 0.01 ? 'Paid' : 'Partial',
                currentDate
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });

          // Update previous balance for next iteration
          previousBalance = updatedBalanceAmount;
        }

        // If leftover amount, create advance payment row
        if (remainingAmount > 0) {
          await new Promise((resolve, reject) => {
            connection.execute(
              `INSERT INTO voucher (
                TransactionType, VchNo, Date, TotalAmount, BankName,
                PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate,
                paid_amount, balance_amount, receipt_number, status, paid_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                'Receipt',
                receipt_number,
                currentDate,
                previousBalance, // Show previous balance as TotalAmount
                bank_name,
                retailer_id,
                retailer_name,
                remainingAmount,
                remainingAmount,
                currentDate,
                remainingAmount,
                0,
                receipt_number,
                'Paid',
                currentDate
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
      } else {
        // No sales vouchers found: simple receipt entry (advance payment)
        await new Promise((resolve, reject) => {
          connection.execute(
            `INSERT INTO voucher (
              TransactionType, VchNo, Date, TotalAmount, BankName,
              PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate,
              paid_amount, balance_amount, receipt_number, status, paid_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              'Receipt',
              receipt_number,
              new Date(),
              receiptAmount,
              bank_name,
              retailer_id,
              retailer_name,
              receiptAmount,
              receiptAmount,
              new Date(),
              receiptAmount,
              0,
              receipt_number,
              'Paid',
              new Date()
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    }

    // Commit transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.status(201).json({
      id: receiptResult.insertId,
      message: 'Receipt created and applied to vouchers successfully',
      receipt_number
    });

  } catch (error) {
    if (connection) {
      await new Promise(resolve => connection.rollback(() => resolve()));
    }
    console.error('Error in create receipt route:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'VoucherID must be AUTO_INCREMENT in voucher table' });
    }
    res.status(500).json({ error: error.message || 'Failed to create receipt' });
  } finally {
    if (connection) connection.release();
  }
});
module.exports = router;