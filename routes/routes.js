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

router.post('/receipts', upload.single('transaction_proof'), async (req, res) => {
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
      invoice_number,
      product_id,        
      batch_id           
    } = req.body;

    // Log the incoming data to verify
    console.log('Frontend data:', {
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
      invoice_number,
      product_id,        
      batch_id           
    });

    // Get uploaded file info
    let transaction_proof_filename = null;
    if (req.file) {
      transaction_proof_filename = req.file.filename;
    }

    if (!receipt_number || !receipt_number.match(/^REC\d+$/)) {
      // Delete uploaded file if validation fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
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
      // Delete uploaded file if receipt number exists
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      throw new Error(`Receipt number ${receipt_number} already exists`);
    }

    const receiptAmount = parseFloat(amount || 0);

    // Insert receipt with transaction proof filename
    const receiptResult = await new Promise((resolve, reject) => {
      connection.execute(
        `INSERT INTO receipts (
          receipt_number, retailer_id, amount, currency, payment_method,
          receipt_date, note, bank_name, transaction_date, reconciliation_option,
          transaction_proof_filename
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          transaction_proof_filename
        ],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    const receiptId = receiptResult.insertId; 
    console.log('Receipt inserted with ID:', receiptId);

    const cashBankAccountID = 1; 
    const cashBankAccountName = bank_name ? `${bank_name} Bank` : 'Cash Account';

    // Get latest balance for cash/bank account from voucher table
    const cashBankBalance = await new Promise((resolve, reject) => {
      connection.execute(
        `SELECT balance_amount FROM voucher WHERE AccountID = ? ORDER BY Date DESC, VoucherID DESC LIMIT 1`,
        [cashBankAccountID],
        (err, results) => {
          if (err) reject(err);
          else resolve(results.length > 0 ? parseFloat(results[0].balance_amount) : 0);
        }
      );
    });

    const newCashBankBalance = cashBankBalance + receiptAmount;

    // Insert Debit entry for Cash/Bank in voucher table (instead of ledger)
    await new Promise((resolve, reject) => {
      connection.execute(
        `INSERT INTO voucher (
          TransactionType, VchNo, Date, AccountID, AccountName, 
          paid_amount, balance_amount, DC, receiptID
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'Receipt',
          receipt_number,
          receipt_date || new Date(),
          cashBankAccountID,
          cashBankAccountName,
          receiptAmount,
          newCashBankBalance,
          'D', // Debit for cash/bank
          receiptId  // Store receiptID from receipts table
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log('Cash/Bank voucher entry created with receiptID:', receiptId);

    if (retailer_id) {
      // Get latest balance for customer account from voucher table
      const customerBalance = await new Promise((resolve, reject) => {
        connection.execute(
          `SELECT balance_amount FROM voucher WHERE AccountID = ? ORDER BY Date DESC, VoucherID DESC LIMIT 1`,
          [retailer_id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results.length > 0 ? parseFloat(results[0].balance_amount) : 0);
          }
        );
      });

      const newCustomerBalance = customerBalance - receiptAmount; // Credit reduces customer balance

      // Insert Credit entry for Customer in voucher table (instead of ledger)
      await new Promise((resolve, reject) => {
        connection.execute(
          `INSERT INTO voucher (
            TransactionType, VchNo, Date, AccountID, AccountName, 
            paid_amount, balance_amount, DC, receiptID
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'Receipt',
            receipt_number,
            receipt_date || new Date(),
            retailer_id,
            retailer_name || 'Customer',
            receiptAmount,
            newCustomerBalance,
            'C', // Credit for customer
            receiptId  // Store receiptID from receipts table
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      console.log('Customer voucher entry created with receiptID:', receiptId);
    } else {
      const sundryDebtorsAccountID = 2; 
      const sundryDebtorsAccountName = 'Sundry Debtors';

      // Get latest balance for sundry debtors account from voucher table
      const sundryBalance = await new Promise((resolve, reject) => {
        connection.execute(
          `SELECT balance_amount FROM voucher WHERE AccountID = ? ORDER BY Date DESC, VoucherID DESC LIMIT 1`,
          [sundryDebtorsAccountID],
          (err, results) => {
            if (err) reject(err);
            else resolve(results.length > 0 ? parseFloat(results[0].balance_amount) : 0);
          }
        );
      });

      const newSundryBalance = sundryBalance - receiptAmount;

      // Insert Credit entry for Sundry Debtors in voucher table (instead of ledger)
      // await new Promise((resolve, reject) => {
      //   connection.execute(
      //     `INSERT INTO voucher (
      //       TransactionType, VchNo, Date, AccountID, AccountName, 
      //       paid_amount, balance_amount, DC, receiptID
      //     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      //     [
      //       'Receipt',
      //       receipt_number,
      //       receipt_date || new Date(),
      //       sundryDebtorsAccountID,
      //       sundryDebtorsAccountName,
      //       receiptAmount,
      //       newSundryBalance,
      //       'C', // Credit for sundry debtors
      //       receiptId  // Store receiptID from receipts table
      //     ],
      //     (err) => {
      //       if (err) reject(err);
      //       else resolve();
      //     }
      //   );
      // });

      // console.log('Sundry Debtors voucher entry created with receiptID:', receiptId);
    }

    // Step 2: Update voucher table for receipt application against sales
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

          // SIMPLIFIED INSERT - Only essential fields for receipt application
          await new Promise((resolve, reject) => {
            connection.execute(
              `INSERT INTO voucher (
                TransactionType, VchNo, InvoiceNumber, product_id, batch_id, Date,
                AccountID, AccountName, PartyID, PartyName,
                paid_amount, balance_amount, receipt_number, status, paid_date,
                receiptID, DC
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                'Receipt',
                receipt_number,
                voucher.InvoiceNumber,
                product_id || null,        
                batch_id || null,          
                currentDate,
                voucher.AccountID,
                voucher.AccountName,
                voucher.PartyID,
                retailer_name || voucher.PartyName,
                amountToApply,
                updatedBalanceAmount,
                receipt_number,
                updatedBalanceAmount <= 0.01 ? 'Paid' : 'Partial',
                currentDate,
                receiptId,  // Store receiptID
                'C'         // DC for customer receipt application
              ],
              err => (err ? reject(err) : resolve())
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
                TransactionType, VchNo, product_id, batch_id, Date, TotalAmount,
                PartyID, PartyName,
                paid_amount, balance_amount, receipt_number, status, paid_date,
                receiptID, DC
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                'Receipt',
                receipt_number,
                product_id || null,        
                batch_id || null,          
                currentDate,
                remainingAmount,
                retailer_id,
                retailer_name,
                remainingAmount,
                0,
                receipt_number,
                'Paid',
                currentDate,
                receiptId,  // Store receiptID
                'C'         // DC for advance payment
              ],
              err => (err ? reject(err) : resolve())
            );
          });
        }
      } else {
        // No sales vouchers found: simple receipt entry (advance payment)
        await new Promise((resolve, reject) => {
          connection.execute(
            `INSERT INTO voucher (
              TransactionType, VchNo, product_id, batch_id, Date, TotalAmount,
              PartyID, PartyName,
              paid_amount, balance_amount, receipt_number, status, paid_date,
              receiptID, DC
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              'Receipt',
              receipt_number,
              product_id || null,        
              batch_id || null,          
              new Date(),
              receiptAmount,
              retailer_id || null,
              retailer_name || '',
              receiptAmount,
              0,
              receipt_number,
              'Paid',
              new Date(),
              receiptId,  // Store receiptID
              'C'         // DC for advance payment
            ],
            err => (err ? reject(err) : resolve())
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

    // Prepare response
    const response = {
      id: receiptId,
      message: 'Receipt created and ledger entries stored in voucher table successfully',
      receipt_number,
      transaction_proof_filename: transaction_proof_filename,
      product_id: product_id,      
      batch_id: batch_id,          
      voucherEntries: {
        receiptID: receiptId,
        cashBank: { 
          accountId: cashBankAccountID, 
          accountName: cashBankAccountName,
          balance: newCashBankBalance
        },
        customer: { 
          accountId: retailer_id || 2,
          accountName: retailer_name || 'Customer',
          balance: retailer_id ? (await new Promise((resolve, reject) => {
            connection.execute(
              `SELECT balance_amount FROM voucher WHERE AccountID = ? ORDER BY Date DESC, VoucherID DESC LIMIT 1`,
              [retailer_id],
              (err, results) => {
                if (err) reject(err);
                else resolve(results.length > 0 ? parseFloat(results[0].balance_amount) : 0);
              }
            );
          })) - receiptAmount : 0
        }
      }
    };

    res.status(201).json(response);

  } catch (error) {
    if (connection) {
      await new Promise(resolve => connection.rollback(() => resolve()));
    }
    
    // Delete uploaded file if transaction fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
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
      `SELECT 
         r.*, 
         a.business_name, 
         a.name as payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v.InvoiceNumber) 
           FROM voucher v 
           WHERE v.receipt_number = r.receipt_number 
           AND v.TransactionType IN ('Sales', 'Receipt')
           AND v.InvoiceNumber IS NOT NULL
           AND v.InvoiceNumber != ''
         ) as invoice_numbers
       FROM receipts r 
       LEFT JOIN accounts a ON r.retailer_id = a.id 
       ORDER BY r.created_at DESC`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching receipts:', error);
          return res.status(500).json({ error: 'Failed to fetch receipts' });
        }

        // Process the results to format invoice_numbers as array
        const processedResults = results.map(receipt => ({
          ...receipt,
          invoice_numbers: receipt.invoice_numbers ? receipt.invoice_numbers.split(',') : []
        }));

        console.log('Receipts fetched:', processedResults.length);
        res.json(processedResults || []);
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
      `SELECT 
         r.*, 
         a.business_name, 
         a.name as payee_name,
         (
           SELECT GROUP_CONCAT(DISTINCT v.InvoiceNumber) 
           FROM voucher v 
           WHERE v.receipt_number = r.receipt_number 
           AND v.TransactionType IN ('Sales', 'Receipt')
           AND v.InvoiceNumber IS NOT NULL
           AND v.InvoiceNumber != ''
         ) as invoice_numbers
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

        // Process the result to format invoice_numbers as array
        const receipt = {
          ...results[0],
          invoice_numbers: results[0].invoice_numbers ? results[0].invoice_numbers.split(',') : []
        };

        console.log('Receipt fetched:', receipt);
        res.json(receipt);
      }
    );
  } catch (error) {
    console.error('Error in receipt by ID route:', error);
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});

router.put('/receipts/:id', upload.single('transaction_proof'), async (req, res) => {
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

    // Get uploaded file info
    let transaction_proof_filename = null;
    if (req.file) {
      transaction_proof_filename = req.file.filename;
    }

    // First get the original receipt to delete old file if exists and get details
    const originalReceipt = await new Promise((resolve, reject) => {
      connection.execute(
        'SELECT * FROM receipts WHERE id = ?',
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results[0]);
        }
      );
    });

    if (!originalReceipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    const oldAmount = parseFloat(originalReceipt.amount);
    const newAmount = parseFloat(amount);
    const amountDifference = newAmount - oldAmount;

    // Prepare update data
    const updateFields = [
      'retailer_id = ?', 'amount = ?', 'currency = ?', 'payment_method = ?',
      'receipt_date = ?', 'note = ?', 'bank_name = ?', 'transaction_date = ?',
      'reconciliation_option = ?', 'updated_at = CURRENT_TIMESTAMP'
    ];
    
    const updateValues = [
      retailer_id, newAmount, currency, payment_method,
      receipt_date, note, bank_name, transaction_date,
      reconciliation_option
    ];

    // Add transaction proof filename if new file uploaded
    if (transaction_proof_filename) {
      updateFields.push('transaction_proof_filename = ?');
      updateValues.push(transaction_proof_filename);
    }

    updateValues.push(req.params.id);

    // Step 1: Update receipts table
    const updateResult = await new Promise((resolve, reject) => {
      connection.execute(
        `UPDATE receipts SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues,
        (error, results) => {
          if (error) reject(error);
          else resolve(results);
        }
      );
    });

    if (updateResult.affectedRows === 0) {
      throw new Error('Failed to update receipt');
    }

    // Delete old file if new file uploaded
    if (transaction_proof_filename && originalReceipt.transaction_proof_filename) {
      const oldFilePath = path.join(__dirname, '../uploads/receipts', originalReceipt.transaction_proof_filename);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    // Step 2: Update voucher table entries
    if (originalReceipt.retailer_id) {
      // Find all receipt voucher entries related to this receipt
      const receiptVouchers = await new Promise((resolve, reject) => {
        connection.execute(
          'SELECT * FROM voucher WHERE receipt_number = ? AND TransactionType = "Receipt"',
          [originalReceipt.receipt_number],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      if (receiptVouchers.length > 0) {
        // Update the main receipt voucher entry (usually the first one)
        const mainReceiptVoucher = receiptVouchers[0];
        const originalPaidAmount = parseFloat(mainReceiptVoucher.paid_amount);
        const newPaidAmount = Math.max(0, originalPaidAmount + amountDifference);
        const newBalanceAmount = parseFloat(mainReceiptVoucher.TotalAmount) - newPaidAmount;
        const newStatus = newBalanceAmount <= 0.01 ? 'Paid' : (newPaidAmount > 0 ? 'Partial' : 'Pending');

        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE voucher SET 
              paid_amount = ?, 
              balance_amount = ?,
              status = ?
             WHERE VoucherID = ?`,
            [
              newPaidAmount,
              newBalanceAmount,
              newStatus,
              mainReceiptVoucher.VoucherID
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });

        // Also update any sales vouchers that reference this receipt
        const salesVouchers = await new Promise((resolve, reject) => {
          connection.execute(
            'SELECT * FROM voucher WHERE receipt_number = ? AND TransactionType = "Sales"',
            [originalReceipt.receipt_number],
            (error, results) => {
              if (error) reject(error);
              else resolve(results);
            }
          );
        });

        for (const voucher of salesVouchers) {
          const originalPaidAmount = parseFloat(voucher.paid_amount);
          const newPaidAmount = Math.max(0, originalPaidAmount + amountDifference);
          const newBalanceAmount = parseFloat(voucher.TotalAmount) - newPaidAmount;
          const newStatus = newBalanceAmount <= 0.01 ? 'Paid' : (newPaidAmount > 0 ? 'Partial' : 'Pending');

          await new Promise((resolve, reject) => {
            connection.execute(
              `UPDATE voucher SET 
                paid_amount = ?, 
                balance_amount = ?,
                status = ?
               WHERE VoucherID = ?`,
              [
                newPaidAmount,
                newBalanceAmount,
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
    }

    // Step 3: Update ledger table entries
    if (amountDifference !== 0) {
      // Update customer/sundry debtors ledger entries
      const customerLedgerEntries = await new Promise((resolve, reject) => {
        connection.execute(
          'SELECT * FROM ledger WHERE voucherID = ? AND trantype = "Receipt" AND DC = "C"',
          [req.params.id],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      for (const ledger of customerLedgerEntries) {
        const newLedgerAmount = parseFloat(ledger.Amount) + amountDifference;
        
        // Update the ledger entry amount
        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE ledger SET 
              Amount = ?
             WHERE id = ?`,
            [
              newLedgerAmount,
              ledger.id
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });

        // Recalculate balances for this account from this point forward
        const subsequentEntries = await new Promise((resolve, reject) => {
          connection.execute(
            `SELECT * FROM ledger 
             WHERE AccountID = ? AND (created_at > ? OR (created_at = ? AND id > ?))
             ORDER BY created_at ASC, id ASC`,
            [
              ledger.AccountID,
              ledger.created_at,
              ledger.created_at,
              ledger.id
            ],
            (error, results) => {
              if (error) reject(error);
              else resolve(results);
            }
          );
        });

        let runningBalance = parseFloat(ledger.balance_amount) - amountDifference;
        
        // Update the current entry balance
        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE ledger SET 
              balance_amount = ?
             WHERE id = ?`,
            [
              runningBalance,
              ledger.id
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });

        // Update subsequent entries
        for (const subsequentEntry of subsequentEntries) {
          const amountChange = parseFloat(subsequentEntry.Amount);
          const isDebit = subsequentEntry.DC === 'D';
          
          if (isDebit) {
            runningBalance += amountChange;
          } else {
            runningBalance -= amountChange;
          }

          await new Promise((resolve, reject) => {
            connection.execute(
              `UPDATE ledger SET 
                balance_amount = ?
               WHERE id = ?`,
              [
                runningBalance,
                subsequentEntry.id
              ],
              (error) => {
                if (error) reject(error);
                else resolve();
              }
            );
          });
        }
      }

      // Update cash/bank ledger entries
      const cashBankLedgerEntries = await new Promise((resolve, reject) => {
        connection.execute(
          'SELECT * FROM ledger WHERE voucherID = ? AND trantype = "Receipt" AND DC = "D"',
          [req.params.id],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      for (const ledger of cashBankLedgerEntries) {
        const newLedgerAmount = parseFloat(ledger.Amount) + amountDifference;
        
        // Update the ledger entry amount
        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE ledger SET 
              Amount = ?
             WHERE id = ?`,
            [
              newLedgerAmount,
              ledger.id
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });

        // Recalculate balances for cash/bank account
        const subsequentEntries = await new Promise((resolve, reject) => {
          connection.execute(
            `SELECT * FROM ledger 
             WHERE AccountID = ? AND (created_at > ? OR (created_at = ? AND id > ?))
             ORDER BY created_at ASC, id ASC`,
            [
              ledger.AccountID,
              ledger.created_at,
              ledger.created_at,
              ledger.id
            ],
            (error, results) => {
              if (error) reject(error);
              else resolve(results);
            }
          );
        });

        let runningBalance = parseFloat(ledger.balance_amount) + amountDifference;
        
        // Update the current entry balance
        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE ledger SET 
              balance_amount = ?
             WHERE id = ?`,
            [
              runningBalance,
              ledger.id
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });

        // Update subsequent entries
        for (const subsequentEntry of subsequentEntries) {
          const amountChange = parseFloat(subsequentEntry.Amount);
          const isDebit = subsequentEntry.DC === 'D';
          
          if (isDebit) {
            runningBalance += amountChange;
          } else {
            runningBalance -= amountChange;
          }

          await new Promise((resolve, reject) => {
            connection.execute(
              `UPDATE ledger SET 
                balance_amount = ?
               WHERE id = ?`,
              [
                runningBalance,
                subsequentEntry.id
              ],
              (error) => {
                if (error) reject(error);
                else resolve();
              }
            );
          });
        }
      }
    }

    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({ 
      message: 'Receipt updated successfully across all tables',
      receipt_id: req.params.id,
      amount_updated: amountDifference !== 0,
      transaction_proof_filename: transaction_proof_filename
    });

  } catch (error) {
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }
    
    // Delete uploaded file if transaction fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    console.error('Error in update receipt route:', error);
    res.status(500).json({ error: error.message || 'Failed to update receipt' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

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
        'SELECT * FROM receipts WHERE id = ?',
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

    const receiptAmount = parseFloat(receipt.amount);
    const receiptNumber = receipt.receipt_number;

    // Step 1: Update sales voucher table to remove this receipt application
    if (receipt.retailer_id) {
      const salesVouchers = await new Promise((resolve, reject) => {
        connection.execute(
          'SELECT * FROM voucher WHERE PartyID = ? AND receipt_number = ? AND TransactionType = "Sales"',
          [receipt.retailer_id, receiptNumber],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      for (const voucher of salesVouchers) {
        // Recalculate paid amount and balance by removing this receipt
        const currentPaidAmount = parseFloat(voucher.paid_amount);
        const newPaidAmount = Math.max(0, currentPaidAmount - receiptAmount);
        const newBalanceAmount = parseFloat(voucher.TotalAmount) - newPaidAmount;
        const newStatus = newBalanceAmount <= 0.01 ? 'Paid' : (newPaidAmount > 0 ? 'Partial' : 'Pending');

        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE voucher SET 
              paid_amount = ?, 
              balance_amount = ?, 
              receipt_number = NULL,
              status = ?
             WHERE VoucherID = ?`,
            [
              newPaidAmount,
              newBalanceAmount,
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

      // Delete receipt voucher entries
      await new Promise((resolve, reject) => {
        connection.execute(
          'DELETE FROM voucher WHERE receipt_number = ? AND TransactionType = "Receipt"',
          [receiptNumber],
          (error) => {
            if (error) reject(error);
            else resolve();
          }
        );
      });
    }

    // Step 2: Reverse ledger entries and update balances
    const ledgerEntries = await new Promise((resolve, reject) => {
      connection.execute(
        'SELECT * FROM ledger WHERE voucherID = ? AND trantype = "Receipt"',
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results);
        }
      );
    });

    // Process each ledger entry and update subsequent balances
    for (const ledger of ledgerEntries) {
      const accountId = ledger.AccountID;
      const amount = parseFloat(ledger.Amount);
      const isCredit = ledger.DC === 'C';
      
      // Get subsequent entries for this account
      const subsequentEntries = await new Promise((resolve, reject) => {
        connection.execute(
          `SELECT * FROM ledger 
           WHERE AccountID = ? AND (created_at > ? OR (created_at = ? AND id > ?))
           ORDER BY created_at ASC, id ASC`,
          [
            accountId,
            ledger.created_at,
            ledger.created_at,
            ledger.id
          ],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      const balanceAdjustment = isCredit ? amount : -amount;

      // Update subsequent entries with adjusted balances
      let currentBalance = parseFloat(ledger.balance_amount);
      
      for (const subsequentEntry of subsequentEntries) {
        const entryAmount = parseFloat(subsequentEntry.Amount);
        const entryIsDebit = subsequentEntry.DC === 'D';
        
        // Recalculate balance for this entry
        if (entryIsDebit) {
          currentBalance += entryAmount;
        } else {
          currentBalance -= entryAmount;
        }

        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE ledger SET 
              balance_amount = ?
             WHERE id = ?`,
            [
              currentBalance,
              subsequentEntry.id
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });
      }
    }

    // Step 3: Delete ledger entries
    await new Promise((resolve, reject) => {
      connection.execute(
        'DELETE FROM ledger WHERE voucherID = ? AND trantype = "Receipt"',
        [req.params.id],
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });

    // Step 4: Delete the receipt from receipts table
    const deleteResult = await new Promise((resolve, reject) => {
      connection.execute(
        'DELETE FROM receipts WHERE id = ?',
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results);
        }
      );
    });

    if (deleteResult.affectedRows === 0) {
      throw new Error('Failed to delete receipt');
    }

    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({ 
      message: 'Receipt deleted successfully from all tables',
      deleted_receipt_id: req.params.id,
      receipt_number: receiptNumber
    });

  } catch (error) {
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }

    console.error('Error in delete receipt route:', error);
    res.status(500).json({ error: error.message || 'Failed to delete receipt' });
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