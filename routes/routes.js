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

router.get('/next-Payment-number', async (req, res) => {
  try {
    db.execute(
      `SELECT VchNo 
       FROM voucher 
       WHERE TransactionType = 'payment' 
         AND VchNo IS NOT NULL 
         AND VchNo != ''
         AND VchNo LIKE 'PAY%'
       ORDER BY VoucherID DESC 
       LIMIT 1`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching next payment number:', error);
          return res.status(500).json({ error: 'Failed to fetch next payment number' });
        }

        let nextReceiptNumber = 'PAY001';

        if (results && results.length > 0 && results[0].VchNo) {
          const lastNumber = results[0].VchNo;
          const match = lastNumber.match(/PAY(\d+)/);

          if (match) {
            const nextNum = parseInt(match[1], 10) + 1;
            nextReceiptNumber = `PAY${nextNum.toString().padStart(3, '0')}`;
            console.log(`Incremented from ${lastNumber} to ${nextReceiptNumber}`);
          } else {
            console.log('VchNo exists but no PAY pattern found, using default:', nextReceiptNumber);
          }
        } else {
          console.log('No previous payment found, using default:', nextReceiptNumber);
        }

        console.log('Next payment number:', nextReceiptNumber);
        res.json({ nextReceiptNumber });
      }
    );
  } catch (error) {
    console.error('Error in next payment number route:', error);
    res.status(500).json({ error: 'Failed to fetch next payment number' });
  }
});


