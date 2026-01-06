const express = require('express');
const router = express.Router();
const db = require('../db');

// ------------------------------
router.get('/next-purchase-voucher-number', async (req, res) => {
  try {
    db.execute(
      'SELECT voucher_number FROM purchase_vouchers ORDER BY voucher_number DESC LIMIT 1',
      (error, results) => {
        if (error) {
          console.error('Database error fetching next purchase voucher number:', error);
          return res.status(500).json({ error: 'Failed to fetch next purchase voucher number' });
        }

        let nextVoucherNumber = 'PV001';  
        if (results && results.length > 0) {
          const lastNumber = results[0].voucher_number;
          const match = lastNumber.match(/PV(\d+)/);  
          if (match) {
            const nextNum = parseInt(match[1], 10) + 1;
            nextVoucherNumber = `PV${nextNum.toString().padStart(3, '0')}`;
          }
        }

        res.json({ nextVoucherNumber });
      }
    );
  } catch (error) {
    console.error('Error in next purchase voucher number route:', error);
    res.status(500).json({ error: 'Failed to fetch next purchase voucher number' });
  }
});

router.post('/purchase-vouchers', async (req, res) => {
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
      voucher_number,
      supplier_name,
      amount,
      currency,
      payment_method,
      voucher_date,
      note,
      bank_name,
      transaction_date,
      reconciliation_option,
      invoice_number
    } = req.body;

    if (!voucher_number || !voucher_number.match(/^PV\d+$/)) {
      throw new Error('Invalid voucher number format');
    }

    // Check if voucher number already exists
    const existingVoucher = await new Promise((resolve, reject) => {
      connection.execute(
        `SELECT voucher_number FROM purchase_vouchers WHERE voucher_number = ?`,
        [voucher_number],
        (err, results) => {
          if (err) reject(err);
          else resolve(results[0]);
        }
      );
    });

    if (existingVoucher) {
      throw new Error(`Purchase voucher number ${voucher_number} already exists`);
    }

    const voucherAmount = parseFloat(amount || 0);

    // Insert into purchase_vouchers table
    const voucherResult = await new Promise((resolve, reject) => {
      connection.execute(
        `INSERT INTO purchase_vouchers (
          voucher_number, amount, currency, payment_method,
          voucher_date, note, bank_name, transaction_date, reconciliation_option
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          voucher_number,
          voucherAmount,
          currency || 'INR',
          payment_method || 'Direct Deposit',
          voucher_date || new Date(),
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

    const voucherId = voucherResult.insertId; 
    console.log('Purchase voucher inserted with ID:', voucherId);

    const cashBankAccountID = 1; 
    const cashBankAccountName = bank_name ? `${bank_name} Bank` : 'Cash Account';

    // LEDGER ENTRY 1: Cash/Bank Account (Credit - Money going out)
    const cashBankBalance = await new Promise((resolve, reject) => {
      connection.execute(
        `SELECT balance_amount FROM ledger WHERE AccountID = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        [cashBankAccountID],
        (err, results) => {
          if (err) reject(err);
          else resolve(results.length > 0 ? parseFloat(results[0].balance_amount) : 0);
        }
      );
    });

    const newCashBankBalance = cashBankBalance - voucherAmount; // Decrease cash/bank balance

    // Insert Credit entry for Cash/Bank (Money going out)
    await new Promise((resolve, reject) => {
      connection.execute(
        `INSERT INTO ledger (
          voucherID, date, trantype, AccountID, AccountName, 
          Amount, balance_amount, DC, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          voucherId,
          voucher_date || new Date(),
          'Voucher', // Changed to 'Voucher'
          cashBankAccountID,
          cashBankAccountName,
          voucherAmount,
          newCashBankBalance,
          'C', // Credit for cash/bank (money going out)
          new Date()
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log('Cash/Bank ledger entry created with voucherID:', voucherId);

    // Step 2: Update voucher table for purchase voucher application
    let voucherQuery = `SELECT * FROM voucher WHERE TransactionType='Purchase'`;
    const queryParams = [];

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
      let remainingAmount = voucherAmount;
      const currentDate = new Date();

      for (const voucher of vouchers) {
        if (remainingAmount <= 0) break;

        const totalAmount = parseFloat(voucher.TotalAmount || 0);
        const alreadyPaid = parseFloat(voucher.paid_amount || 0);
        const currentBalance = parseFloat(voucher.balance_amount || 0);
        
        console.log(`Processing voucher ${voucher.InvoiceNumber}: Total=${totalAmount}, Already Paid=${alreadyPaid}, Current Balance=${currentBalance}`);

        let pendingAmount;
        if (currentBalance === 0 && totalAmount > 0) {
          pendingAmount = totalAmount;
        } else {
          pendingAmount = currentBalance;
        }

        if (pendingAmount <= 0) continue;

        const amountToApply = Math.min(remainingAmount, pendingAmount);
        remainingAmount -= amountToApply;
        
        const newPaidAmount = alreadyPaid + amountToApply;
        
        let totalAmountForNewRow;
        if (alreadyPaid === 0) {
          totalAmountForNewRow = totalAmount;
        } else {
          totalAmountForNewRow = currentBalance;
        }
        
        const newBalanceAmount = totalAmountForNewRow + amountToApply;
        const newStatus = newBalanceAmount <= 0.01 ? 'Paid' : 'Partial';

        // Update the original purchase voucher
        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE voucher SET 
              paid_amount = ?,
              balance_amount = ?,
              status = ?,
              paid_date = ?
            WHERE VoucherID = ?`,
            [
              newPaidAmount,
              newBalanceAmount,
              newStatus,
              currentDate,
              voucher.VoucherID
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        console.log(`Updated purchase voucher ${voucher.InvoiceNumber}: Total=${totalAmountForNewRow}, Paid=${newPaidAmount}, Balance=${newBalanceAmount}`);

        // Create voucher entry with TransactionType as 'Voucher'
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
              'Voucher', // Changed from 'Purchase Voucher Payment' to 'Voucher'
              voucher_number,
              voucher.InvoiceNumber,
              currentDate,
              voucher.PaymentTerms || 'Immediate',
              voucher.Freight || 0.00,
              voucher.TotalQty || 0.00,
              voucher.TotalPacks || 0,
              voucher.TotalQty1 || 0,
              voucher.TaxAmount || 0.00,
              amountToApply,
              voucher.BillSundryAmount || 0.00,
              totalAmountForNewRow,
              voucher.ChequeNo || null,
              voucher.ChequeDate || null,
              bank_name || voucher.BankName || '',
              voucher.AccountID,
              voucher.AccountName,
              voucher.PartyID,
              supplier_name || voucher.PartyName,
              amountToApply,
              amountToApply,
              currentDate,
              voucher.SGSTPercentage || 0.00,
              voucher.CGSTPercentage || 0.00,
              voucher.IGSTPercentage || 0.00,
              voucher.SGSTAmount || 0.00,
              voucher.CGSTAmount || 0.00,
              voucher.IGSTAmount || 0.00,
              voucher.TaxSystem || 'GST',
              voucher.BatchDetails || '[]',
              amountToApply,
              newBalanceAmount,
              voucher_number,
              newStatus,
              currentDate
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        console.log(`Voucher entry created: ${totalAmountForNewRow} + ${amountToApply} = ${newBalanceAmount}`);
      }

      // If leftover amount, create advance payment row
      if (remainingAmount > 0) {
        const latestVoucher = vouchers[vouchers.length - 1];
        const latestBalance = parseFloat(latestVoucher.balance_amount || 0);
        
        const advanceTotalAmount = latestBalance > 0 ? latestBalance : remainingAmount;
        const advancePaidAmount = remainingAmount;
        const advanceBalanceAmount = advanceTotalAmount + advancePaidAmount;
        
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
              'Voucher', // Changed from 'Purchase Voucher Payment' to 'Voucher'
              voucher_number,
              `ADV-${voucher_number}`,
              currentDate,
              'Immediate',
              0.00,
              0.00,
              0,
              0,
              0.00,
              remainingAmount,
              0.00,
              advanceTotalAmount,
              null,
              null,
              bank_name || '',
              3,
              'Sundry Creditors',
              null,
              supplier_name || 'Supplier',
              remainingAmount,
              remainingAmount,
              currentDate,
              0.00,
              0.00,
              0.00,
              0.00,
              0.00,
              0.00,
              'GST',
              '[]',
              advancePaidAmount,
              advanceBalanceAmount,
              voucher_number,
              'Advance',
              currentDate
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        console.log(`Advance payment created: ${advanceTotalAmount} + ${advancePaidAmount} = ${advanceBalanceAmount}`);
      }
    } else {
      // No purchase vouchers found: simple payment entry (advance payment)
      const advanceTotalAmount = voucherAmount;
      const advancePaidAmount = voucherAmount;
      const advanceBalanceAmount = advanceTotalAmount + advancePaidAmount;
      
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
            'Voucher', // Changed from 'Purchase Voucher Payment' to 'Voucher'
            voucher_number,
            `ADV-${voucher_number}`,
            new Date(),
            'Immediate',
            0.00,
            0.00,
            0,
            0,
            0.00,
            voucherAmount,
            0.00,
            advanceTotalAmount,
            null,
            null,
            bank_name || '',
            3,
            'Sundry Creditors',
            null,
            supplier_name || 'Supplier',
            voucherAmount,
            voucherAmount,
            new Date(),
            0.00,
            0.00,
            0.00,
            0.00,
            0.00,
            0.00,
            'GST',
            '[]',
            advancePaidAmount,
            advanceBalanceAmount,
            voucher_number,
            'Advance',
            new Date()
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      console.log(`Advance payment voucher created: ${advanceTotalAmount} + ${advancePaidAmount} = ${advanceBalanceAmount}`);
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
      id: voucherId,
      message: 'Purchase voucher created and applied to invoices successfully',
      voucher_number,
      amount: voucherAmount,
      applied_to_invoices: vouchers ? vouchers.length : 0
    };

    res.status(201).json(response);

  } catch (error) {
    if (connection) {
      await new Promise(resolve => connection.rollback(() => resolve()));
    }
    console.error('Error in create purchase voucher route:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'VoucherID must be AUTO_INCREMENT in voucher table' });
    }
    res.status(500).json({ error: error.message || 'Failed to create purchase voucher' });
  } finally {
    if (connection) connection.release();
  }
});
// ------------------------------
// Get purchase voucher with invoice details
// ------------------------------
router.get('/purchase-vouchers-with-invoices', async (req, res) => {
  try {
    const query = `
      SELECT 
        pv.*,
        a.business_name,
        a.name as account_name,
        GROUP_CONCAT(DISTINCT pi.InvoiceNumber) as related_invoices,
        SUM(pi.TotalAmount) as total_invoice_amount,
        SUM(pi.paid_amount) as total_paid_amount,
        SUM(pi.balance_amount) as total_balance_amount
      FROM purchase_vouchers pv
      LEFT JOIN accounts a ON pv.supplier_id = a.id
      LEFT JOIN purchase_invoice pi ON pv.supplier_id = pi.SupplierID AND FIND_IN_SET(pv.voucher_number, pi.voucher_number)
      GROUP BY pv.id
      ORDER BY pv.created_at DESC
    `;

    db.execute(query, (error, results) => {
      if (error) {
        console.error('Database error fetching purchase vouchers with invoices:', error);
        return res.status(500).json({ error: 'Failed to fetch purchase vouchers' });
      }

      res.json(results || []);
    });
  } catch (error) {
    console.error('Error in purchase vouchers with invoices route:', error);
    res.status(500).json({ error: 'Failed to fetch purchase vouchers' });
  }
});

