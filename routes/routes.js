const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/receipts');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: receipt_{timestamp}_{originalname}
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    cb(null, 'receipt_' + uniqueSuffix + fileExtension);
  }
});

// File filter for allowed types
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG, PNG, DOC, DOCX are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// ------------------------------
// Get next receipt number
// ------------------------------
router.get('/next-receipt-number', async (req, res) => {
  try {
    db.execute(
      // Use receipt_number column from voucher table and ensure correct sorting
      `SELECT receipt_number 
       FROM voucher 
       WHERE receipt_number IS NOT NULL AND receipt_number != ''
       ORDER BY CAST(SUBSTRING(receipt_number, 4) AS UNSIGNED) DESC 
       LIMIT 1`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching next receipt number:', error);
          return res.status(500).json({ error: 'Failed to fetch next receipt number' });
        }

        let nextReceiptNumber = 'REC001';

        if (results && results.length > 0 && results[0].receipt_number) {
          const lastNumber = results[0].receipt_number;
          const match = lastNumber.match(/REC(\d+)/);

          if (match) {
            const nextNum = parseInt(match[1], 10) + 1;
            nextReceiptNumber = `REC${nextNum.toString().padStart(3, '0')}`;
          }
        }

        console.log('Next receipt number:', nextReceiptNumber);
        res.json({ nextReceiptNumber });
      }
    );
  } catch (error) {
    console.error('Error in next receipt number route:', error);
    res.status(500).json({ error: 'Failed to fetch next receipt number' });
  }
});




