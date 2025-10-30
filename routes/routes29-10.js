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
module.exports = router;