// ------------------------------
// Get last purchase voucher (fallback)
// ------------------------------
router.get('/last-purchase-voucher', async (req, res) => {
  try {
    db.execute(
      'SELECT voucher_number FROM purchase_vouchers ORDER BY id DESC LIMIT 1',
      (error, results) => {
        if (error) {
          console.error('Database error fetching last purchase voucher:', error);
          return res.status(500).json({ error: 'Failed to fetch last purchase voucher' });
        }

        if (results && results.length > 0) {
          res.json({ lastVoucherNumber: results[0].voucher_number });
        } else {
          res.json({ lastVoucherNumber: null });
        }
      }
    );
  } catch (error) {
    console.error('Error in last purchase voucher route:', error);
    res.status(500).json({ error: 'Failed to fetch last purchase voucher' });
  }
});

// ------------------------------
// Get all purchase vouchers
// ------------------------------
router.get('/purchase-vouchers', async (req, res) => {
  try {
    db.execute(
      `SELECT pv.*, a.business_name, a.name as payee_name 
       FROM purchase_vouchers pv 
       LEFT JOIN accounts a ON pv.supplier_id = a.id 
       ORDER BY pv.created_at DESC`,
      (error, results) => {
        if (error) {
          console.error('Database error fetching purchase vouchers:', error);
          return res.status(500).json({ error: 'Failed to fetch purchase vouchers' });
        }

        res.json(results || []);
      }
    );
  } catch (error) {
    console.error('Error in purchase vouchers route:', error);
    res.status(500).json({ error: 'Failed to fetch purchase vouchers' });
  }
});