router.post('/receipts', upload.single('transaction_proof'), async (req, res) => {
  console.log('📌 Body:', req.body);
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
      receipt_number,
      retailer_id,
      retailer_name,
      account_name,
      business_name,
      amount,
      bank_name,
      payment_method,
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
      TransactionType,
      data_type,
      note,
    } = req.body;

    let safeTransactionType = "Receipt";

    // ✅ FIRST priority: respect frontend TransactionType
    if (TransactionType === "purchase voucher") {
      safeTransactionType = "purchase voucher";
    } else if (TransactionType === "Payment") {
      safeTransactionType = "Payment";
    }

    // ✅ SECOND priority: fallback using prefix
    else if (receipt_number?.startsWith("PAY")) {
      safeTransactionType = "Payment";
    } else if (receipt_number?.startsWith("PUR")) {
      safeTransactionType = "purchase voucher";
    } else if (receipt_number?.startsWith("REC")) {
      safeTransactionType = "Receipt";
    }
    const safeDataType = data_type || null;
    const receiptAmount = parseFloat(amount || 0);
    const currentDate = new Date();
    const safeInvoiceNumber = invoice_number || null;

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
    let originalInvoiceRow = null;
    let receiptBalanceAmount = receiptAmount;

    if (safeInvoiceNumber) {
      const [transactionRows] = await connection.promise().query(
        `SELECT staffid, assigned_staff, TotalAmount, balance_amount, status, order_number
         FROM voucher 
         WHERE TransactionType IN ('stock transfer', 'Sales', 'Purchase', 'stock inward')  
         AND InvoiceNumber = ? 
         LIMIT 1`,
        [safeInvoiceNumber]
      );

      if (transactionRows.length > 0) {
        originalInvoiceRow = transactionRows[0];
        staffIdForReceipt = transactionRows[0].staffid;
        assignedStaffNameForReceipt = transactionRows[0].assigned_staff;

        const totalAmount = parseFloat(originalInvoiceRow.TotalAmount) || 0;

        // ✅ NEW: Get the CURRENT balance_amount from the invoice
        // If balance_amount is null/0, use TotalAmount as starting point
        let currentBalance = parseFloat(originalInvoiceRow.balance_amount);

        if (currentBalance === null || currentBalance === undefined || currentBalance === 0) {
          currentBalance = totalAmount;
          console.log("⚠️ balance_amount was null/0, using TotalAmount as current balance");
        }

        console.log("💰 Current balance from original invoice:", {
          invoiceNumber: safeInvoiceNumber,
          totalAmount: totalAmount,
          currentBalanceFromDB: originalInvoiceRow.balance_amount,
          usingBalance: currentBalance,
          receiptAmount: receiptAmount
        });

        // ✅ NEW: Calculate new balance after this receipt
        const newInvoiceBalance = currentBalance - receiptAmount;

        // This will be stored in the receipt row's balance_amount
        receiptBalanceAmount = newInvoiceBalance;

        console.log("💰 Receipt Balance Calculation (FIXED):", {
          totalAmount: totalAmount,
          currentBalance: currentBalance,
          receiptAmount: receiptAmount,
          newInvoiceBalance: newInvoiceBalance,
          receiptBalanceAmount: receiptBalanceAmount  // This is what goes in receipt row
        });
      } else {
        console.log("⚠️ No original invoice found for:", safeInvoiceNumber);
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
     WHERE TransactionType IN ('Receipt', 'purchase voucher') 
     ORDER BY VoucherID DESC
     LIMIT 1`
    );

    let prefix = "REC";

    if (safeTransactionType === "Payment") {
      prefix = "PAY";
    } else if (safeTransactionType === "purchase voucher") {
      prefix = "PUR";
    }

    const [voucherRows] = await connection.promise().query(
      `SELECT VchNo 
   FROM voucher 
   WHERE TransactionType = ?
   ORDER BY VoucherID DESC
   LIMIT 1`,
      [safeTransactionType]
    );

    let nextReceipt = receipt_number || (prefix + "001");

    if (voucherRows.length > 0) {
      const match = voucherRows[0].VchNo?.match(/([A-Z]+)(\d+)/);
      if (match) {
        const nextNum = parseInt(match[2], 10) + 1;
        nextReceipt = prefix + nextNum.toString().padStart(3, "0");
      }
    }

    console.log(`✅ Generated ${safeTransactionType} Number:`, nextReceipt);

    console.log("✅ Generated Sequential Receipt No:", nextReceipt);
    console.log("📝 Transaction Type:", safeTransactionType);
    // -------------------------------------------
    // 2️⃣ INSERT RECEIPT INTO VOUCHER TABLE (WITH STAFF INFO)
    // -------------------------------------------
    const [receiptInsert] = await connection.promise().execute(
      `INSERT INTO voucher (
                TransactionType, VchNo, product_id, batch_id, InvoiceNumber, Date,
                PaymentTerms, Freight, TotalPacks, TaxAmount, Subtotal, BillSundryAmount,
                TotalAmount, ChequeNo, ChequeDate, BankName, payment_method, AccountID, AccountName, 
                PartyID, PartyName, BasicAmount, ValueOfGoods, EntryDate, SGSTPercentage, 
                CGSTPercentage, IGSTPercentage, SGSTAmount, CGSTAmount, IGSTAmount, 
                TaxSystem, paid_amount, created_at, balance_amount, status, paid_date, 
                pdf_data, DC, pdf_file_name, pdf_created_at, transaction_proof,
                staffid, assigned_staff, data_type, business_name, note
            )
VALUES (?, ?, ?, ?, ?, ?, 'Immediate', 0, 0, 0, ?, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0,
        'GST', ?, ?, ?, 'Paid', ?, ?, 'C', ?, ?, ?, ?, ?, ?, ?, ?)`,

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
        payment_method || null,
        retailer_id || null,
        account_name || "",
        retailer_id || null,
        retailer_name || "",
        receiptAmount,
        receiptAmount,
        currentDate,
        receiptAmount,
        currentDate,
        receiptBalanceAmount,  // 👈 FIND THIS LINE (balance_amount)
        currentDate,
        null,
        null,
        currentDate,
        transaction_proof_filename,
        staffIdForReceipt,
        assignedStaffNameForReceipt,
        safeDataType,
        business_name || null,
        note || null
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

    // ---------------------------------------------------
    // 4️⃣ UPDATE BALANCE_AMOUNT AND STATUS IN ORIGINAL INVOICE
    // ---------------------------------------------------

    if (safeInvoiceNumber && originalInvoiceRow) {
      console.log("🔄 Updating balance_amount and status for original invoice:", safeInvoiceNumber);

      const totalAmount = parseFloat(originalInvoiceRow.TotalAmount) || 0;

      // ✅ NEW: Get the CURRENT balance from database again to be safe
      const [currentInvoiceRows] = await connection.promise().query(
        `SELECT balance_amount 
         FROM voucher 
         WHERE InvoiceNumber = ? 
           AND TransactionType IN ('stock transfer', 'Sales', 'Purchase', 'stock inward')`,
        [safeInvoiceNumber]
      );

      let currentBalance;
      if (currentInvoiceRows.length > 0) {
        currentBalance = parseFloat(currentInvoiceRows[0].balance_amount);
        if (isNaN(currentBalance) || currentBalance === null) {
          currentBalance = totalAmount;
        }
      } else {
        currentBalance = parseFloat(originalInvoiceRow.balance_amount);
        if (isNaN(currentBalance) || currentBalance === null) {
          currentBalance = totalAmount;
        }
      }

      // ✅ NEW: Calculate new balance correctly
      const newBalance = currentBalance - receiptAmount;
      const orderNumber = originalInvoiceRow.order_number;

      console.log("📊 Invoice Balance Calculation:", {
        invoiceNumber: safeInvoiceNumber,
        totalAmount: totalAmount,
        currentBalanceFromDB: currentBalance,
        receiptAmount: receiptAmount,
        newBalance: newBalance
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

      // Update the original invoice
      await connection.promise().query(
        `UPDATE voucher 
         SET balance_amount = ?, 
             status = ?,
             updated_at = NOW()
         WHERE InvoiceNumber = ? 
           AND TransactionType IN ('stock transfer', 'Sales', 'Purchase', 'stock inward')`,
        [newBalance, newStatus, safeInvoiceNumber]
      );

      console.log("✅ Original invoice updated:", {
        invoiceNumber: safeInvoiceNumber,
        oldBalance: currentBalance,
        newBalance: newBalance,
        newStatus: newStatus
      });
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

              const newBalanceAmount = creditLimit - newUnpaid;

              let updateQuery, updateParams;

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

      const [transactionRows] = await connection.promise().query(
        `SELECT staffid, staff_incentive, TransactionType, order_number 
   FROM voucher 
   WHERE (TransactionType = 'Stock Transfer' OR TransactionType = 'Sales')  -- FIXED: Added 'stock inward'
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
      data_type: safeDataType,
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

// GET /api/receipts/advance/:customerId
// Fetch advance receipts for a specific customer that are not linked to any invoice
router.get('/receipts/advance/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { data_type = 'Sales' } = req.query;

    // SQL to fetch receipts that can be used as advance payments
    // For advance receipts, we want receipts that:
    // 1. Have NO invoice number assigned
    // 2. Are fully paid (status = 'Paid')
    // 3. Can be either fully paid or partially paid - the full amount is available for adjustment
    const sql = `
      SELECT 
        r.VoucherID AS id,
        r.VchNo AS receipt_number,
        r.Date AS receipt_date,
        r.TotalAmount AS total_amount,
        COALESCE(r.paid_amount, 0) AS paid_amount,
        r.payment_method,
        r.BankName AS bank_name,
        r.note,
        r.TransactionType,
        r.created_at,
        r.PartyID AS customer_id,
        a.business_name,
        a.name AS customer_name,
        a.gstin AS customer_gstin,
        a.mobile_number AS customer_mobile,
        r.InvoiceNumber AS invoice_number,
        r.status,
        r.data_type,
        r.balance_amount,
        r.assigned_staff,
        r.staffid AS staff_id,
        r.paid_date
      FROM voucher r
      LEFT JOIN accounts a ON r.PartyID = a.id
      WHERE 
        r.TransactionType = 'Receipt'
        AND r.PartyID = ?
        AND r.status = 'Paid'
        AND (r.InvoiceNumber IS NULL OR r.InvoiceNumber = '')
        -- Remove the amount comparison condition
      ORDER BY r.Date ASC
    `;

    db.execute(sql, [customerId], (err, results) => {
      if (err) {
        console.error("Database error fetching advance receipts:", err);
        return res.status(500).json({
          error: "Failed to fetch advance receipts",
          details: err.message
        });
      }

      // Process the results
      const processedResults = results.map(receipt => {
        const totalAmount = parseFloat(receipt.total_amount) || 0;
        const paidAmount = parseFloat(receipt.paid_amount) || 0;

        // For advance receipts, the entire amount is available for adjustment
        // since it's not linked to any invoice yet
        const availableAmount = totalAmount;

        return {
          id: receipt.id,
          receipt_number: receipt.receipt_number,
          receipt_date: receipt.receipt_date,
          receipt_date_formatted: receipt.receipt_date
            ? new Date(receipt.receipt_date).toISOString().split('T')[0]
            : null,
          total_amount: totalAmount,
          paid_amount: paidAmount,
          available_amount: availableAmount, // Full amount available
          payment_method: receipt.payment_method,
          bank_name: receipt.bank_name,
          note: receipt.note,
          customer_id: receipt.customer_id,
          customer_name: receipt.customer_name,
          business_name: receipt.business_name,
          invoice_number: receipt.invoice_number || 'Not Assigned',
          status: receipt.status,
          assigned_staff: receipt.assigned_staff,
          staff_id: receipt.staff_id,
          created_at: receipt.created_at,
          paid_date: receipt.paid_date
        };
      });

      console.log(`Found ${processedResults.length} advance receipts for customer ${customerId}`);

      res.json({
        success: true,
        count: processedResults.length,
        receipts: processedResults,
        customer_id: customerId,
        total_available_balance: processedResults.reduce((sum, r) => sum + r.available_amount, 0)
      });
    });

  } catch (error) {
    console.error("Error in /receipts/advance/:customerId route:", error);
    res.status(500).json({
      error: "Failed to fetch advance receipts",
      details: error.message
    });
  }
});


// POST /api/receipts/apply-advance
router.post('/receipts/apply-advance', (req, res) => {
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Database connection error:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction((transactionErr) => {
      if (transactionErr) {
        connection.release();
        console.error("Transaction begin error:", transactionErr);
        return res.status(500).json({ error: "Failed to begin transaction" });
      }

      const {
        receipt_id,
        advance_receipt_ids,
        invoice_number,
        customer_id,
        total_advance_adjusted,
        staff_id,
        assigned_staff_name,
        receipt_amount
      } = req.body;

      console.log("📌 Applying advance receipts for invoice:", invoice_number);
      console.log("📌 Advance receipt IDs:", advance_receipt_ids);
      console.log("📌 Total advance amount:", total_advance_adjusted);

      // Validate inputs
      if (!receipt_id) {
        connection.rollback(() => {
          connection.release();
          return res.status(400).json({ error: "receipt_id is required" });
        });
        return;
      }

      if (!invoice_number) {
        connection.rollback(() => {
          connection.release();
          return res.status(400).json({ error: "invoice_number is required" });
        });
        return;
      }

      // Parse and validate total_advance_adjusted
      let totalAdjusted = parseFloat(total_advance_adjusted);
      if (isNaN(totalAdjusted) || totalAdjusted < 0) {
        totalAdjusted = parseFloat(receipt_amount);
        if (isNaN(totalAdjusted) || totalAdjusted <= 0) {
          connection.rollback(() => {
            connection.release();
            return res.status(400).json({
              error: "Valid total_advance_adjusted or receipt_amount is required",
              received_total: total_advance_adjusted,
              received_amount: receipt_amount,
              parsed: totalAdjusted
            });
          });
          return;
        }
      }

      if (totalAdjusted <= 0) {
        connection.rollback(() => {
          connection.release();
          return res.status(400).json({
            error: "Amount must be greater than 0",
            amount: totalAdjusted
          });
        });
        return;
      }

      // Parse advance receipt IDs
      let advanceIds = [];
      if (typeof advance_receipt_ids === 'string') {
        advanceIds = advance_receipt_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
      } else if (Array.isArray(advance_receipt_ids)) {
        advanceIds = advance_receipt_ids.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
      }

      if (advanceIds.length === 0) {
        connection.rollback(() => {
          connection.release();
          return res.status(400).json({ error: "No valid advance receipts selected" });
        });
        return;
      }

      console.log('💰 Applying advance receipts:', {
        receipt_id,
        advanceIds,
        invoice_number,
        totalAdjusted,
        customer_id
      });

      // Get the new receipt details
      connection.query(
        `SELECT VoucherID, VchNo, TotalAmount, COALESCE(paid_amount, 0) as paid_amount, PartyID 
         FROM voucher 
         WHERE VoucherID = ? AND TransactionType = 'Receipt'`,
        [receipt_id],
        (err, newReceipt) => {
          if (err) {
            connection.rollback(() => {
              connection.release();
              console.error("Error fetching receipt:", err);
              return res.status(500).json({ error: "Failed to fetch receipt" });
            });
            return;
          }

          if (newReceipt.length === 0) {
            connection.rollback(() => {
              connection.release();
              return res.status(404).json({ error: "Receipt not found" });
            });
            return;
          }

          let remainingToAdjust = totalAdjusted;
          let totalActuallyAdjusted = 0;
          const adjustedReceipts = [];
          let completedQueries = 0;
          let hasError = false;

          // Process each advance receipt
          advanceIds.forEach((advanceId) => {
            if (hasError) return;

            connection.query(
              `SELECT VoucherID, VchNo, TotalAmount, COALESCE(paid_amount, 0) as paid_amount, 
                      COALESCE(balance_amount, TotalAmount) as balance_amount, InvoiceNumber 
               FROM voucher 
               WHERE VoucherID = ? AND TransactionType = 'Receipt'`,
              [advanceId],
              (err, advanceReceipt) => {
                if (err || hasError) {
                  if (!hasError) {
                    hasError = true;
                    connection.rollback(() => {
                      connection.release();
                      console.error("Error fetching advance receipt:", err);
                      return res.status(500).json({ error: "Failed to fetch advance receipt" });
                    });
                  }
                  return;
                }

                if (advanceReceipt.length === 0 || remainingToAdjust <= 0) {
                  checkCompletion();
                  return;
                }

                const currentPaidAmount = parseFloat(advanceReceipt[0].paid_amount) || 0;
                const totalAmount = parseFloat(advanceReceipt[0].TotalAmount) || 0;
                const availableAmount = totalAmount - currentPaidAmount;

                const adjustedAmount = Math.min(remainingToAdjust, availableAmount);

                if (adjustedAmount <= 0) {
                  checkCompletion();
                  return;
                }

                const newPaidAmount = currentPaidAmount + adjustedAmount;
                const newBalanceAmount = totalAmount - newPaidAmount;
                remainingToAdjust -= adjustedAmount;
                totalActuallyAdjusted += adjustedAmount;

                let newStatus = 'Partial';
                if (newPaidAmount >= totalAmount) {
                  newStatus = 'Paid';
                }

                // ALWAYS update the invoice number
                const finalInvoiceNumber = invoice_number;

                console.log(`✅ Updating advance receipt ${advanceId} with invoice number: ${finalInvoiceNumber}`, {
                  receipt_number: advanceReceipt[0].VchNo,
                  old_invoice_number: advanceReceipt[0].InvoiceNumber || 'NULL',
                  new_invoice_number: finalInvoiceNumber,
                  adjustedAmount,
                  newStatus
                });

                // Update the advance receipt
                connection.query(
                  `UPDATE voucher 
                   SET 
                     InvoiceNumber = ?,
                     paid_amount = ?,
                     balance_amount = ?,
                     status = ?,
                     updated_at = NOW()
                   WHERE VoucherID = ?`,
                  [finalInvoiceNumber, newPaidAmount, newBalanceAmount, newStatus, advanceId],
                  (err) => {
                    if (err) {
                      if (!hasError) {
                        hasError = true;
                        connection.rollback(() => {
                          connection.release();
                          console.error("Error updating advance receipt:", err);
                          return res.status(500).json({ error: "Failed to update advance receipt" });
                        });
                      }
                      return;
                    }

                    adjustedReceipts.push({
                      id: advanceId,
                      receipt_number: advanceReceipt[0].VchNo,
                      adjusted_amount: adjustedAmount,
                      invoice_number_assigned: finalInvoiceNumber
                    });

                    checkCompletion();
                  }
                );

                function checkCompletion() {
                  completedQueries++;
                  if (completedQueries === advanceIds.length && !hasError) {
                    console.log('✅ All advance receipts processed. Total adjusted:', totalActuallyAdjusted);
                    
                    // Update the new receipt to mark it as having adjusted advance receipts
                    if (adjustedReceipts.length > 0) {
                      const adjustmentNote = adjustedReceipts.map(r =>
                        `${r.receipt_number} (₹${r.adjusted_amount})`
                      ).join(', ');
                      
                      // Check if columns exist before updating
                      connection.query(
                        `SHOW COLUMNS FROM voucher LIKE 'advance_receipts_adjusted'`,
                        (err, columns) => {
                          if (columns.length > 0) {
                            connection.query(
                              `UPDATE voucher 
                               SET 
                                 advance_receipts_adjusted = ?,
                                 total_advance_adjusted = ?,
                                 note = CONCAT(IFNULL(note, ''), '\n✅ Adjusted advance receipts: ', ?),
                                 updated_at = NOW()
                               WHERE VoucherID = ?`,
                              [
                                advanceIds.join(','),
                                totalActuallyAdjusted,
                                adjustmentNote,
                                receipt_id
                              ],
                              (err) => {
                                if (err) {
                                  console.warn('Warning: Could not update advance receipt tracking:', err);
                                }
                                commitTransaction();
                              }
                            );
                          } else {
                            commitTransaction();
                          }
                        }
                      );
                    } else {
                      commitTransaction();
                    }

                    function commitTransaction() {
                      connection.commit((commitErr) => {
                        if (commitErr) {
                          connection.rollback(() => {
                            connection.release();
                            console.error("Commit error:", commitErr);
                            return res.status(500).json({ error: "Failed to commit transaction" });
                          });
                          return;
                        }
                        connection.release();
                        
                        console.log('✅ Transaction committed successfully!');
                        console.log('📝 Adjusted receipts:', adjustedReceipts);
                        
                        // Send success response
                        return res.json({
                          success: true,
                          message: "Advance receipts adjusted successfully",
                          adjusted_receipts: adjustedReceipts,
                          total_adjusted: totalActuallyAdjusted,
                          remaining_to_adjust: remainingToAdjust,
                          invoice_number: invoice_number
                        });
                      });
                    }
                  }
                }
              }
            );
          });
        }
      );
    });
  });
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

router.get('/last-payment', async (req, res) => {
  try {
    db.execute(
      `SELECT VchNo 
       FROM voucher 
       WHERE TransactionType = 'Payment' 
       ORDER BY VoucherID DESC 
       LIMIT 1`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching last payment from voucher:', error);
          return res.status(500).json({ error: 'Failed to fetch last payment' });
        }

        if (results && results.length > 0) {
          res.json({ lastReceiptNumber: results[0].VchNo });
        } else {
          res.json({ lastReceiptNumber: null });
        }
      }
    );
  } catch (error) {
    console.error('Error in /last-payment route:', error);
    res.status(500).json({ error: 'Failed to fetch last payment' });
  }
});


