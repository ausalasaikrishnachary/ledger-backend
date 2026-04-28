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

// Get single voucher by ID
router.get('/jrroutes/:id', (req, res) => {
  db.query(
    `SELECT * FROM voucher WHERE VoucherID = ? AND TransactionType = 'Journal'`,
    [req.params.id],
    (err, rows) => {
      if (err) {
        console.error('Error fetching voucher:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Voucher not found' });
      }
      
      res.json({ success: true, data: rows[0] });
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

// Create new voucher (Journal Entry)
router.post('/journalcreate', (req, res) => {
  const {
    voucherNo,
    invoiceDate,
    partyName,
    partyId,        // Add this field
    balance_amount,
    totalAmount,
    transactionType = 'Journal'
  } = req.body;

  // Validate required fields
  if (!voucherNo || !invoiceDate || !partyName || !totalAmount) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: voucherNo, invoiceDate, partyName, totalAmount' 
    });
  }

  // Use partyId if provided, otherwise use accountId
  const finalPartyId = partyId || accountId || null;

  db.query(
    `INSERT INTO voucher (
      TransactionType, VchNo, Date, 
      PartyID, PartyName, balance_amount, TotalAmount, EntryDate, status, created_at
    ) VALUES (?, ?, ?, ?,  ?, ?, ?, NOW(), 'active', NOW())`,
    [
      transactionType,
      voucherNo,
      invoiceDate,
    
      finalPartyId,        // Store PartyID properly
      partyName,
      balance_amount || 0,
      totalAmount || 0
    ],
    (err, result) => {
      if (err) {
        console.error('Error creating voucher:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      
      res.json({
        success: true,
        message: 'Voucher created successfully',
        data: { VoucherID: result.insertId }
      });
    }
  );
});

// Update voucher
router.put('/journalupdate/:id', (req, res) => {
  const { id } = req.params;
  const {
    voucherNo,
    invoiceDate,
  
    partyName,
    partyId,        // Add this field
    balance_amount,
    totalAmount
  } = req.body;

  // Use partyId if provided, otherwise use accountId
  const finalPartyId = partyId || accountId || null;

  db.query(
    `UPDATE voucher SET
      VchNo = ?,
      Date = ?,
    
      PartyID = ?,
      PartyName = ?,
      balance_amount = ?,
      TotalAmount = ?,
      updated_at = NOW()
    WHERE VoucherID = ? AND TransactionType = 'Journal'`,
    [
      voucherNo,
      invoiceDate,
    
      finalPartyId,        // Update PartyID properly
      partyName,
      balance_amount || 0,
      totalAmount || 0,
      id
    ],
    (err, result) => {
      if (err) {
        console.error('Error updating voucher:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Voucher not found' });
      }
      
      res.json({
        success: true,
        message: 'Voucher updated successfully'
      });
    }
  );
});

// Delete voucher
router.delete('/journaldelete/:id', (req, res) => {
  db.query(
    `DELETE FROM voucher WHERE VoucherID = ? AND TransactionType = 'Journal'`,
    [req.params.id],
    (err, result) => {
      if (err) {
        console.error('Error deleting voucher:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Voucher not found' });
      }
      
      res.json({ success: true, message: 'Voucher deleted successfully' });
    }
  );
});

module.exports = router;