const express = require("express");
const router = express.Router();
const db = require("../db"); // your db connection

// 🧮 Generate Next Credit Note Number
router.get("/next-creditnote-number", (req, res) => {
  const query = "SELECT creditnote_number FROM creditnote ORDER BY id DESC LIMIT 1";

  db.query(query, (err, result) => {
    if (err) return res.status(500).send(err);

    let nextNumber = "CNOTE0001";
    if (result.length > 0) {
      const lastNumber = result[0].creditnote_number;
      const num = parseInt(lastNumber.replace("CNOTE", "")) + 1;
      nextNumber = `CNOTE${num.toString().padStart(4, "0")}`;
    }

    res.json({ nextCreditNoteNumber: nextNumber });
  });
});

router.get("/invoice-details/:invoiceNumber", async (req, res) => {
  const { invoiceNumber } = req.params;
  
  try {
    // First query: Get invoice details
    const invoiceQuery = `
      SELECT 
        v.VoucherID, 
        v.InvoiceNumber, 
        v.PartyID, 
        v.product_id,  
        v.batch_id,   
        p.goods_name as product_name,
        a.* 
      FROM voucher v
      JOIN accounts a ON v.PartyID = a.id
      LEFT JOIN products p ON v.product_id = p.id
      WHERE v.InvoiceNumber = ?
    `;
    
    const [invoiceResult] = await db.promise().query(invoiceQuery, [invoiceNumber]);
    
    if (invoiceResult.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    
    const invoiceData = invoiceResult[0];
    
    // Second query: Get all batches for the product_id
    const batchesQuery = `
      SELECT * FROM batches 
      WHERE product_id = ?
    `;
    
    const [batchesResult] = await db.promise().query(batchesQuery, [invoiceData.product_id]);
    
    // Add batches to the response
    invoiceData.all_batches = batchesResult;
    
    res.json(invoiceData);
    
  } catch (err) {
    console.error("Error fetching invoice details:", err);
    return res.status(500).send(err);
  }
});

router.get("/credit-notesales", (req, res) => { // added leading slash
  const query = `
    SELECT VoucherID, InvoiceNumber 
    FROM voucher 
    WHERE TransactionType = 'Sales'
  `;
  db.query(query, (err, result) => {
    if (err) {
      console.error("Error fetching invoices:", err);
      return res.status(500).send(err);
    }
    res.json(result);
  });
});



module.exports = router;
