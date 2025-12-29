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
      transaction_proof_filename = req.file.filename;
      console.log("📁 Uploaded transaction proof file:", transaction_proof_filename);
    } else {
      console.log("⚠️ No transaction proof file uploaded");
    }

    // -------------------------------------------
    // GET STAFF INFORMATION FROM ORIGINAL TRANSACTION
    // -------------------------------------------
    let staffIdForReceipt = null;
    let assignedStaffNameForReceipt = null;
    let originalInvoiceRow = null; // Store original invoice data

if (safeInvoiceNumber) {
  const [transactionRows] = await connection.promise().query(
    `SELECT staffid, assigned_staff, TotalAmount, balance_amount, status, order_number
     FROM voucher 
     WHERE TransactionType IN ('Stock Transfer', 'Sales', 'Purchase')
     AND InvoiceNumber = ? 
     LIMIT 1`,
    [safeInvoiceNumber]
  );

      if (transactionRows.length > 0) {
        originalInvoiceRow = transactionRows[0]; // Store the original invoice row
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
    // 4️⃣ UPDATE BALANCE_AMOUNT AND STATUS IN ORIGINAL INVOICE
    // ---------------------------------------------------
    if (safeInvoiceNumber && originalInvoiceRow) {
      console.log("🔄 Updating balance_amount and status for original invoice:", safeInvoiceNumber);
      
      const totalAmount = parseFloat(originalInvoiceRow.TotalAmount) || 0;
      const currentBalance = parseFloat(originalInvoiceRow.balance_amount) || totalAmount;
      const newBalance = currentBalance - receiptAmount;
      const orderNumber = originalInvoiceRow.order_number;
      
      console.log("📊 Invoice Balance Calculation:", {
        invoiceNumber: safeInvoiceNumber,
        totalAmount: totalAmount,
        currentBalance: currentBalance,
        receiptAmount: receiptAmount,
        newBalance: newBalance,
        orderNumber: orderNumber
      });
      
      // Determine status based on new balance
      let newStatus = "pending";
      if (newBalance <= 0) {
        newStatus = "Paid";
      } else if (newBalance > 0 && newBalance < totalAmount) {
        newStatus = "Partial";
      } else {
        newStatus = "pending";
      }
      
      console.log("📊 Status Calculation:", {
        newBalance: newBalance,
        newStatus: newStatus
      });
      
 await connection.promise().query(
  `UPDATE voucher 
   SET balance_amount = ?, 
       status = ?,
       updated_at = NOW()
   WHERE InvoiceNumber = ? 
     AND TransactionType IN ('Stock Transfer', 'Sales', 'Purchase')`,
  [newBalance, newStatus, safeInvoiceNumber]
);
      
      console.log("✅ Original invoice updated:", {
        invoiceNumber: safeInvoiceNumber,
        newBalance: newBalance,
        newStatus: newStatus,
        orderNumber: orderNumber
      });
    } else {
      console.log("ℹ️ No original invoice found for InvoiceNumber:", safeInvoiceNumber);
    }

  // ---------------------------------------------------
// 5️⃣ UNPAID AMOUNT DEDUCTION (Only for transactions with order_number)
// ---------------------------------------------------
if (safeTransactionType === "Receipt" && retailer_id) {
  console.log(`🔍 Checking if unpaid amount deduction is applicable...`);
  
  try {
    // Use the stored originalInvoiceRow to check order_number
    if (originalInvoiceRow && originalInvoiceRow.order_number) {
      const orderNumber = originalInvoiceRow.order_number;
      
      
      // Check if required columns exist
      const tableCheck = await connection.promise().query(
        "SHOW COLUMNS FROM accounts LIKE 'unpaid_amount'"
      );
      
      if (tableCheck[0].length === 0) {
        console.warn("⚠️ 'unpaid_amount' column not found in accounts table.");
      } else {
        // First, check if credit_limit column exists
        const creditLimitCheck = await connection.promise().query(
          "SHOW COLUMNS FROM accounts LIKE 'credit_limit'"
        );
        
        // Get current account data
        const [currentAccount] = await connection.promise().query(
          "SELECT unpaid_amount, credit_limit FROM accounts WHERE id = ?",
          [retailer_id]
        );
        
        if (currentAccount.length === 0) {
          console.warn(`⚠️ Account with id ${retailer_id} not found in accounts table.`);
        } else {
          const currentUnpaid = parseFloat(currentAccount[0].unpaid_amount) || 0;
          const creditLimit = parseFloat(currentAccount[0].credit_limit) || 0;
          const newUnpaid = currentUnpaid - receiptAmount;
          
          // Calculate new balance_amount (credit_limit - unpaid_amount)
          const newBalanceAmount = creditLimit - newUnpaid;
          
          // Prepare update query based on whether balance_amount column exists
          let updateQuery, updateParams;
          
          // Check if balance_amount column exists
          const balanceCheck = await connection.promise().query(
            "SHOW COLUMNS FROM accounts LIKE 'balance_amount'"
          );
          
          if (balanceCheck[0].length > 0) {
            // Column exists, include it in update
            updateQuery = `
            UPDATE accounts 
            SET unpaid_amount = ?,
                balance_amount = ?,
                updated_at = NOW()
            WHERE id = ?
            `;
            updateParams = [newUnpaid, newBalanceAmount, retailer_id];
          } else {
            // Column doesn't exist, update only unpaid_amount
            updateQuery = `
            UPDATE accounts 
            SET unpaid_amount = ?,
                updated_at = NOW()
            WHERE id = ?
            `;
            updateParams = [newUnpaid, retailer_id];
            console.log("⚠️ 'balance_amount' column not found. Only updating unpaid_amount.");
          }
          
          await connection.promise().query(updateQuery, updateParams);
          
          // Log detailed information
          console.log(`✅ UNPAID AMOUNT UPDATED - Old: ${currentUnpaid}, New: ${newUnpaid}, Difference: -${receiptAmount}`);
          
          if (balanceCheck[0].length > 0) {
            const oldBalanceAmount = creditLimit - currentUnpaid;
            console.log(`✅ BALANCE AMOUNT UPDATED - Old: ${oldBalanceAmount}, New: ${newBalanceAmount}, Difference: ${receiptAmount}`);
          }
        }
      }
    } else {
      console.log(`❌ Order number is NULL/empty. UNPAID AMOUNT DEDUCTION SKIPPED.`);
      console.log(`ℹ️ Only transactions with order_number qualify for unpaid amount updates`);
    }
  } catch (error) {
    console.error(`❌ ERROR in unpaid amount deduction check:`, error.message);
  }
}

    // ---------------------------------------------------
    // 6️⃣ STAFF INCENTIVE CALCULATION (Only for transactions with order_number)
    // ---------------------------------------------------
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
      staffid: staffIdForReceipt,
      assigned_staff: assignedStaffNameForReceipt,
      // Include invoice update info in response
      invoice_update: safeInvoiceNumber ? {
        invoiceNumber: safeInvoiceNumber,
        new_balance: originalInvoiceRow ? (parseFloat(originalInvoiceRow.balance_amount || originalInvoiceRow.TotalAmount) - receiptAmount) : null,
        new_status: (() => {
          if (!originalInvoiceRow) return null;
          const totalAmount = parseFloat(originalInvoiceRow.TotalAmount) || 0;
          const currentBalance = parseFloat(originalInvoiceRow.balance_amount) || totalAmount;
          const newBalance = currentBalance - receiptAmount;
          
          if (newBalance <= 0) return "Paid";
          if (newBalance > 0 && newBalance < totalAmount) return "Partial";
          return "pending";
        })()
      } : null
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
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
        ) AS invoice_numbers,

        (
          SELECT SUM(v.TotalAmount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
        ) AS total_invoice_amount,

        (
          SELECT SUM(v.paid_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
        ) AS total_paid_amount,

        (
          SELECT SUM(v.balance_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
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
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
        ) AS invoice_numbers,

        (
          SELECT SUM(v.TotalAmount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
        ) AS total_invoice_amount,

        (
          SELECT SUM(v.paid_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
        ) AS total_paid_amount,

        (
          SELECT SUM(v.balance_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN ('Sales', 'stock transfer','Purchase')
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


// ------------------------------
// Get all purchase vouchers
// ------------------------------
router.get('/voucher', async (req, res) => {
  try {
    const query = `
      SELECT 
        v.*, 
        a.business_name, 
        a.name AS payee_name,
        (
          SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
          FROM voucher v2
          WHERE v2.VchNo = v.VchNo
            AND v2.TransactionType IN ('Purchase', 'purchase voucher')
            AND v2.InvoiceNumber IS NOT NULL
            AND v2.InvoiceNumber != ''
        ) AS invoice_numbers,

        COALESCE((
          SELECT SUM(p.TotalAmount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType = 'Purchase'
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(p.InvoiceNumber, 
              COALESCE((
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              ), '')
            ) > 0
        ), 0) AS total_invoice_amount,

        COALESCE((
          SELECT SUM(p.paid_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType = 'Purchase'
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(p.InvoiceNumber, 
              COALESCE((
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              ), '')
            ) > 0
        ), 0) AS total_paid_amount,

        COALESCE((
          SELECT SUM(p.balance_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType = 'Purchase'
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(p.InvoiceNumber, 
              COALESCE((
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              ), '')
            ) > 0
        ), 0) AS total_balance_amount

      FROM voucher v
      LEFT JOIN accounts a ON v.PartyID = a.id
      WHERE v.TransactionType = 'purchase voucher'
      ORDER BY v.created_at DESC`;

    db.execute(query, (error, results) => {
      if (error) {
        console.error('Database error fetching vouchers:', error);
        return res.status(500).json({ error: 'Failed to fetch vouchers' });
      }

      const processedResults = results.map(voucher => ({
        ...voucher,
        invoice_numbers: voucher.invoice_numbers ? voucher.invoice_numbers.split(',') : [],
        total_invoice_amount: parseFloat(voucher.total_invoice_amount) || 0,
        total_paid_amount: parseFloat(voucher.total_paid_amount) || 0,
        total_balance_amount: parseFloat(voucher.total_balance_amount) || 0
      }));

      res.json(processedResults || []);
    });
  } catch (error) {
    console.error('Error in /voucher route:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------
// Get single purchase voucher by ID
// ------------------------------
router.get('/voucher/:id', async (req, res) => {
  try {
    const query = `
      SELECT 
        v.*, 
        a.business_name, 
        a.name AS payee_name,
        (
          SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
          FROM voucher v2
          WHERE v2.VchNo = v.VchNo
            AND v2.TransactionType IN ('Purchase', 'purchase voucher')
            AND v2.InvoiceNumber IS NOT NULL
            AND v2.InvoiceNumber != ''
        ) AS invoice_numbers,

        COALESCE((
          SELECT SUM(p.TotalAmount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType = 'Purchase'
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(p.InvoiceNumber, 
              COALESCE((
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              ), '')
            ) > 0
        ), 0) AS total_invoice_amount,

        COALESCE((
          SELECT SUM(p.paid_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType = 'Purchase'
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(p.InvoiceNumber, 
              COALESCE((
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              ), '')
            ) > 0
        ), 0) AS total_paid_amount,

        COALESCE((
          SELECT SUM(p.balance_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType = 'Purchase'
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(p.InvoiceNumber, 
              COALESCE((
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              ), '')
            ) > 0
        ), 0) AS total_balance_amount

      FROM voucher v
      LEFT JOIN accounts a ON v.PartyID = a.id
      WHERE v.VoucherID = ?
        AND v.TransactionType = 'purchase voucher'`;

    db.execute(query, [req.params.id], (error, results) => {
      if (error) {
        console.error('Database error fetching voucher by ID:', error);
        return res.status(500).json({ error: 'Failed to fetch voucher' });
      }

      if (!results || results.length === 0) {
        return res.status(404).json({ error: 'Voucher not found' });
      }

      const voucher = {
        ...results[0],
        invoice_numbers: results[0].invoice_numbers ? results[0].invoice_numbers.split(',') : [],
        total_invoice_amount: parseFloat(results[0].total_invoice_amount) || 0,
        total_paid_amount: parseFloat(results[0].total_paid_amount) || 0,
        total_balance_amount: parseFloat(results[0].total_balance_amount) || 0
      };

      res.json(voucher);
    });
  } catch (error) {
    console.error('Error in /voucher/:id route:', error);
    res.status(500).json({ error: 'Server error' });
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
    // ------------------------------
    // 1️⃣ GET DB CONNECTION
    // ------------------------------
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => (err ? reject(err) : resolve()));
    });

    // ------------------------------
    // 2️⃣ FETCH CURRENT VOUCHER (RECEIPT)
    // ------------------------------
    const receiptRows = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT InvoiceNumber, paid_amount, TransactionType
         FROM voucher
         WHERE VoucherID = ?`,
        [voucherId],
        (err, results) => (err ? reject(err) : resolve(results))
      );
    });

    if (!receiptRows || receiptRows.length === 0) {
      throw new Error('Voucher not found');
    }

    const receipt = receiptRows[0];
    const invoiceNumber = receipt.InvoiceNumber;
    const oldPaidAmount = parseFloat(receipt.paid_amount) || 0;
    const isReceiptType = receipt.TransactionType === 'Receipt' || 
                         receipt.TransactionType === 'purchase voucher';

    const newPaidAmount =
      req.body.paid_amount !== undefined
        ? parseFloat(req.body.paid_amount) || 0
        : oldPaidAmount;

    const paidAmountChanged = newPaidAmount !== oldPaidAmount;

    // ------------------------------
    // 3️⃣ UPDATE RECEIPT ONLY
    // ------------------------------
    const updateFields = [];
    const updateValues = [];

    if (req.body.paid_amount !== undefined) {
      updateFields.push('paid_amount = ?', 'paid_date = ?');
      updateValues.push(newPaidAmount, new Date());
    }

    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'paid_amount') {
        updateFields.push(`${key} = ?`);
        updateValues.push(value ?? null);
      }
    }

    if (req.file) {
      updateFields.push('transaction_proof = ?');
      updateValues.push(req.file.filename);
    }

    if (updateFields.length > 0) {
      updateValues.push(voucherId);

      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE voucher
           SET ${updateFields.join(', ')}
           WHERE VoucherID = ?`,
          updateValues,
          err => (err ? reject(err) : resolve())
        );
      });
    }

    // ------------------------------
    // 4️⃣ RECALCULATE INVOICE BALANCE (UPDATE ONLY THE INVOICE)
    // ------------------------------
    if (invoiceNumber && isReceiptType && paidAmountChanged) {
      // Fetch invoice details
      const invoiceRows = await new Promise((resolve, reject) => {
        connection.query(
          `SELECT VoucherID, TotalAmount, TransactionType, balance_amount
           FROM voucher
           WHERE InvoiceNumber = ?
             AND TransactionType IN ('Purchase', 'Sales', 'Stock Transfer')
           LIMIT 1`,
          [invoiceNumber],
          (err, results) => (err ? reject(err) : resolve(results))
        );
      });

      if (invoiceRows.length > 0) {
        const invoice = invoiceRows[0];
        const totalAmount = parseFloat(invoice.TotalAmount) || 0;
        const invoiceTransactionType = invoice.TransactionType;
        
        // Determine receipt type based on invoice type
        let receiptTypeCondition = '';
        if (invoiceTransactionType === 'Sales' || invoiceTransactionType === 'Stock Transfer') {
          receiptTypeCondition = "TransactionType = 'Receipt'";
        } else if (invoiceTransactionType === 'Purchase') {
          receiptTypeCondition = "TransactionType IN ('Receipt', 'purchase voucher')";
        }

        // Sum ALL receipts for this invoice
        const receiptSumRows = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT SUM(paid_amount) AS totalReceiptsPaid
             FROM voucher
             WHERE InvoiceNumber = ?
               AND ${receiptTypeCondition}`,
            [invoiceNumber],
            (err, results) => (err ? reject(err) : resolve(results))
          );
        });

        const totalReceiptsPaid = parseFloat(receiptSumRows[0].totalReceiptsPaid) || 0;
        
        // Calculate new balance
        const newBalance = Math.max(0, totalAmount - totalReceiptsPaid);

        // Determine status for the INVOICE
        let newStatusForInvoice = 'pending';
        if (newBalance <= 0) {
          newStatusForInvoice = 'Paid';
        } else if (totalReceiptsPaid > 0) {
          newStatusForInvoice = 'Partial';
        }

        console.log('📊 Invoice Update Calculation:', {
          invoiceNumber,
          totalAmount,
          totalReceiptsPaid,
          newBalance,
          newStatusForInvoice
        });

        // Update ONLY THE ORIGINAL INVOICE (not purchase vouchers)
        await new Promise((resolve, reject) => {
          connection.query(
            `UPDATE voucher
             SET balance_amount = ?, status = ?, updated_at = NOW()
             WHERE VoucherID = ?`,
            [newBalance, newStatusForInvoice, invoice.VoucherID],
            err => (err ? reject(err) : resolve())
          );
        });

        console.log('✅ Invoice updated:', {
          invoiceNumber,
          VoucherID: invoice.VoucherID,
          newBalance,
          newStatusForInvoice
        });

        // DON'T UPDATE PURCHASE VOUCHERS - they should keep their own values
        // The receipt being edited already has its own balance/status from the update above
      }
    }

    // ------------------------------
    // 5️⃣ COMMIT
    // ------------------------------
    await new Promise((resolve, reject) => {
      connection.commit(err => (err ? reject(err) : resolve()));
    });

    connection.release();

    res.json({
      success: true,
      message: 'Voucher updated successfully',
      VoucherID: voucherId
    });

  } catch (error) {
    console.error('Error updating voucher:', error);

    if (connection) {
      await new Promise(resolve => connection.rollback(() => resolve()));
      connection.release();
    }

    if (req.file) fs.unlinkSync(req.file.path);

    res.status(500).json({
      success: false,
      error: error.message
    });
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