// ------------------------------
// Get purchase voucher by ID
// ------------------------------
router.get('/purchase-vouchers/:id', async (req, res) => {
  try {
    db.execute(
      `SELECT pv.*, a.business_name, a.name as payee_name 
       FROM purchase_vouchers pv 
       LEFT JOIN accounts a ON pv.supplier_id = a.id 
       WHERE pv.id = ?`,
      [req.params.id],
      (error, results) => {
        if (error) {
          console.error('Database error fetching purchase voucher:', error);
          return res.status(500).json({ error: 'Failed to fetch purchase voucher' });
        }

        if (!results || results.length === 0) {
          return res.status(404).json({ error: 'Purchase voucher not found' });
        }

        res.json(results[0]);
      }
    );
  } catch (error) {
    console.error('Error in purchase voucher by ID route:', error);
    res.status(500).json({ error: 'Failed to fetch purchase voucher' });
  }
});

// ------------------------------
// Update purchase voucher by ID
// ------------------------------
router.put('/purchase-vouchers/:id', async (req, res) => {
  try {
    const {
      supplier_id,
      amount,
      currency,
      payment_method,
      voucher_date,
      note,
      bank_name,
      transaction_date,
      reconciliation_option,
    } = req.body;

    db.execute(
      `UPDATE purchase_vouchers SET 
        supplier_id = ?, amount = ?, currency = ?, payment_method = ?,
        voucher_date = ?, note = ?, bank_name = ?, transaction_date = ?,
        reconciliation_option = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        supplier_id,
        amount,
        currency,
        payment_method,
        voucher_date,
        note,
        bank_name,
        transaction_date,
        reconciliation_option,
        req.params.id
      ],
      (error, results) => {
        if (error) {
          console.error('Database error updating purchase voucher:', error);
          return res.status(500).json({ error: 'Failed to update purchase voucher' });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Purchase voucher not found' });
        }

        res.json({ message: 'Purchase voucher updated successfully' });
      }
    );
  } catch (error) {
    console.error('Error in update purchase voucher route:', error);
    res.status(500).json({ error: 'Failed to update purchase voucher' });
  }
});

// ------------------------------
// Delete purchase voucher by ID
// ------------------------------
router.delete('/purchase-vouchers/:id', async (req, res) => {
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

    // First get voucher details
    const voucher = await new Promise((resolve, reject) => {
      connection.execute(
        'SELECT voucher_number, supplier_id, amount FROM purchase_vouchers WHERE id = ?',
        [req.params.id],
        (error, results) => {
          if (error) reject(error);
          else resolve(results[0]);
        }
      );
    });

    if (!voucher) {
      return res.status(404).json({ error: 'Purchase voucher not found' });
    }

    // Step 1: Update purchase invoices to remove this voucher
    if (voucher.supplier_id) {
      const invoices = await new Promise((resolve, reject) => {
        connection.execute(
          'SELECT * FROM purchase_invoice WHERE SupplierID = ? AND FIND_IN_SET(?, voucher_number)',
          [voucher.supplier_id, voucher.voucher_number],
          (error, results) => {
            if (error) reject(error);
            else resolve(results);
          }
        );
      });

      for (const invoice of invoices) {
        // Remove this voucher number from invoice
        const currentVoucherNumbers = invoice.voucher_number.split(', ').filter(vn => vn !== voucher.voucher_number);
        const newVoucherNumber = currentVoucherNumbers.join(', ') || null;
        
        // Recalculate paid amount and balance
        const voucherAmount = parseFloat(voucher.amount);
        const newPaidAmount = Math.max(0, parseFloat(invoice.paid_amount) - voucherAmount);
        const newBalanceAmount = parseFloat(invoice.TotalAmount) - newPaidAmount;
        const newStatus = newBalanceAmount <= 0 ? 'Paid' : (newPaidAmount > 0 ? 'Partial' : 'Pending');

        await new Promise((resolve, reject) => {
          connection.execute(
            `UPDATE purchase_invoice SET 
              paid_amount = ?, 
              balance_amount = ?, 
              voucher_number = ?,
              status = ?
             WHERE InvoiceID = ?`,
            [
              newPaidAmount,
              newBalanceAmount,
              newVoucherNumber,
              newStatus,
              invoice.InvoiceID
            ],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });
      }
    }

    // Step 2: Delete the purchase voucher
    await new Promise((resolve, reject) => {
      connection.execute(
        'DELETE FROM purchase_vouchers WHERE id = ?',
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

    res.json({ message: 'Purchase voucher deleted successfully' });

  } catch (error) {
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }

    console.error('Error in delete purchase voucher route:', error);
    res.status(500).json({ error: 'Failed to delete purchase voucher' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});



    router.get('/invoice/:invoiceNumber', async (req, res) => {
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
          TransactionType,
          VchNo,
          InvoiceNumber,
          Date,
          PaymentTerms,
          Freight,
          TotalQty,
          TotalPacks,
          TotalQty1,
          TaxAmount,
          Subtotal,
          BillSundryAmount,
          TotalAmount,
          ChequeNo,
          ChequeDate,
          BankName,
          AccountID,
          AccountName,
          PartyID,
          PartyName,
          BasicAmount,
          ValueOfGoods,
          EntryDate,
          SGSTPercentage,
          CGSTPercentage,
          IGSTPercentage,
          SGSTAmount,
          CGSTAmount,
          IGSTAmount,
          TaxSystem,
          BatchDetails,
          paid_amount,
          balance_amount,
          receipt_number,
          status,
          paid_date,
          created_at
        FROM voucher 
        WHERE InvoiceNumber = ?
        ORDER BY 
          CASE WHEN TransactionType = 'Voucher' THEN 1 ELSE 2 END,
          created_at ASC
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
      
      // Separate sales and receipt entries
      const salesEntry = results.find(item => item.TransactionType === 'Sales');
      const receiptEntries = results.filter(item => item.TransactionType === 'Receipt');
      
      res.json({
        success: true,
        data: {
          sales: salesEntry,
          receipts: receiptEntries,
          allEntries: results
        }
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

// GET /api/sales-receipt-totals
router.get('/sales-receipt-totals', (req, res) => {
  const sqlQuery = `
    SELECT 
      COALESCE(SUM(CASE WHEN TransactionType = 'Sales' THEN TotalAmount ELSE 0 END), 0) as totalSales,
      COALESCE(SUM(CASE WHEN TransactionType = 'Receipt' THEN paid_amount ELSE 0 END), 0) as totalReceipts,
      COALESCE(SUM(CASE WHEN TransactionType = 'CreditNote' THEN TotalAmount ELSE 0 END), 0) as totalCreditNote
    FROM voucher 
    WHERE TransactionType IN ('Sales', 'Receipt', 'CreditNote')
  `;

  db.query(sqlQuery, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch sales and receipt totals',
        details: err.message
      });
    }

    const totalSales = parseFloat(results[0].totalSales) || 0;
    const totalReceipts = parseFloat(results[0].totalReceipts) || 0;
    const totalCreditNote = parseFloat(results[0].totalCreditNote) || 0;

    res.json({
      success: true,
      data: {
        totalSales: totalSales,
        totalReceipts: totalReceipts,
        totalCreditNote: totalCreditNote,
        netAmount: totalSales - totalReceipts - totalCreditNote
      }
    });
  });
});

router.get('/total-payables', (req, res) => {
  const sqlQuery = `
    SELECT 
      COALESCE(SUM(CASE WHEN TransactionType = 'Purchase' THEN TotalAmount ELSE 0 END), 0) as totalPurchase,
      COALESCE(SUM(CASE WHEN TransactionType = 'purchase voucher' THEN paid_amount ELSE 0 END), 0) as totalPurchaseVoucher,
      COALESCE(SUM(CASE WHEN TransactionType = 'DebitNote' THEN TotalAmount ELSE 0 END), 0) as totalDebitNote
    FROM voucher 
    WHERE TransactionType IN ('Purchase', 'purchase voucher', 'DebitNote')
  `;

  db.query(sqlQuery, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch Purchase and purchase voucher totals',
        details: err.message
      });
    }

    const totalPurchase = parseFloat(results[0].totalPurchase) || 0;
    const totalPurchaseVoucher = parseFloat(results[0].totalPurchaseVoucher) || 0;
    const totalDebitNote = parseFloat(results[0].totalDebitNote) || 0;
    
    // Net amount calculation: Purchase - (Purchase Voucher + DebitNote)
    const netAmount = totalPurchase - (totalPurchaseVoucher + totalDebitNote);

    res.json({
      success: true,
      data: {
        totalPurchase: totalPurchase,
        totalPurchaseVoucher: totalPurchaseVoucher,
        totalDebitNote: totalDebitNote,
        netAmount: netAmount
      }
    });
  });
});






// Single endpoint that accepts transaction type as query parameter
router.get('/vouchersnumber', (req, res) => {
  const transactionType = req.query.type; // Get type from query params
  
  let query;
  let queryParams = [];
  
  if (transactionType) {
    // If specific type is requested
    query = `
      SELECT VoucherID, TransactionType, VchNo 
      FROM voucher 
      WHERE TransactionType = ?
      ORDER BY VoucherID DESC
    `;
    queryParams = [transactionType];
  } else {
    query = `
      SELECT VoucherID, TransactionType, VchNo 
      FROM voucher 
      WHERE TransactionType IN ('Sales', 'stock transfer')
      ORDER BY VoucherID DESC
    `;
  }
  
  db.query(query, queryParams, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json(results);
  });
});
router.get('/purchasevouchersnumber', (req, res) => {
  const transactionType = req.query.type; // Get type from query params
  
  let query;
  let queryParams = [];
  
  if (transactionType) {
    // If specific type is requested
    query = `
      SELECT VoucherID, TransactionType, VchNo 
      FROM voucher 
      WHERE TransactionType = ?
      ORDER BY VoucherID DESC
    `;
    queryParams = [transactionType];
  } else {
    query = `
      SELECT VoucherID, TransactionType, VchNo 
      FROM voucher 
      WHERE TransactionType IN ('Purchase', 'stock inward')
      ORDER BY VoucherID DESC
    `;
  }
  
  db.query(query, queryParams, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json(results);
  });
});


module.exports = router;