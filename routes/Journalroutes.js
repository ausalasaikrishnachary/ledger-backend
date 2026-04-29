const express = require('express');
const router = express.Router();
const db = require('./../db');




// Get all vouchers
router.get('/jrroutes', (req, res) => {
  db.query(
    `SELECT VoucherID, TransactionType, VchNo, Date, PartyName, PartyID, 
            AccountID, AccountName, TotalAmount, balance_amount, status, created_at 
     FROM voucher 
     WHERE TransactionType = 'Journal'
     ORDER BY VoucherID DESC`,
    (err, rows) => {
      if (err) {
        console.error('Error fetching vouchers:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      res.json({ success: true, data: rows });
    }
  );
});
router.get('/jrroutes/vchno/:vchNo', (req, res) => {
  const { vchNo } = req.params;

  db.query(
    `SELECT * FROM voucher WHERE VchNo = ? AND TransactionType = 'Journal' ORDER BY VoucherID ASC`,
    [vchNo],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Voucher not found' });
      }
      
      res.json({  
        success: true, 
        data: rows,
        voucherNo: vchNo
      });
    }
  );
});

// Get single voucher by ID - returns ONLY that specific row
router.get('/jrroutes/:id', (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT * FROM voucher WHERE VoucherID = ? AND TransactionType = 'Journal'`,
    [id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Voucher not found' });
      }
      
      // Return only the single row
      res.json({ 
        success: true, 
        data: rows[0]
      });
    }
  );
});

// Get last voucher number for Journal
router.get('/last-voucher/journal', (req, res) => {
  db.query(
    `SELECT VchNo FROM voucher 
     WHERE TransactionType = 'Journal' 
     ORDER BY VoucherID DESC LIMIT 1`,
    (err, rows) => {
      if (err) {
        console.error('Error fetching last voucher:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      
      let lastVoucherNo = null;
      if (rows.length > 0 && rows[0].VchNo) {
        lastVoucherNo = rows[0].VchNo;
      }
      
      res.json({ success: true, voucherNo: lastVoucherNo });
    }
  );
});

// Create journal voucher
router.post('/journalcreate', (req, res) => {
  const { journalItems = [] } = req.body;

  if (journalItems.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'At least one journal entry is required' 
    });
  }

  let inserted = 0;
  let errors = [];
  let insertedVchNo = null;

  journalItems.forEach((item) => {
    const {
      voucherNo,
      invoiceDate,
      partyId,
      partyName,
      balance_amount,
      amount,
      amount_type,
      transactionType = 'Journal'
    } = item;

    let newBalance = parseFloat(balance_amount || 0);
    const amt = parseFloat(amount || 0);
    
    if (amount_type === 'Dr') {
      newBalance += amt;
    } else {
      newBalance -= amt;
    }

    // Calculate DC value (first letter of amount_type: 'D' or 'C')
    const DC = amount_type === 'Dr' ? 'D' : 'C';

    db.query(
      `INSERT INTO voucher (
        TransactionType, VchNo, Date, PartyID, PartyName, 
        balance_amount, TotalAmount, amount_type, DC, EntryDate, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'active', NOW())`,
      [
        transactionType,
        voucherNo,
        invoiceDate,
        partyId || null,
        partyName,
        balance_amount || 0,
        amt,
        amount_type, // Store Dr or Cr
        DC          // Store D or C
      ],
      (err, result) => {
        if (err) {
          errors.push(err.message);
        } else {
          insertedVchNo = voucherNo;
        }
        inserted++;
        
        if (!err && partyId) {
          db.query(
            'UPDATE accounts SET balance = ?, updated_at = NOW() WHERE id = ?',
            [Math.abs(newBalance), partyId],
            (accErr) => {
              if (accErr) console.error('Account update error:', accErr);
            }
          );
        }
        
        if (inserted === journalItems.length) {
          if (errors.length > 0) {
            return res.status(500).json({ 
              success: false, 
              message: 'Some entries failed', 
              errors: errors 
            });
          }
          res.json({ 
            success: true, 
            message: `${inserted} journal entries created successfully`,
            voucherNo: insertedVchNo
          });
        }
      }
    );
  });
});

router.put('/journalupdatefull/:vchNo', (req, res) => {
  const { vchNo } = req.params;
  const { invoiceDate, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'At least one journal entry is required' 
    });
  }

  // Get all existing entries for this VchNo (TransactionType remains 'Journal')
  db.query(
    `SELECT VoucherID FROM voucher WHERE VchNo = ? AND TransactionType = 'Journal' ORDER BY VoucherID ASC`,
    [vchNo],
    (err, existingRows) => {
      if (err) {
        console.error('Error fetching existing entries:', err);
        return res.status(500).json({ success: false, message: err.message });
      }

      const existingIds = existingRows.map(row => row.VoucherID);
      let updated = 0;
      let errors = [];

      // Update existing entries (up to the number of existing rows)
      const updatePromises = [];
      
      for (let i = 0; i < Math.min(existingRows.length, items.length); i++) {
        const item = items[i];
        const existingId = existingRows[i].VoucherID;
        
        const {
          partyId,
          partyName,
          balance_amount,
          amount,
          amount_type
        } = item;

        let newBalance = parseFloat(balance_amount || 0);
        const amt = parseFloat(amount || 0);
        
        if (amount_type === 'Dr') {
          newBalance += amt;
        } else {
          newBalance -= amt;
        }

        const DC = amount_type === 'Dr' ? 'D' : 'C';

        updatePromises.push(new Promise((resolve, reject) => {
          db.query(
            `UPDATE voucher SET 
              Date = ?,
              PartyID = ?,
              PartyName = ?,
              balance_amount = ?,
              TotalAmount = ?,
              amount_type = ?,
              DC = ?,
              updated_at = NOW()
            WHERE VoucherID = ? AND VchNo = ? AND TransactionType = 'Journal'`,
            [
              invoiceDate,
              partyId || null,
              partyName,
              balance_amount || 0,
              amt,
              amount_type,  // This stores 'Dr' or 'Cr'
              DC,           // This stores 'D' or 'C'
              existingId,
              vchNo
            ],
            (err, result) => {
              if (err) {
                errors.push(`Error updating entry ${i + 1}: ${err.message}`);
                reject(err);
              } else {
                updated++;
                // Update account balance
                if (partyId) {
                  db.query(
                    'UPDATE accounts SET balance = ?, updated_at = NOW() WHERE id = ?',
                    [Math.abs(newBalance), partyId],
                    (accErr) => {
                      if (accErr) console.error('Account update error:', accErr);
                    }
                  );
                }
                resolve();
              }
            }
          );
        }));
      }

      // If we have more new items than existing, insert the extras
      if (items.length > existingRows.length) {
        for (let i = existingRows.length; i < items.length; i++) {
          const item = items[i];
          const {
            partyId,
            partyName,
            balance_amount,
            amount,
            amount_type
          } = item;

          let newBalance = parseFloat(balance_amount || 0);
          const amt = parseFloat(amount || 0);
          
          if (amount_type === 'Dr') {
            newBalance += amt;
          } else {
            newBalance -= amt;
          }

          const DC = amount_type === 'Dr' ? 'D' : 'C';

          updatePromises.push(new Promise((resolve, reject) => {
            db.query(
              `INSERT INTO voucher (
                TransactionType, VchNo, Date, PartyID, PartyName, 
                balance_amount, TotalAmount, amount_type, DC, 
                EntryDate, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'active', NOW())`,
              [
                'Journal',  // Keep TransactionType as 'Journal'
                vchNo,
                invoiceDate,
                partyId || null,
                partyName,
                balance_amount || 0,
                amt,
                amount_type,  // This stores 'Dr' or 'Cr'
                DC
              ],
              (err, result) => {
                if (err) {
                  errors.push(`Error inserting new entry ${i + 1}: ${err.message}`);
                  reject(err);
                } else {
                  updated++;
                  if (partyId) {
                    db.query(
                      'UPDATE accounts SET balance = ?, updated_at = NOW() WHERE id = ?',
                      [Math.abs(newBalance), partyId],
                      (accErr) => {
                        if (accErr) console.error('Account update error:', accErr);
                      }
                    );
                  }
                  resolve();
                }
              }
            );
          }));
        }
      }

      // If we have fewer new items than existing, delete the extras
      if (items.length < existingRows.length) {
        const idsToDelete = existingIds.slice(items.length);
        
        updatePromises.push(new Promise((resolve, reject) => {
          db.query(
            `DELETE FROM voucher WHERE VoucherID IN (?) AND VchNo = ? AND TransactionType = 'Journal'`,
            [idsToDelete, vchNo],
            (err, result) => {
              if (err) {
                errors.push(`Error deleting extra entries: ${err.message}`);
                reject(err);
              } else {
                resolve();
              }
            }
          );
        }));
      }

      // Wait for all operations to complete
      Promise.all(updatePromises)
        .then(() => {
          if (errors.length > 0) {
            return res.status(500).json({ 
              success: false, 
              message: 'Some operations failed', 
              errors: errors 
            });
          }
          res.json({ 
            success: true, 
            message: `${items.length} journal entries updated successfully`,
            note: 'TransactionType remains as Journal'
          });
        })
        .catch((error) => {
          res.status(500).json({ 
            success: false, 
            message: 'Error updating voucher', 
            error: error.message 
          });
        });
    }
  );
});
router.delete('/journaldelete/:id', (req, res) => {
  // First get the VchNo
  db.query(
    `SELECT VchNo FROM voucher WHERE VoucherID = ?`,
    [req.params.id],
    (err, rows) => {
      if (err) {
        console.error('Error fetching voucher:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Voucher not found' });
      }
      
      const vchNo = rows[0].VchNo;
      
      // Delete all entries with same VchNo
      db.query(
        `DELETE FROM voucher WHERE VchNo = ?`,
        [vchNo],
        (err, result) => {
          if (err) {
            console.error('Error deleting voucher:', err);
            return res.status(500).json({ success: false, message: err.message });
          }
          
          res.json({ success: true, message: 'Voucher deleted successfully' });
        }
      );
    }
  );
});

module.exports = router;