router.post('/receipts', upload.single('transaction_proof'), async (req, res) => {
  let connection;

  try {
    // ✅ Get DB connection
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    // ✅ Start transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // ✅ Extract data from frontend safely
    const {
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
      invoice_number,
      product_id,
      TransactionType,
      batch_id
    } = req.body;

    // ✅ Safe variables
    const safeTransactionType = TransactionType || 'Receipt';
    const safeProductId = product_id || null;
    const safeBatchId = batch_id || null;
    const safeInvoiceNumber = invoice_number || null;
    const safeReceiptDate = receipt_date ? new Date(receipt_date) : new Date();
    const safeBankName = bank_name || null;
    const safeRetailerId = retailer_id || null;
    const safeRetailerName = retailer_name || '';
    const receiptAmount = parseFloat(amount || 0);
    const currentDate = new Date();
    const cashBankAccountID = 1;
    const cashBankAccountName = bank_name ? `${bank_name} Bank` : 'Cash Account';

    // ✅ Handle uploaded file
    let transaction_proof_filename = null;
    if (req.file) transaction_proof_filename = req.file.filename;

    // ✅ Fetch last receipt_number from voucher table
    const [rows] = await connection.promise().query(
      `SELECT receipt_number 
       FROM voucher 
       WHERE receipt_number IS NOT NULL AND receipt_number != ''
       ORDER BY CAST(SUBSTRING(receipt_number, 4) AS UNSIGNED) DESC 
       LIMIT 1`
    );

    // ✅ Generate next receipt number
    let receipt_number = 'REC001';
    if (rows.length > 0 && rows[0].receipt_number) {
      const match = rows[0].receipt_number.match(/REC(\d+)/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        receipt_number = `REC${nextNum.toString().padStart(3, '0')}`;
      }
    }

    console.log('🧾 Generated new receipt number:', receipt_number);

    // ✅ Insert new receipt voucher
    const [voucherResult] = await connection.promise().execute(
      `INSERT INTO voucher (
        TransactionType, VchNo, product_id, batch_id, InvoiceNumber, Date, 
        PaymentTerms, Freight, TotalQty, TotalPacks, TotalQty1, TaxAmount, 
        Subtotal, BillSundryAmount, TotalAmount, ChequeNo, ChequeDate, BankName, 
        AccountID, AccountName, PartyID, PartyName, BasicAmount, ValueOfGoods, 
        EntryDate, SGSTPercentage, CGSTPercentage, IGSTPercentage, SGSTAmount, 
        CGSTAmount, IGSTAmount, TaxSystem, BatchDetails, paid_amount, created_at, 
        balance_amount, receipt_number, status, paid_date, pdf_data, DC, 
        pdf_file_name, pdf_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safeTransactionType, receipt_number, safeProductId, safeBatchId,
        safeInvoiceNumber, safeReceiptDate, 'Immediate',
        0, 0, 0, 0, 0,
        receiptAmount, 0, receiptAmount, null, null,
        safeBankName, safeRetailerId, cashBankAccountName,
        safeRetailerId, safeRetailerName, receiptAmount, receiptAmount,
        currentDate, 0, 0, 0, 0, 0, 0, 'GST', '[]',
        receiptAmount, currentDate, 0, receipt_number, 'Paid',
        currentDate, null, 'C', null, null
      ]
    );

    const voucherId = voucherResult.insertId;
    console.log('✅ Receipt voucher created with ID:', voucherId);

    // ✅ Apply payment to sales vouchers
    if (safeRetailerId) {
      let voucherQuery = `
        SELECT * FROM voucher 
        WHERE PartyID = ? 
        AND TransactionType = 'Sales' 
        AND (status != 'Paid' OR status IS NULL)
      `;
      const queryParams = [safeRetailerId];

      if (safeInvoiceNumber) {
        voucherQuery += ` AND InvoiceNumber = ?`;
        queryParams.push(safeInvoiceNumber);
      }

      voucherQuery += ` ORDER BY Date ASC, VoucherID ASC`;

      const [salesVouchers] = await connection.promise().query(voucherQuery, queryParams);

      if (salesVouchers.length > 0) {
        let remainingAmount = receiptAmount;

        for (const voucher of salesVouchers) {
          if (remainingAmount <= 0) break;

          const totalAmount = parseFloat(voucher.TotalAmount || 0);
          const alreadyPaid = parseFloat(voucher.paid_amount || 0);
          const outstandingBalance = totalAmount - alreadyPaid;

          if (outstandingBalance <= 0) continue;

          const amountToApply = Math.min(remainingAmount, outstandingBalance);
          const newPaidAmount = alreadyPaid + amountToApply;
          const newBalanceAmount = totalAmount - newPaidAmount;
          const newStatus = newBalanceAmount <= 0.01 ? 'Paid' : 'Partial';

          await connection.promise().execute(
            `UPDATE voucher SET 
              paid_amount = ?, 
              balance_amount = ?, 
              status = ?, 
              paid_date = ? 
             WHERE VoucherID = ?`,
            [newPaidAmount, newBalanceAmount, newStatus, currentDate, voucher.VoucherID]
          );

          remainingAmount -= amountToApply;
          console.log(`Applied ₹${amountToApply} to Sales Voucher ${voucher.VoucherID}, Remaining: ₹${remainingAmount}`);
        }

        if (remainingAmount > 0) {
          console.log('💰 Advance payment voucher created.');
        }
      } else {
        await connection.promise().execute(
          `UPDATE voucher SET status = 'Advance' WHERE VoucherID = ?`,
          [voucherId]
        );
        console.log('ℹ️ No Sales found — marked as Advance.');
      }
    }

    // ✅ Commit transaction
    await connection.promise().commit();

    res.status(201).json({
      id: voucherId,
      message: 'Receipt created successfully',
      receipt_number,
      transaction_proof_filename,
      product_id: safeProductId,
      batch_id: safeBatchId
    });

  } catch (error) {
    if (connection) await connection.promise().rollback();
    if (req.file) fs.unlinkSync(req.file.path);

    console.error('❌ Error in create receipt route:', error);
    res.status(500).json({ error: error.message || 'Failed to create receipt' });
  } finally {
    if (connection) connection.release();
  }
});


router.get('/receipts-with-vouchers', async (req, res) => {
  try {
    const query = `
      SELECT 
        v1.*, 
        a.business_name,
        a.name AS account_name,
        GROUP_CONCAT(DISTINCT v2.InvoiceNumber) AS related_invoices,
        SUM(v2.TotalAmount) AS total_invoice_amount,
        SUM(v2.paid_amount) AS total_paid_amount,
        SUM(v2.balance_amount) AS total_balance_amount
      FROM voucher v1
      LEFT JOIN accounts a ON v1.PartyID = a.id
      LEFT JOIN voucher v2 
        ON v1.receipt_number = v2.receipt_number
        AND v2.TransactionType IN ('Sales', 'Purchase', 'Invoice')
      WHERE v1.TransactionType = 'Receipt'
      GROUP BY v1.VoucherID
      ORDER BY v1.created_at DESC
    `;

    db.execute(query, (error, results) => {
      if (error) {
        console.error('Database error fetching vouchers with receipts:', error);
        return res.status(500).json({ error: 'Failed to fetch receipts' });
      }

      res.json(results || []);
    });
  } catch (error) {
    console.error('Error in /receipts-with-vouchers route:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});


// ------------------------------
// Get last receipt (fallback)
// ------------------------------
router.get('/last-receipt', async (req, res) => {
  try {
    db.execute(
      `SELECT receipt_number 
       FROM voucher 
       WHERE TransactionType = 'Receipt' 
       ORDER BY VoucherID DESC 
       LIMIT 1`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching last receipt from voucher:', error);
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
    console.error('Error in /last-receipt route:', error);
    res.status(500).json({ error: 'Failed to fetch last receipt' });
  }
});


// ------------------------------
// Get all receipts
// ------------------------------
router.get('/receipts', async (req, res) => {
  try {
    db.execute(
      `SELECT 
         v.*, 
         a.business_name, 
         a.name AS payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
           FROM voucher v2
           WHERE v2.receipt_number = v.receipt_number
           AND v2.TransactionType IN ('Sales', 'Receipt')
           AND v2.InvoiceNumber IS NOT NULL
           AND v2.InvoiceNumber != ''
         ) AS invoice_numbers
       FROM voucher v
       LEFT JOIN accounts a ON v.PartyID = a.id
       WHERE v.TransactionType = 'Receipt'
       ORDER BY v.created_at DESC`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching vouchers (receipts):', error);
          return res.status(500).json({ error: 'Failed to fetch receipts' });
        }

        // Convert invoice_numbers string to array
        const processedResults = results.map(voucher => ({
          ...voucher,
          invoice_numbers: voucher.invoice_numbers ? voucher.invoice_numbers.split(',') : []
        }));

        console.log('Receipts fetched from voucher table:', processedResults.length);
        res.json(processedResults || []);
      }
    );
  } catch (error) {
    console.error('Error in /receipts route:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});


// ------------------------------
// Get receipt by ID
// ------------------------------
router.get('/receipts/:id', async (req, res) => {
  try {
    db.execute(
      `SELECT 
         v.*, 
         a.business_name, 
         a.name AS payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
           FROM voucher v2
           WHERE v2.receipt_number = v.receipt_number
           AND v2.TransactionType IN ('Sales', 'Receipt')
           AND v2.InvoiceNumber IS NOT NULL
           AND v2.InvoiceNumber != ''
         ) AS invoice_numbers
       FROM voucher v
       LEFT JOIN accounts a ON v.PartyID = a.id
       WHERE v.VoucherID = ? 
       AND v.TransactionType = 'Receipt'`,
      [req.params.id],
      (error, results) => {
        if (error) {
          console.error('Database error fetching receipt from voucher:', error);
          return res.status(500).json({ error: 'Failed to fetch receipt' });
        }

        if (!results || results.length === 0) {
          return res.status(404).json({ error: 'Receipt not found' });
        }

        // Convert invoice_numbers to array
        const receipt = {
          ...results[0],
          invoice_numbers: results[0].invoice_numbers
            ? results[0].invoice_numbers.split(',')
            : []
        };

        console.log('Receipt fetched from voucher table:', receipt);
        res.json(receipt);
      }
    );
  } catch (error) {
    console.error('Error in /receipts/:id route:', error);
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});


// router.put('/voucher/:id', upload.single('transaction_proof'), async (req, res) => {
//   const voucherId = req.params.id;
//   console.log("voucherId",voucherId)
//   let connection;

//   try {
//     // 🔹 Get DB connection
//     connection = await new Promise((resolve, reject) => {
//       db.getConnection((err, conn) => {
//         if (err) reject(err);
//         else resolve(conn);
//       });
//     });

//     // 🔹 Start transaction
//     await new Promise((resolve, reject) => {
//       connection.beginTransaction(err => (err ? reject(err) : resolve()));
//     });

//     // 🔹 Destructure body safely
//     const {
//       TransactionType,
//       VchNo,
//       product_id,
//       batch_id,
//       InvoiceNumber,
//       Date: voucherDate,
//       PaymentTerms,
//       Freight,
//       TotalQty,
//       TotalPacks,
//       TotalQty1,
//       TaxAmount,
//       Subtotal,
//       BillSundryAmount,
//       TotalAmount,
//       ChequeNo,
//       ChequeDate,
//       BankName,
//       AccountID,
//       AccountName,
//       PartyID,
//       PartyName,
//       BasicAmount,
//       ValueOfGoods,
//       EntryDate,
//       SGSTPercentage,
//       CGSTPercentage,
//       IGSTPercentage,
//       SGSTAmount,
//       CGSTAmount,
//       IGSTAmount,
//       TaxSystem,
//       BatchDetails,
//       paid_amount,
//       balance_amount,
//       receipt_number,
//       status,
//       paid_date,
//       pdf_data,
//       DC,
//       pdf_file_name,
//     } = req.body;
// console.log(req.body)
//     // 🔹 Current timestamp
//     const pdf_created_at = new Date();

//     // 🔹 Handle uploaded proof file (optional)
//     let transaction_proof_filename = null;
//     if (req.file) transaction_proof_filename = req.file.filename;

//     // 🔹 Verify voucher existence
//     const [existingVoucher] = await new Promise((resolve, reject) => {
//       connection.execute(
//         'SELECT * FROM voucher WHERE VoucherID = ?',
//         [voucherId],
//         (error, results) => (error ? reject(error) : resolve(results))
//       );
//     });

//     if (!existingVoucher) {
//       connection.release();
//       return res.status(404).json({ error: 'Voucher not found' });
//     }

//     // 🔹 Build dynamic update
//     const updateFields = [
//       'TransactionType = ?',
//       'VchNo = ?',
//       'product_id = ?',
//       'batch_id = ?',
//       'InvoiceNumber = ?',
//       'Date = ?',
//       'PaymentTerms = ?',
//       'Freight = ?',
//       'TotalQty = ?',
//       'TotalPacks = ?',
//       'TotalQty1 = ?',
//       'TaxAmount = ?',
//       'Subtotal = ?',
//       'BillSundryAmount = ?',
//       'TotalAmount = ?',
//       'ChequeNo = ?',
//       'ChequeDate = ?',
//       'BankName = ?',
//       'AccountID = ?',
//       'AccountName = ?',
//       'PartyID = ?',
//       'PartyName = ?',
//       'BasicAmount = ?',
//       'ValueOfGoods = ?',
//       'EntryDate = ?',
//       'SGSTPercentage = ?',
//       'CGSTPercentage = ?',
//       'IGSTPercentage = ?',
//       'SGSTAmount = ?',
//       'CGSTAmount = ?',
//       'IGSTAmount = ?',
//       'TaxSystem = ?',
//       'BatchDetails = ?',
//       'paid_amount = ?',
//       'balance_amount = ?',
//       'receipt_number = ?',
//       'status = ?',
//       'paid_date = ?',
//       'pdf_data = ?',
//       'DC = ?',
//       'pdf_file_name = ?',
//       'pdf_created_at = ?'
//     ];

//     const updateValues = [
//       TransactionType,
//       VchNo,
//       product_id,
//       batch_id,
//       InvoiceNumber,
//       voucherDate,
//       PaymentTerms,
//       Freight,
//       TotalQty,
//       TotalPacks,
//       TotalQty1,
//       TaxAmount,
//       Subtotal,
//       BillSundryAmount,
//       TotalAmount,
//       ChequeNo,
//       ChequeDate,
//       BankName,
//       AccountID,
//       AccountName,
//       PartyID,
//       PartyName,
//       BasicAmount,
//       ValueOfGoods,
//       EntryDate,
//       SGSTPercentage,
//       CGSTPercentage,
//       IGSTPercentage,
//       SGSTAmount,
//       CGSTAmount,
//       IGSTAmount,
//       TaxSystem,
//       BatchDetails,
//       paid_amount,
//       balance_amount,
//       receipt_number,
//       status,
//       paid_date,
//       pdf_data,
//       DC,
//       pdf_file_name || null,
//       pdf_created_at
//     ];

//     // Add proof if uploaded
//     if (transaction_proof_filename) {
//       updateFields.push('transaction_proof_filename = ?');
//       updateValues.push(transaction_proof_filename);
//     }

//     // Always append VoucherID last for WHERE
//     updateValues.push(voucherId);

//     // 🔹 Sanitize undefined → null
//     const sanitizedValues = updateValues.map(v => (v === undefined ? null : v));

//     // 🔹 Execute update
//     await new Promise((resolve, reject) => {
//       connection.execute(
//         `UPDATE voucher SET ${updateFields.join(', ')} WHERE VoucherID = ?`,
//         sanitizedValues,
//         (error, results) => (error ? reject(error) : resolve(results))
//       );
//     });

//     // 🔹 Delete old proof if replaced
//     if (transaction_proof_filename && existingVoucher.transaction_proof_filename) {
//       const oldFilePath = path.join(__dirname, '../uploads/vouchers', existingVoucher.transaction_proof_filename);
//       if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
//     }

//     // 🔹 Commit changes
//     await new Promise((resolve, reject) => {
//       connection.commit(err => (err ? reject(err) : resolve()));
//     });

//     connection.release();
//     res.json({
//       success: true,
//       message: 'Voucher updated successfully',
//       VoucherID: voucherId,
//       transaction_proof_filename
//     });

//   } catch (error) {
//     console.error('Error updating voucher:', error);

//     if (connection) {
//       await new Promise(resolve => connection.rollback(() => resolve()));
//       connection.release();
//     }

//     if (req.file) fs.unlinkSync(req.file.path);

//     res.status(500).json({
//       success: false,
//       error: error.message || 'Failed to update voucher'
//     });
//   }
// });

router.put('/voucher/:id', upload.single('transaction_proof'), async (req, res) => {
  const voucherId = req.params.id;
  let connection;

  try {
    // Get DB connection
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });

    // Start transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => (err ? reject(err) : resolve()));
    });

    // Build update dynamically from req.body
    const updateFields = [];
    const updateValues = [];

    // Special handling for paid_amount - update both paid_amount and TotalAmount
    if (req.body.paid_amount !== undefined) {
      const paidAmount = req.body.paid_amount;
      
      // Update both paid_amount and TotalAmount with the same value
      updateFields.push('paid_amount = ?', 'TotalAmount = ?');
      updateValues.push(paidAmount, paidAmount);
      
      // Calculate balance_amount (should be 0 since both are same)
      const balanceAmount = 0;
      updateFields.push('balance_amount = ?');
      updateValues.push(balanceAmount);
      
      // Update status to Paid since full amount is paid
      updateFields.push('status = ?');
      updateValues.push('Paid');
      
      // Update paid_date to current timestamp
      updateFields.push('paid_date = ?');
      updateValues.push(new Date());
    }

    // Add other fields from req.body (excluding paid_amount since we already handled it)
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'paid_amount') { // Skip paid_amount as we already handled it
        updateFields.push(`${key} = ?`);
        updateValues.push(value === undefined ? null : value);
      }
    }

    // Add uploaded file if exists
    if (req.file) {
      updateFields.push(`transaction_proof_filename = ?`);
      updateValues.push(req.file.filename);
    }

    // Always append voucherId for WHERE
    updateValues.push(voucherId);

    // Execute update
    const sql = `UPDATE voucher SET ${updateFields.join(', ')} WHERE VoucherID = ?`;

    await new Promise((resolve, reject) => {
      connection.execute(sql, updateValues, (err, result) =>
        err ? reject(err) : resolve(result)
      );
    });

    // Commit
    await new Promise((resolve, reject) => {
      connection.commit(err => (err ? reject(err) : resolve()));
    });

    connection.release();

    res.json({
      success: true,
      message: 'Voucher updated successfully',
      VoucherID: voucherId,
    });

  } catch (error) {
    console.error('Error updating voucher:', error);
    if (connection) {
      await new Promise(resolve => connection.rollback(() => resolve()));
      connection.release();
    }

    if (req.file) fs.unlinkSync(req.file.path);

    res.status(500).json({ success: false, error: error.message });
  }
});

// router.put('/voucher/:id', upload.single('transaction_proof'), async (req, res) => {
//   const voucherId = req.params.id;
//   let connection;

//   try {
//     // Get DB connection
//     connection = await new Promise((resolve, reject) => {
//       db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
//     });

//     // Start transaction
//     await new Promise((resolve, reject) => {
//       connection.beginTransaction(err => (err ? reject(err) : resolve()));
//     });

//     // Build update dynamically from req.body
//     const updateFields = [];
//     const updateValues = [];

//     for (const [key, value] of Object.entries(req.body)) {
//       updateFields.push(`${key} = ?`);
//       updateValues.push(value === undefined ? null : value);
//     }

//     // Add uploaded file if exists
//     if (req.file) {
//       updateFields.push(`transaction_proof_filename = ?`);
//       updateValues.push(req.file.filename);
//     }

//     // Always append voucherId for WHERE
//     updateValues.push(voucherId);

//     // Execute update
//     const sql = `UPDATE voucher SET ${updateFields.join(', ')} WHERE VoucherID = ?`;

//     await new Promise((resolve, reject) => {
//       connection.execute(sql, updateValues, (err, result) =>
//         err ? reject(err) : resolve(result)
//       );
//     });

//     // Commit
//     await new Promise((resolve, reject) => {
//       connection.commit(err => (err ? reject(err) : resolve()));
//     });

//     connection.release();

//     res.json({
//       success: true,
//       message: 'Voucher updated successfully',
//       VoucherID: voucherId,
//     });

//   } catch (error) {
//     console.error('Error updating voucher:', error);
//     if (connection) {
//       await new Promise(resolve => connection.rollback(() => resolve()));
//       connection.release();
//     }

//     if (req.file) fs.unlinkSync(req.file.path);

//     res.status(500).json({ success: false, error: error.message });
//   }
// });


// ✅ DELETE Receipt (without touching ledger table)
router.delete('/receipts/:id', async (req, res) => {
  let connection;
  try {
    // Get DB connection
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    // Begin transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 1️⃣ Fetch the voucher (Receipt type)
    const receipt = await new Promise((resolve, reject) => {
      connection.execute(
        `SELECT * FROM voucher WHERE VoucherID = ? AND TransactionType = "Receipt"`,
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results[0]);
        }
      );
    });

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found in voucher table' });
    }

    const receiptAmount = parseFloat(receipt.TotalAmount);
    const receiptNumber = receipt.receipt_number;
    const retailerId = receipt.PartyID;

    // 2️⃣ Update related Sales vouchers (reverse paid amount)
    if (retailerId && receiptNumber) {
      const salesVouchers = await new Promise((resolve, reject) => {
        connection.execute(
          `SELECT * FROM voucher 
           WHERE PartyID = ? AND receipt_number = ? AND TransactionType = "Sales"`,
          [retailerId, receiptNumber],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      for (const voucher of salesVouchers) {
        const currentPaidAmount = parseFloat(voucher.paid_amount || 0);
        const newPaidAmount = Math.max(0, currentPaidAmount - receiptAmount);
        const newBalanceAmount = parseFloat(voucher.TotalAmount) - newPaidAmount;
        const newStatus =
          newBalanceAmount <= 0.01
            ? 'Paid'
            : newPaidAmount > 0
            ? 'Partial'
            : 'Pending';

        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE voucher SET 
              paid_amount = ?, 
              balance_amount = ?, 
              receipt_number = NULL,
              status = ? 
             WHERE VoucherID = ?`,
            [newPaidAmount, newBalanceAmount, newStatus, voucher.VoucherID],
            error => {
              if (error) reject(error);
              else resolve();
            }
          );
        });
      }
    }

    // 3️⃣ Delete the Receipt voucher itself
    const deleteResult = await new Promise((resolve, reject) => {
      connection.execute(
        `DELETE FROM voucher WHERE VoucherID = ? AND TransactionType = "Receipt"`,
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results);
        }
      );
    });

    if (deleteResult.affectedRows === 0) {
      throw new Error('Failed to delete Receipt voucher');
    }

    // 4️⃣ Commit the transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({
      message: 'Receipt voucher deleted successfully',
      deleted_voucher_id: req.params.id,
      receipt_number: receiptNumber
    });

  } catch (error) {
    if (connection) {
      await new Promise(resolve => {
        connection.rollback(() => resolve());
      });
    }

    console.error('❌ Error in delete receipt route:', error);
    res.status(500).json({ error: error.message || 'Failed to delete receipt voucher' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});


// ------------------------------
// Download transaction proof file
// ------------------------------
router.get('/receipts/:id/download-proof', async (req, res) => {
  try {
    // First get the receipt to check if it has a transaction proof file
    db.execute(
      'SELECT transaction_proof_filename FROM receipts WHERE id = ?',
      [req.params.id],
      (error, results) => {
        if (error) {
          console.error('Database error:', error);
          return res.status(500).json({ error: 'Failed to fetch receipt' });
        }

        if (!results || results.length === 0) {
          return res.status(404).json({ error: 'Receipt not found' });
        }

        const receipt = results[0];
        
        if (!receipt.transaction_proof_filename) {
          return res.status(404).json({ error: 'No transaction proof file found for this receipt' });
        }

        const filePath = path.join(__dirname, '../uploads/receipts', receipt.transaction_proof_filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'Transaction proof file not found on server' });
        }

        // Get file stats for content type and size
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileExt = path.extname(receipt.transaction_proof_filename).toLowerCase();

        // Determine content type based on file extension
        let contentType = 'application/octet-stream';
        switch (fileExt) {
          case '.pdf':
            contentType = 'application/pdf';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.doc':
            contentType = 'application/msword';
            break;
          case '.docx':
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            break;
        }

        // Set headers for file download
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Disposition', `attachment; filename="${receipt.transaction_proof_filename}"`);
        res.setHeader('Cache-Control', 'no-cache');

        // Create read stream and pipe to response
        const fileStream = fs.createReadStream(filePath);
        
        fileStream.on('error', (error) => {
          console.error('File stream error:', error);
          res.status(500).json({ error: 'Error reading file' });
        });

        fileStream.pipe(res);

      }
    );
  } catch (error) {
    console.error('Error in download proof route:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// ------------------------------
// View transaction proof file (inline in browser)
// ------------------------------
router.get('/receipts/:id/view-proof', async (req, res) => {
  try {
    db.execute(
      'SELECT transaction_proof_filename FROM receipts WHERE id = ?',
      [req.params.id],
      (error, results) => {
        if (error) {
          console.error('Database error:', error);
          return res.status(500).json({ error: 'Failed to fetch receipt' });
        }

        if (!results || results.length === 0) {
          return res.status(404).json({ error: 'Receipt not found' });
        }

        const receipt = results[0];
        
        if (!receipt.transaction_proof_filename) {
          return res.status(404).json({ error: 'No transaction proof file found for this receipt' });
        }

        const filePath = path.join(__dirname, '../uploads/receipts', receipt.transaction_proof_filename);
        
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'Transaction proof file not found on server' });
        }

        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileExt = path.extname(receipt.transaction_proof_filename).toLowerCase();

        // Determine content type for inline viewing
        let contentType = 'application/octet-stream';
        switch (fileExt) {
          case '.pdf':
            contentType = 'application/pdf';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.doc':
            contentType = 'application/msword';
            break;
          case '.docx':
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            break;
        }

        // Set headers for inline viewing (not download)
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Disposition', `inline; filename="${receipt.transaction_proof_filename}"`);
        res.setHeader('Cache-Control', 'no-cache');

        const fileStream = fs.createReadStream(filePath);
        
        fileStream.on('error', (error) => {
          console.error('File stream error:', error);
          res.status(500).json({ error: 'Error reading file' });
        });

        fileStream.pipe(res);

      }
    );
  } catch (error) {
    console.error('Error in view proof route:', error);
    res.status(500).json({ error: 'Failed to view file' });
  }
});




module.exports = router;