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
      `SELECT VchNo 
       FROM voucher 
       WHERE TransactionType = 'Receipt' 
         AND VchNo IS NOT NULL 
         AND VchNo != ''
         AND VchNo LIKE 'REC%'
       ORDER BY VoucherID DESC 
       LIMIT 1`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching next receipt number:', error);
          return res.status(500).json({ error: 'Failed to fetch next receipt number' });
        }

        let nextReceiptNumber = 'REC001';

        if (results && results.length > 0 && results[0].VchNo) {
          const lastNumber = results[0].VchNo;
          const match = lastNumber.match(/REC(\d+)/);

          if (match) {
            const nextNum = parseInt(match[1], 10) + 1;
            nextReceiptNumber = `REC${nextNum.toString().padStart(3, '0')}`;
            console.log(`Incremented from ${lastNumber} to ${nextReceiptNumber}`);
          } else {
            console.log('VchNo exists but no REC pattern found, using default:', nextReceiptNumber);
          }
        } else {
          console.log('No previous receipts found, using default:', nextReceiptNumber);
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
    // 2️⃣ INSERT RECEIPT INTO VOUCHER TABLE
    // -------------------------------------------
    const [receiptInsert] = await connection.promise().execute(
      `INSERT INTO voucher (
        TransactionType, VchNo, product_id, batch_id, InvoiceNumber, Date,
        PaymentTerms, Freight, TotalPacks, TaxAmount, Subtotal, BillSundryAmount,
        TotalAmount, ChequeNo, ChequeDate, BankName, AccountID, AccountName, 
        PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate, SGSTPercentage, 
        CGSTPercentage, IGSTPercentage, SGSTAmount, CGSTAmount, IGSTAmount, 
        TaxSystem, paid_amount, created_at, balance_amount, status, paid_date, 
        pdf_data, DC, pdf_file_name, pdf_created_at, transaction_proof
      )
      VALUES (?, ?, ?, ?, ?, ?, 'Immediate', 0, 0, 0, ?, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0,
              'GST', ?, ?, 0, 'Paid', ?, ?, 'C', ?, ?, ?)`,
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
        null, // pdf_file_name - changed from transaction_proof_filename
        currentDate,
        transaction_proof_filename // This is where transaction_proof goes
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
// 4️⃣ STAFF INCENTIVE CALCULATION AND UPDATION
// ---------------------------------------------------
if (safeTransactionType === "Receipt" && safeInvoiceNumber) {
  console.log("🔍 Looking for matching Stock Transfer with InvoiceNumber:", safeInvoiceNumber);
  
  // CHANGE: Changed from 'Sales' to 'Stock Transfer'
  const [stockTransferRows] = await connection.promise().query(
    `SELECT staffid, staff_incentive 
     FROM voucher 
     WHERE TransactionType = 'Stock Transfer' 
     AND InvoiceNumber = ? 
     LIMIT 1`,
    [safeInvoiceNumber]
  );

  if (stockTransferRows.length > 0) {
    const stockTransferRow = stockTransferRows[0];
    const staffIdFromTransfer = stockTransferRow.staffid;
    
    console.log("📊 Stock Transfer Row Found:", {
      invoiceNumber: safeInvoiceNumber,
      staff_id_from_transfer: staffIdFromTransfer,
      staff_incentive_percentage: stockTransferRow.staff_incentive,
      receipt_paid_amount: receiptAmount
    });

    if (staffIdFromTransfer) {
      let staffIncentivePercentage = 0;
      
      if (stockTransferRow.staff_incentive !== null && stockTransferRow.staff_incentive !== undefined) {
        staffIncentivePercentage = parseFloat(stockTransferRow.staff_incentive);
      }
      
      console.log("ℹ️ Staff Incentive Percentage from Stock Transfer:", staffIncentivePercentage);

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
            previous_incentive: currentIncentive,
            added_incentive: roundedIncentive,
            new_total_incentive: newTotalIncentive
          });
        } else {
          console.log("❌ Staff not found in accounts table with ID:", staffIdFromTransfer);
        }
      } else {
        console.log("ℹ️ No staff_incentive percentage found or it's 0 in stock transfer row");
      }
    } else {
      console.log("⚠️ No staffid found in stock transfer row");
    }
  } else {
    console.log("⚠️ No matching Stock Transfer found for InvoiceNumber:", safeInvoiceNumber);
  }
}
    await connection.promise().commit();

    res.json({
      success: true,
      message: `${safeTransactionType} created successfully`,
      receipt_no: nextReceipt,
      voucherId: receiptVoucherId,
      transaction_proof: transaction_proof_filename, // Include this in response
      transactionType: safeTransactionType,
      stored_batch_id: batch_id,
      stored_batch_number: batch
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


router.get('/receipts-with-vouchers', async (req, res) => {
  try {
    const query = `
      SELECT 
        r.*, 
        a.business_name,
        a.name AS account_name,

        -- All invoices (Sales or Purchase) belonging to same Party + same InvoiceNumber
        (
          SELECT GROUP_CONCAT(DISTINCT v.InvoiceNumber)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS related_invoices,

        (
          SELECT SUM(v.TotalAmount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_invoice_amount,

        (
          SELECT SUM(v.paid_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_paid_amount,

        (
          SELECT SUM(v.balance_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_balance_amount

      FROM voucher r
      LEFT JOIN accounts a ON r.PartyID = a.id
      WHERE r.TransactionType = 'Receipt'
      ORDER BY r.created_at DESC
    `;

    db.execute(query, (error, results) => {
      if (error) {
        console.error('Database error fetching receipts:', error);
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
// ------------------------------
router.get('/last-receipt', async (req, res) => {
  try {
    db.execute(
      `SELECT VchNo 
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
          res.json({ lastReceiptNumber: results[0].VchNo });
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
    const sql = `
      SELECT 
        r.*,
        a.business_name,
        a.name AS payee_name,

        -- All related invoices for same customer + same invoice number
        (
          SELECT GROUP_CONCAT(DISTINCT v.InvoiceNumber)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS invoice_numbers,

        (
          SELECT SUM(v.TotalAmount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_invoice_amount,

        (
          SELECT SUM(v.paid_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_paid_amount,

        (
          SELECT SUM(v.balance_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_balance_amount

      FROM voucher r
      LEFT JOIN accounts a ON r.PartyID = a.id
      WHERE r.TransactionType = 'Receipt'
      ORDER BY r.created_at DESC
    `;

    db.execute(sql, (err, results) => {
      if (err) {
        console.error("Database error fetching vouchers (receipts):", err);
        return res.status(500).json({ error: "Failed to fetch receipts" });
      }

      const processed = results.map(r => ({
        ...r,
        invoice_numbers: r.invoice_numbers 
          ? r.invoice_numbers.split(",") 
          : []
      }));

      console.log("Receipts fetched:", processed.length);
      res.json(processed);
    });

  } catch (error) {
    console.error("Error in /receipts route:", error);
    res.status(500).json({ error: "Failed to fetch receipts" });
  }
});



// ------------------------------
// Get receipt by ID
// ------------------------------
router.get('/receipts/:id', async (req, res) => {
  try {
    const sql = `
      SELECT 
        r.*,
        a.business_name,
        a.name AS payee_name,

        -- List of invoices linked to this receipt (same customer + same invoice number)
        (
          SELECT GROUP_CONCAT(DISTINCT v.InvoiceNumber)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS invoice_numbers,

        (
          SELECT SUM(v.TotalAmount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_invoice_amount,

        (
          SELECT SUM(v.paid_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_paid_amount,

        (
          SELECT SUM(v.balance_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'Purchase')
        ) AS total_balance_amount

      FROM voucher r
      LEFT JOIN accounts a ON r.PartyID = a.id
      WHERE r.VoucherID = ?
      AND r.TransactionType = 'Receipt'
    `;

    db.execute(sql, [req.params.id], (error, results) => {
      if (error) {
        console.error("Database error fetching receipt:", error);
        return res.status(500).json({ error: "Failed to fetch receipt" });
      }

      if (!results || results.length === 0) {
        return res.status(404).json({ error: "Receipt not found" });
      }

      const receipt = {
        ...results[0],
        invoice_numbers: results[0].invoice_numbers
          ? results[0].invoice_numbers.split(",")
          : []
      };

      console.log("Receipt fetched:", receipt);
      res.json(receipt);
    });

  } catch (error) {
    console.error("Error in /receipts/:id route:", error);
    res.status(500).json({ error: "Failed to fetch receipt" });
  }
});


router.get('/voucher', async (req, res) => {
  try {
    db.execute(
      `SELECT 
         v.*, 
         a.business_name, 
         a.name AS payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
           FROM voucher v2
           WHERE v2.VchNo = v.VchNo  -- Use VchNo instead of receipt_number
           AND v2.TransactionType IN ('Purchase', 'purchase voucher')
           AND v2.InvoiceNumber IS NOT NULL
           AND v2.InvoiceNumber != ''
         ) AS invoice_numbers
       FROM voucher v
       LEFT JOIN accounts a ON v.PartyID = a.id
       WHERE v.TransactionType = 'purchase voucher'
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
router.get('/voucher/:id', async (req, res) => {
  try {
    db.execute(
      `SELECT 
         v.*, 
         a.business_name, 
         a.name AS payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
           FROM voucher v2
           WHERE v2.VchNo = v.VchNo  -- Use VchNo instead of receipt_number
           AND v2.TransactionType IN ('Purchase', 'purchase voucher')
           AND v2.InvoiceNumber IS NOT NULL
           AND v2.InvoiceNumber != ''
         ) AS invoice_numbers
       FROM voucher v
       LEFT JOIN accounts a ON v.PartyID = a.id
       WHERE v.VoucherID = ? 
       AND v.TransactionType = 'purchase voucher'`,
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

    // 🔥 CRITICAL FIX: Delete from voucherdetails FIRST
    console.log('Deleting voucher details for VoucherID:', req.params.id);
    await new Promise((resolve, reject) => {
      connection.execute(
        `DELETE FROM voucherdetails WHERE voucher_id = ?`,
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else {
            console.log('Deleted voucher details rows:', results.affectedRows);
            resolve(results);
          }
        }
      );
    });

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

router.delete('/voucher/:id', async (req, res) => {
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
        `SELECT * FROM voucher WHERE VoucherID = ? AND TransactionType = "purchase voucher"`,
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
    const receiptNumber = receipt.VchNo; // Using VchNo instead of receipt_number
    const retailerId = receipt.PartyID;

    // 2️⃣ Update related Sales vouchers (reverse paid amount)
    if (retailerId && receiptNumber) {
      const salesVouchers = await new Promise((resolve, reject) => {
        connection.execute(
          `SELECT * FROM voucher 
           WHERE PartyID = ? AND VchNo = ? AND TransactionType = "Purchase"`,
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
              VchNo = NULL,
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

    // 3️⃣ FIRST delete related records from voucherdetails table
    const deleteDetailsResult = await new Promise((resolve, reject) => {
      connection.execute(
        `DELETE FROM voucherdetails WHERE voucher_id = ?`,
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results);
        }
      );
    });

    console.log(`Deleted ${deleteDetailsResult.affectedRows} records from voucherdetails`);

    // 4️⃣ NOW delete the Receipt voucher itself
    const deleteResult = await new Promise((resolve, reject) => {
      connection.execute(
        `DELETE FROM voucher WHERE VoucherID = ? AND TransactionType = "purchase voucher"`,
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

    // 5️⃣ Commit the transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({
      message: 'Receipt voucher deleted successfully',
      deleted_voucher_id: req.params.id,
      receipt_number: receiptNumber,
      deleted_details_count: deleteDetailsResult.affectedRows
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

        // FIXED: Correct the file path
        const filePath = path.join(__dirname, '../../uploads/receipts', receipt.transaction_proof_filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
          console.error('File not found at path:', filePath);
          return res.status(404).json({ error: 'Transaction proof file not found on server' });
        }

        // Get file stats
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileExt = path.extname(receipt.transaction_proof_filename).toLowerCase();

        // Determine content type
        let contentType = 'application/octet-stream';
        const contentTypes = {
          '.pdf': 'application/pdf',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        
        if (contentTypes[fileExt]) {
          contentType = contentTypes[fileExt];
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
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error reading file' });
          }
        });

        fileStream.pipe(res);
      }
    );
  } catch (error) {
    console.error('Error in download proof route:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
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

        // FIXED: Correct the file path
        const filePath = path.join(__dirname, '../../uploads/receipts', receipt.transaction_proof_filename);
        
        if (!fs.existsSync(filePath)) {
          console.error('File not found at path:', filePath);
          return res.status(404).json({ error: 'Transaction proof file not found on server' });
        }

        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileExt = path.extname(receipt.transaction_proof_filename).toLowerCase();

        // Determine content type for inline viewing
        let contentType = 'application/octet-stream';
        const contentTypes = {
          '.pdf': 'application/pdf',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        
        if (contentTypes[fileExt]) {
          contentType = contentTypes[fileExt];
        }

        // For images and PDFs, set inline disposition
        if (fileExt.match(/\.(jpg|jpeg|png|pdf)$/i)) {
          res.setHeader('Content-Disposition', `inline; filename="${receipt.transaction_proof_filename}"`);
        } else {
          // For other files, force download
          res.setHeader('Content-Disposition', `attachment; filename="${receipt.transaction_proof_filename}"`);
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Cache-Control', 'no-cache');

        const fileStream = fs.createReadStream(filePath);
        
        fileStream.on('error', (error) => {
          console.error('File stream error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error reading file' });
          }
        });

        fileStream.pipe(res);
      }
    );
  } catch (error) {
    console.error('Error in view proof route:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to view file' });
    }
  }
});



module.exports = router;