// ------------------------------
// Get all receipts
// ------------------------------
router.get('/receipts', async (req, res) => {
  try {
    const { data_type } = req.query;

    let invoiceTypes = `'Sales','stock transfer'`;
    let whereClause = "r.TransactionType = 'Receipt'";

    if (data_type === 'Sales') {
      invoiceTypes = `'Sales'`;
      // Add filter for Sales-related receipts
      whereClause += ` AND EXISTS (
        SELECT 1 FROM voucher v 
        WHERE v.PartyID = r.PartyID 
        AND v.TransactionType = 'Sales'
      )`;
    } else if (data_type === 'stock transfer') {
      invoiceTypes = `'stock transfer'`;
      // Add filter for stock transfer-related receipts
      whereClause += ` AND EXISTS (
        SELECT 1 FROM voucher v 
        WHERE v.PartyID = r.PartyID 
        AND v.TransactionType = 'stock transfer'
      )`;
    } else if (data_type === 'stock transfer') {
      invoiceTypes = `'stock transfer'`;
      // Add filter for stock transfer-related receipts
      whereClause += ` AND EXISTS (
        SELECT 1 FROM voucher v 
        WHERE v.PartyID = r.PartyID 
        AND v.TransactionType = 'stock transfer'
      )`;
    }

    const sql = `
      SELECT 
        r.*,
        a.business_name,
        a.name AS payee_name,

        (
          SELECT GROUP_CONCAT(DISTINCT v.InvoiceNumber)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
          
            AND v.TransactionType IN (${invoiceTypes})
        ) AS invoice_numbers,

        (
          SELECT SUM(v.TotalAmount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
          
            AND v.TransactionType IN (${invoiceTypes})
        ) AS total_invoice_amount,

        (
          SELECT SUM(v.paid_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
          
            AND v.TransactionType IN (${invoiceTypes})
        ) AS total_paid_amount,

        (
          SELECT SUM(v.balance_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
          
            AND v.TransactionType IN (${invoiceTypes})
        ) AS total_balance_amount

      FROM voucher r
      LEFT JOIN accounts a ON r.PartyID = a.id
      WHERE ${whereClause}
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
    const { data_type } = req.query;

    let invoiceTypes = `'Sales','stock transfer'`;
    let whereClause = "r.VoucherID = ? AND r.TransactionType = 'Receipt'";

    if (data_type === 'Sales') {
      invoiceTypes = `'Sales'`;
      whereClause += ` AND EXISTS (
        SELECT 1 FROM voucher v 
        WHERE v.PartyID = r.PartyID 
        AND v.InvoiceNumber = r.InvoiceNumber
        AND v.TransactionType = 'Sales'
      )`;
    } else if (data_type === 'stock transfer') {
      invoiceTypes = `'stock transfer'`;
      whereClause += ` AND EXISTS (
        SELECT 1 FROM voucher v 
        WHERE v.PartyID = r.PartyID 
        AND v.InvoiceNumber = r.InvoiceNumber
        AND v.TransactionType = 'stock transfer'
      )`;
    }

    const sql = `
      SELECT 
        r.*,
        a.business_name,
        a.name AS payee_name,

        (
          SELECT GROUP_CONCAT(DISTINCT v.InvoiceNumber)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN (${invoiceTypes})
        ) AS invoice_numbers,

        (
          SELECT SUM(v.TotalAmount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN (${invoiceTypes})
        ) AS total_invoice_amount,

        (
          SELECT SUM(v.paid_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN (${invoiceTypes})
        ) AS total_paid_amount,

        (
          SELECT SUM(v.balance_amount)
          FROM voucher v
          WHERE 
            v.PartyID = r.PartyID
            AND v.InvoiceNumber = r.InvoiceNumber
            AND v.TransactionType IN (${invoiceTypes})
        ) AS total_balance_amount

      FROM voucher r
      LEFT JOIN accounts a ON r.PartyID = a.id
      WHERE ${whereClause}
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
    const { data_type } = req.query;

    let baseQuery = `
      SELECT 
        v.*, 
        a.business_name, 
        a.name AS payee_name,
        (
          SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
          FROM voucher v2
          WHERE v2.VchNo = v.VchNo
            AND v2.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
            AND v2.InvoiceNumber IS NOT NULL
            AND v2.InvoiceNumber != ''
        ) AS invoice_numbers,

        COALESCE((
          SELECT SUM(p.TotalAmount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType IN ('Purchase', 'stock inward')
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(
              p.InvoiceNumber,
              (
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              )
            ) > 0
        ), 0) AS total_invoice_amount,

        COALESCE((
          SELECT SUM(p.paid_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType IN ('Purchase', 'stock inward')
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(
              p.InvoiceNumber,
              (
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              )
            ) > 0
        ), 0) AS total_paid_amount,

        COALESCE((
          SELECT SUM(p.balance_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType IN ('Purchase', 'stock inward')
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(
              p.InvoiceNumber,
              (
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              )
            ) > 0
        ), 0) AS total_balance_amount

      FROM voucher v
      LEFT JOIN accounts a ON v.PartyID = a.id
    `;

    // FIXED: Filter by TransactionType = 'purchase voucher'
    let whereClause = "WHERE v.TransactionType = 'purchase voucher'";

    const type = data_type?.trim();

    if (type === 'Purchase') {
      // For Purchase type, filter by data_type = 'Purchase' AND TransactionType = 'purchase voucher'
      whereClause = `WHERE v.TransactionType = 'purchase voucher' 
                     AND EXISTS (
                       SELECT 1 FROM voucher p 
                       WHERE p.PartyID = v.PartyID 
                       AND p.InvoiceNumber = v.InvoiceNumber
                       AND p.TransactionType = 'Purchase'
                     )`;
    } else if (type === 'stock inward') {
      // For stock inward type, filter by data_type = 'stock inward' AND TransactionType = 'purchase voucher'
      whereClause = `WHERE v.TransactionType = 'purchase voucher' 
                     AND EXISTS (
                       SELECT 1 FROM voucher p 
                       WHERE p.PartyID = v.PartyID 
                       AND p.InvoiceNumber = v.InvoiceNumber
                       AND p.TransactionType = 'stock inward'
                     )`;
    }
    // No else needed - default shows all purchase vouchers

    const orderClause = `ORDER BY v.created_at DESC`;
    const query = `${baseQuery} ${whereClause} ${orderClause}`;

    console.log('Executing voucher query with data_type:', type);
    console.log('Where clause:', whereClause);

    db.execute(query, (error, results) => {
      if (error) {
        console.error('Database error fetching vouchers:', error);
        return res.status(500).json({ error: 'Failed to fetch vouchers' });
      }

      console.log('Voucher results count:', results.length);

      const processedResults = results.map(voucher => ({
        ...voucher,
        invoice_numbers: voucher.invoice_numbers ? voucher.invoice_numbers.split(',') : [],
        total_invoice_amount: parseFloat(voucher.total_invoice_amount) || 0,
        total_paid_amount: parseFloat(voucher.total_paid_amount) || 0,
        total_balance_amount: parseFloat(voucher.total_balance_amount) || 0
      }));

      res.json(processedResults);
    });

  } catch (error) {
    console.error('Error in /voucher route:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
router.get('/voucher/:id', async (req, res) => {
  try {
    const { data_type } = req.query;
    const type = data_type?.trim();

    // Base query with proper filtering
    let baseQuery = `
      SELECT 
        v.*, 
        a.business_name, 
        a.name AS payee_name,

        (
          SELECT GROUP_CONCAT(DISTINCT v2.InvoiceNumber)
          FROM voucher v2
          WHERE v2.VchNo = v.VchNo
            AND v2.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
            AND v2.InvoiceNumber IS NOT NULL
            AND v2.InvoiceNumber != ''
        ) AS invoice_numbers,

        COALESCE((
          SELECT SUM(p.TotalAmount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType IN ('Purchase', 'stock inward')
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(
              p.InvoiceNumber,
              (
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              )
            ) > 0
        ), 0) AS total_invoice_amount,

        COALESCE((
          SELECT SUM(p.paid_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType IN ('Purchase', 'stock inward')
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(
              p.InvoiceNumber,
              (
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              )
            ) > 0
        ), 0) AS total_paid_amount,

        COALESCE((
          SELECT SUM(p.balance_amount)
          FROM voucher p
          WHERE p.PartyID = v.PartyID
            AND p.TransactionType IN ('Purchase', 'stock inward')
            AND p.InvoiceNumber IS NOT NULL
            AND p.InvoiceNumber != ''
            AND FIND_IN_SET(
              p.InvoiceNumber,
              (
                SELECT GROUP_CONCAT(DISTINCT v3.InvoiceNumber)
                FROM voucher v3
                WHERE v3.VchNo = v.VchNo
                  AND v3.TransactionType IN ('Purchase', 'purchase voucher', 'stock inward')
                  AND v3.InvoiceNumber IS NOT NULL
                  AND v3.InvoiceNumber != ''
              )
            ) > 0
        ), 0) AS total_balance_amount

      FROM voucher v
      LEFT JOIN accounts a ON v.PartyID = a.id
      WHERE v.VoucherID = ?
        AND v.TransactionType = 'purchase voucher'
    `;

    let additionalCondition = "";

    if (type === 'Purchase') {
      additionalCondition = `AND EXISTS (
        SELECT 1 FROM voucher p 
        WHERE p.PartyID = v.PartyID 
        AND p.InvoiceNumber = v.InvoiceNumber
        AND p.TransactionType = 'Purchase'
      )`;
    } else if (type === 'stock inward') {
      additionalCondition = `AND EXISTS (
        SELECT 1 FROM voucher p 
        WHERE p.PartyID = v.PartyID 
        AND p.InvoiceNumber = v.InvoiceNumber
        AND p.TransactionType = 'stock inward'
      )`;
    }

    const query = `${baseQuery} ${additionalCondition}`;

    db.execute(query, [req.params.id], (error, results) => {
      if (error) {
        console.error('DB error:', error);
        return res.status(500).json({ error: 'Failed to fetch voucher' });
      }

      if (!results.length) {
        return res.status(404).json({ error: 'Voucher not found' });
      }

      const voucher = {
        ...results[0],
        invoice_numbers: results[0].invoice_numbers
          ? results[0].invoice_numbers.split(',')
          : [],
        total_invoice_amount: Number(results[0].total_invoice_amount) || 0,
        total_paid_amount: Number(results[0].total_paid_amount) || 0,
        total_balance_amount: Number(results[0].total_balance_amount) || 0
      };

      res.json(voucher);
    });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/voucher/:id', upload.single('transaction_proof'), async (req, res) => {
  const voucherId = req.params.id;
  console.log("📌 PUT Request Body:", req.body);
  let connection;

  try {
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });

    await connection.promise().beginTransaction();

    // ------------------------------
    // 1️⃣ FETCH CURRENT VOUCHER (RECEIPT) DETAILS
    // ------------------------------
    const [receiptRows] = await connection.promise().query(
      `SELECT InvoiceNumber, paid_amount, TransactionType, TotalAmount,
                    balance_amount, PartyID, PartyName, AccountName
             FROM voucher
             WHERE VoucherID = ?`,
      [voucherId]
    );

    if (receiptRows.length === 0) {
      throw new Error('Voucher not found');
    }

    const receipt = receiptRows[0];
    const oldInvoiceNumber = receipt.InvoiceNumber;
    const newInvoiceNumber = req.body.invoice_number || req.body.invoiceNumber || oldInvoiceNumber;
    const oldPaidAmount = parseFloat(receipt.paid_amount) || 0;
    const isReceiptType = receipt.TransactionType === 'Receipt' ||
      receipt.TransactionType === 'purchase voucher';
    const retailerId = receipt.PartyID;

    const newPaidAmount = req.body.paid_amount !== undefined
      ? parseFloat(req.body.paid_amount) || 0
      : oldPaidAmount;

    const paidAmountChanged = newPaidAmount !== oldPaidAmount;
    const invoiceNumberChanged = newInvoiceNumber !== oldInvoiceNumber;

    console.log("📊 Receipt Details:", {
      voucherId,
      oldInvoiceNumber,
      newInvoiceNumber,
      oldPaidAmount,
      newPaidAmount,
      paidAmountChanged,
      invoiceNumberChanged,
      isReceiptType,
      retailerId
    });

    // ------------------------------
    // 2️⃣ HANDLE OLD INVOICE IF INVOICE NUMBER IS CHANGING
    // ------------------------------
    if (invoiceNumberChanged && oldInvoiceNumber && isReceiptType) {
      console.log(`🔄 Invoice number changing from "${oldInvoiceNumber}" to "${newInvoiceNumber}"`);

      // Find the OLD invoice
      const [oldInvoiceRows] = await connection.promise().query(
        `SELECT VoucherID, TotalAmount, balance_amount, status, TransactionType, order_number
                 FROM voucher
                 WHERE InvoiceNumber = ?
                   AND TransactionType IN ('Purchase', 'Sales', 'stock transfer', 'stock inward')
                 LIMIT 1`,
        [oldInvoiceNumber]
      );

      if (oldInvoiceRows.length > 0) {
        const oldInvoice = oldInvoiceRows[0];

        // Get all other receipts for this old invoice (excluding current receipt)
        const [otherReceipts] = await connection.promise().query(
          `SELECT SUM(paid_amount) as totalOtherReceipts
                     FROM voucher
                     WHERE InvoiceNumber = ? 
                       AND TransactionType IN ('Receipt', 'purchase voucher')
                       AND VoucherID != ?`,
          [oldInvoiceNumber, voucherId]
        );

        const totalOtherReceipts = parseFloat(otherReceipts[0].totalOtherReceipts) || 0;
        const oldInvoiceTotalAmount = parseFloat(oldInvoice.TotalAmount) || 0;

        // Calculate new balance for old invoice (total amount - other receipts)
        const newBalanceForOldInvoice = oldInvoiceTotalAmount - totalOtherReceipts;

        // Determine new status for OLD invoice
        let newStatusForOldInvoice = "pending";
        if (newBalanceForOldInvoice <= 0) {
          newStatusForOldInvoice = "Paid";
        } else if (newBalanceForOldInvoice > 0 && newBalanceForOldInvoice < oldInvoiceTotalAmount) {
          newStatusForOldInvoice = "Partial";
        }

        console.log("🔄 Updating OLD invoice after removing current receipt:", {
          oldInvoiceNumber,
          totalAmount: oldInvoiceTotalAmount,
          otherReceiptsTotal: totalOtherReceipts,
          newBalance: newBalanceForOldInvoice,
          newStatus: newStatusForOldInvoice
        });

        await connection.promise().query(
          `UPDATE voucher
                     SET balance_amount = ?, status = ?, updated_at = NOW()
                     WHERE VoucherID = ?`,
          [newBalanceForOldInvoice, newStatusForOldInvoice, oldInvoice.VoucherID]
        );
      }
    }

    // ------------------------------
    // 3️⃣ UPDATE THE RECEIPT VOUCHER WITH NEW DATA
    // ------------------------------
    const updateFields = [];
    const updateValues = [];

    // Always update paid_amount if provided
    if (req.body.paid_amount !== undefined) {
      updateFields.push('paid_amount = ?', 'TotalAmount = ?');
      updateValues.push(newPaidAmount, newPaidAmount);

      if (newPaidAmount > 0) {
        updateFields.push('paid_date = ?');
        updateValues.push(new Date());
      }
    }

    // Update invoice_number if provided
    if (req.body.invoice_number !== undefined || req.body.invoiceNumber !== undefined) {
      updateFields.push('InvoiceNumber = ?');
      updateValues.push(newInvoiceNumber);
    }

    // Map other fields
    const fieldMapping = {
      retailer_name: 'PartyName',
      account_name: 'AccountName',
      business_name: 'business_name',
      bank_name: 'BankName',
      data_type: 'data_type',
    };

    for (const [key, value] of Object.entries(req.body)) {
      if (key === 'paid_amount' || key === 'invoice_number' || key === 'invoiceNumber') continue;

      const dbColumn = fieldMapping[key] || key;

      if (value !== undefined) {
        updateFields.push(`${dbColumn} = ?`);
        updateValues.push(value !== '' ? value : null);
      }
    }

    if (req.file) {
      updateFields.push('transaction_proof = ?');
      updateValues.push(req.file.filename);
    }

    // ------------------------------
    // 4️⃣ HANDLE NEW INVOICE - UPDATE ITS BALANCE (FIXED CALCULATION)
    // ------------------------------
    // ------------------------------
    // 4️⃣ HANDLE NEW INVOICE - UPDATE ITS BALANCE (FIXED CALCULATION)
    // ------------------------------
    let matchedInvoiceDetails = null;
    let receiptBalanceAmount = newPaidAmount; // Default to paid amount

    if (newInvoiceNumber && isReceiptType) {
      console.log(`🔍 Looking for invoice with number: ${newInvoiceNumber}`);

      // Find the invoice in voucher table
      const [invoiceRows] = await connection.promise().query(
        `SELECT VoucherID, InvoiceNumber, TotalAmount, balance_amount, status, 
                TransactionType, order_number, PartyName, created_at
         FROM voucher
         WHERE InvoiceNumber = ?
           AND TransactionType IN ('Purchase', 'Sales', 'stock transfer', 'stock inward')  
         LIMIT 1`,
        [newInvoiceNumber]
      );

      if (invoiceRows.length > 0) {
        const invoice = invoiceRows[0];
        const invoiceTotalAmount = parseFloat(invoice.TotalAmount) || 0;

        // Get ALL receipts linked to this invoice (EXCLUDING current receipt for calculation)
        const [otherReceipts] = await connection.promise().query(
          `SELECT SUM(paid_amount) as totalOtherReceipts
             FROM voucher
             WHERE InvoiceNumber = ? 
               AND TransactionType IN ('Receipt', 'purchase voucher')
               AND VoucherID != ?`,
          [newInvoiceNumber, voucherId]
        );

        const totalOtherReceipts = parseFloat(otherReceipts[0].totalOtherReceipts) || 0;

        let currentInvoiceBalance = parseFloat(invoice.balance_amount);

        if (currentInvoiceBalance === null || currentInvoiceBalance === undefined || currentInvoiceBalance === 0) {
          currentInvoiceBalance = invoiceTotalAmount;
          console.log("⚠️ balance_amount was null/0, using TotalAmount as current balance");
        }

        console.log("💰 Current invoice balance:", {
          invoiceNumber: newInvoiceNumber,
          totalAmount: invoiceTotalAmount,
          balanceFromDB: invoice.balance_amount,
          usingBalance: currentInvoiceBalance
        });

        let adjustmentAmount = newPaidAmount;

        if (!invoiceNumberChanged) {
          adjustmentAmount = newPaidAmount - oldPaidAmount;
        }

        const newBalance = Math.max(0, currentInvoiceBalance - adjustmentAmount);

        receiptBalanceAmount = newBalance;

        // Determine new status
        let newStatus = "pending";
        if (newBalance <= 0) {
          newStatus = "Paid";
        } else if (newBalance > 0 && newBalance < invoiceTotalAmount) {
          newStatus = "Partial";
        }

        matchedInvoiceDetails = {
          voucherId: invoice.VoucherID,
          invoiceNumber: invoice.InvoiceNumber,
          totalAmount: invoiceTotalAmount,
          previousBalance: invoice.balance_amount,
          previousStatus: invoice.status,
          newBalance: newBalance,
          newStatus: newStatus,
          transactionType: invoice.TransactionType,
          partyName: invoice.PartyName,
          orderNumber: invoice.order_number,
          otherReceipts: totalOtherReceipts,
          currentReceipt: newPaidAmount,
          adjustmentAmount: adjustmentAmount,
          calculationMethod: !invoiceNumberChanged ? "Difference adjustment" : "Full amount"
        };

        console.log("📊 Invoice Calculation (FIXED - MATCHES POST API):", {
          invoiceNumber: newInvoiceNumber,
          totalAmount: invoiceTotalAmount,
          currentInvoiceBalance: currentInvoiceBalance,
          oldPaidAmount: oldPaidAmount,
          newPaidAmount: newPaidAmount,
          adjustmentAmount: adjustmentAmount,
          invoiceNumberChanged: invoiceNumberChanged,
          totalOtherReceipts: totalOtherReceipts,
          calculatedBalance: newBalance,
          calculatedStatus: newStatus,
          receiptBalanceAmount: receiptBalanceAmount
        });

        // Update the invoice with new balance and status
        await connection.promise().query(
          `UPDATE voucher
             SET balance_amount = ?, 
                 status = ?, 
                 updated_at = NOW()
             WHERE VoucherID = ?`,
          [newBalance, newStatus, invoice.VoucherID]
        );

        console.log("✅ Invoice Updated Successfully:", matchedInvoiceDetails);

        // ------------------------------
        // 5️⃣ UPDATE UNPAID AMOUNT FOR RETAILER (if applicable)
        // ------------------------------
        const currentRetailerId = req.body.retailer_id || retailerId;
        if (currentRetailerId && invoice.order_number &&
          (invoice.TransactionType === 'Sales' || invoice.TransactionType === 'stock transfer' || invoice.TransactionType === 'stock inward')) {

          console.log(`💰 Updating unpaid amount for retailer: ${currentRetailerId}`);

          try {
            const tableCheck = await connection.promise().query(
              "SHOW COLUMNS FROM accounts LIKE 'unpaid_amount'"
            );

            if (tableCheck[0].length > 0) {
              const unpaidAmount = newBalance;

              const [currentAccount] = await connection.promise().query(
                "SELECT unpaid_amount, credit_limit, name FROM accounts WHERE id = ?",
                [currentRetailerId]
              );

              if (currentAccount.length > 0) {
                const accountName = currentAccount[0].name;
                const creditLimit = parseFloat(currentAccount[0].credit_limit) || 0;

                const balanceCheck = await connection.promise().query(
                  "SHOW COLUMNS FROM accounts LIKE 'balance_amount'"
                );

                const newBalanceAmount = creditLimit - unpaidAmount;

                if (balanceCheck[0].length > 0) {
                  await connection.promise().query(
                    `UPDATE accounts 
                                 SET unpaid_amount = ?,
                                     balance_amount = ?,
                                     updated_at = NOW()
                                 WHERE id = ?`,
                    [unpaidAmount, newBalanceAmount, currentRetailerId]
                  );
                } else {
                  await connection.promise().query(
                    `UPDATE accounts 
                                 SET unpaid_amount = ?,
                                     updated_at = NOW()
                                 WHERE id = ?`,
                    [unpaidAmount, currentRetailerId]
                  );
                }

                console.log(`✅ Account Updated:`, {
                  retailerId: currentRetailerId,
                  retailerName: accountName,
                  unpaidAmount
                });
              }
            }
          } catch (error) {
            console.error(`❌ Error updating unpaid amount:`, error.message);
          }
        }
      } else {
        console.log(`⚠️ No invoice found with number: ${newInvoiceNumber}`);
        if (invoiceNumberChanged) {
          updateFields.push('InvoiceNumber = ?');
          updateValues.push(null);
          console.log(`🔄 Will clear invoice number from receipt ${voucherId}`);
        }
      }
    }

    // Update receipt's balance_amount - this should be the REMAINING balance of the invoice
    updateFields.push('balance_amount = ?');
    updateValues.push(receiptBalanceAmount);

    if (updateFields.length > 0) {
      updateValues.push(voucherId);

      const updateQuery = `UPDATE voucher SET ${updateFields.join(', ')}, updated_at = NOW() WHERE VoucherID = ?`;
      console.log("📝 Update Query:", updateQuery);
      console.log("📝 Update Values:", updateValues);

      await connection.promise().query(updateQuery, updateValues);
    }

    // ------------------------------
    // 6️⃣ COMMIT TRANSACTION
    // ------------------------------
    await connection.promise().commit();

    res.json({
      success: true,
      message: 'Voucher updated successfully',
      VoucherID: voucherId,
      receipt_details: {
        paid_amount: newPaidAmount,
        invoice_number: newInvoiceNumber,
        balance_amount: receiptBalanceAmount // This now correctly shows 5720 for your case
      },
      invoice_update: matchedInvoiceDetails ? {
        invoice_found: true,
        invoice_number: matchedInvoiceDetails.invoiceNumber,
        voucher_id: matchedInvoiceDetails.voucherId,
        total_amount: matchedInvoiceDetails.totalAmount,
        previous_balance: matchedInvoiceDetails.previousBalance,
        previous_status: matchedInvoiceDetails.previousStatus,
        new_balance: matchedInvoiceDetails.newBalance,
        new_status: matchedInvoiceDetails.newStatus,
        transaction_type: matchedInvoiceDetails.transactionType,
        party_name: matchedInvoiceDetails.partyName,
        order_number: matchedInvoiceDetails.orderNumber
      } : {
        invoice_found: false,
        message: newInvoiceNumber ? 'Invoice not found' : 'No invoice selected'
      },
      updated_fields: updateFields.length > 0 ? updateFields : 'none'
    });

  } catch (error) {
    if (connection) {
      await connection.promise().rollback();
    }
    console.error('❌ Error updating voucher:', error);

    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
        console.log(`🗑️ Deleted uploaded file: ${req.file.filename}`);
      } catch (unlinkErr) {
        console.error('Failed to delete uploaded file:', unlinkErr);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update voucher'
    });
  } finally {
    if (connection) connection.release();
  }
});

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




// GET /api/receipts/advance/:customerId
// router.get('/receipts/advance/:customerId', (req, res) => {
//   const { customerId } = req.params;

//   const sql = `
//     SELECT 
//       r.VoucherID AS id,
//       r.VchNo AS receipt_number,
//       DATE(r.Date) AS receipt_date,
//       r.TotalAmount AS total_amount,
//       COALESCE(r.paid_amount, 0) AS paid_amount,
//       r.payment_method,
//       r.BankName AS bank_name,
//       r.note,
//       r.PartyID AS customer_id,
//       a.business_name,
//       a.name AS customer_name,
//       r.InvoiceNumber AS invoice_number,
//       r.status,
//       r.assigned_staff,
//       r.staffid AS staff_id
//     FROM voucher r
//     LEFT JOIN accounts a ON r.PartyID = a.id
//     WHERE 
//       r.TransactionType = 'Receipt'
//       AND r.PartyID = ?
//       AND r.status = 'Paid'
//       AND (r.InvoiceNumber IS NULL OR r.InvoiceNumber = '')
//     ORDER BY r.Date ASC
//   `;

//   db.query(sql, [customerId], (err, results) => {
//     if (err) {
//       console.error("Error fetching advance receipts:", err);
//       return res.status(500).json({
//         success: false,
//         error: err.message
//       });
//     }

//     const receipts = results.map(r => ({
//       ...r,
//       available_amount: parseFloat(r.total_amount) - parseFloat(r.paid_amount)
//     }));

//     res.json({
//       success: true,
//       count: receipts.length,
//       receipts: receipts,
//       customer_id: customerId
//     });
//   });
// });


module.exports = router;