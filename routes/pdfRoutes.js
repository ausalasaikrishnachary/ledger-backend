const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Store PDF in voucher table and file system - COMPLETELY FIXED VERSION
router.post("/store-pdf", async (req, res) => {
  try {
    const { invoiceNumber, invoiceDate, totalAmount, pdfData, fileName } = req.body;
    
    if (!invoiceNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invoice number is required' 
      });
    }

    console.log('🔍 Storing PDF for specific invoice:', invoiceNumber);

    // Save PDF to file system
    let filePath = null;
    let finalFileName = null;
    
    if (pdfData) {
      // Extract base64 data
      const base64Data = pdfData.replace(/^data:application\/pdf;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Create unique filename with invoice number and timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      finalFileName = `Invoice_${invoiceNumber}_${timestamp}.pdf`;
      filePath = path.join(uploadsDir, finalFileName);
      
      // Write file
      fs.writeFileSync(filePath, buffer);
      console.log('✅ PDF saved to:', filePath);
    }

    // FIRST: Find the EXACT voucher record for this invoice number
    const findQuery = `
      SELECT VoucherID, InvoiceNumber, VchNo, pdf_data, pdf_file_name 
      FROM voucher 
      WHERE InvoiceNumber = ? 
      ORDER BY VoucherID DESC 
      LIMIT 1
    `;
    
    db.query(findQuery, [invoiceNumber], (findErr, findResults) => {
      if (findErr) {
        console.error('❌ Error finding invoice:', findErr);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error finding invoice' 
        });
      }

      if (findResults.length === 0) {
        console.warn('⚠️ No voucher found with exact InvoiceNumber:', invoiceNumber);
        
        // Try alternative search with VchNo
        const altFindQuery = `
          SELECT VoucherID, InvoiceNumber, VchNo, pdf_data, pdf_file_name 
          FROM voucher 
          WHERE VchNo = ? 
          ORDER BY VoucherID DESC 
          LIMIT 1
        `;
        
        db.query(altFindQuery, [invoiceNumber], (altFindErr, altFindResults) => {
          if (altFindErr) {
            console.error('❌ Error in alternative find:', altFindErr);
            return res.status(500).json({ 
              success: false, 
              message: 'Database error finding invoice' 
            });
          }
          
          if (altFindResults.length === 0) {
            console.error('❌ Invoice not found with InvoiceNumber or VchNo:', invoiceNumber);
            return res.status(404).json({
              success: false,
              message: 'Invoice not found: ' + invoiceNumber
            });
          }
          
          // Found with VchNo, update that specific record
          updateVoucherPDF(altFindResults[0].VoucherID, filePath, finalFileName, invoiceNumber, true);
        });
        return;
      }

      // Found with InvoiceNumber, update that specific record
      const voucher = findResults[0];
      updateVoucherPDF(voucher.VoucherID, filePath, finalFileName, invoiceNumber, false);
    });

    // Helper function to update specific voucher
    function updateVoucherPDF(voucherId, filePath, fileName, invoiceNumber, usedVchNo = false) {
      console.log(`🔄 Updating PDF for VoucherID: ${voucherId}, Invoice: ${invoiceNumber}`);
      
      // First, delete old PDF file if it exists for THIS voucher
      const checkOldQuery = `SELECT pdf_data FROM voucher WHERE VoucherID = ?`;
      
      db.query(checkOldQuery, [voucherId], (checkErr, checkResults) => {
        if (checkErr) {
          console.error('❌ Error checking old PDF:', checkErr);
        } else if (checkResults.length > 0 && checkResults[0].pdf_data) {
          const oldFilePath = checkResults[0].pdf_data;
          if (oldFilePath && fs.existsSync(oldFilePath)) {
            try {
              fs.unlinkSync(oldFilePath);
              console.log('🗑️ Deleted old PDF file:', oldFilePath);
            } catch (deleteErr) {
              console.error('❌ Error deleting old PDF file:', deleteErr);
            }
          }
        }

        // Update ONLY the specific voucher record
        const updateQuery = `
          UPDATE voucher 
          SET pdf_data = ?, 
              pdf_file_name = ?,
              pdf_created_at = NOW()
          WHERE VoucherID = ?
        `;
        
        console.log(`📝 Executing update for VoucherID: ${voucherId}`, { filePath, fileName });
        
        db.query(updateQuery, [filePath, fileName, voucherId], (updateErr, updateResult) => {
          if (updateErr) {
            console.error('❌ Error updating voucher with PDF:', updateErr);
            return res.status(500).json({ 
              success: false, 
              message: 'Failed to store PDF in database: ' + updateErr.message 
            });
          }

          if (updateResult.affectedRows === 0) {
            console.error('❌ No rows affected for VoucherID:', voucherId);
            return res.status(404).json({
              success: false,
              message: 'Failed to update voucher: ' + voucherId
            });
          }

          console.log('✅ PDF stored successfully!', {
            voucherId,
            invoiceNumber,
            filePath,
            fileName,
            affectedRows: updateResult.affectedRows,
            usedVchNo
          });
          
          res.json({
            success: true,
            message: 'PDF stored successfully',
            data: {
              voucherId,
              invoiceNumber,
              filePath,
              fileName,
              usedVchNo
            }
          });
        });
      });
    }

  } catch (error) {
    console.error('❌ Error storing PDF:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to store PDF',
      error: error.message 
    });
  }
});

// Get invoices with PDF info - Enhanced with better data
// Get invoices with PDF info - FIXED VERSION
router.get("/invoices-with-pdf", (req, res) => {
  const query = `
    SELECT 
      VoucherID,
      TransactionType,
      InvoiceNumber,
      VchNo,
      Date,
      PartyName,
      AccountName,
      TotalAmount,
      pdf_data,
      pdf_file_name,
      pdf_created_at,
      BasicAmount,
      TaxAmount,
      CGSTAmount,
      SGSTAmount,
      IGSTAmount,
      CGSTPercentage,
      SGSTPercentage,
      IGSTPercentage,
      BatchDetails
    FROM voucher 
    WHERE TransactionType = 'Sales'
    ORDER BY VoucherID DESC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching invoices with PDF:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error' 
      });
    }
    
    // Parse batch details for each invoice
    const invoices = results.map(invoice => {
      try {
        if (invoice.BatchDetails && typeof invoice.BatchDetails === 'string') {
          invoice.batch_details = JSON.parse(invoice.BatchDetails);
        } else {
          invoice.batch_details = invoice.BatchDetails || [];
        }
      } catch (error) {
        console.error('Error parsing batch details:', error);
        invoice.batch_details = [];
      }
      
      // Check if PDF actually belongs to this invoice
      const hasValidPDF = invoice.pdf_data && invoice.pdf_file_name;
      let pdfStatus = 'No PDF';
      
      if (hasValidPDF) {
        // Check if PDF filename matches this invoice number
        const pdfFileName = invoice.pdf_file_name;
        const invoiceNum = invoice.InvoiceNumber;
        
        if (pdfFileName.includes(invoiceNum)) {
          pdfStatus = 'Valid PDF';
        } else {
          pdfStatus = 'Mismatched PDF';
        }
      }
      
      return {
        ...invoice,
        hasPDF: hasValidPDF,
        pdfStatus: pdfStatus
      };
    });
    
    res.json({
      success: true,
      data: invoices
    });
  });
});

// Get PDF by invoice number - Fixed to use correct identifiers
// Get PDF by invoice number - FIXED VERSION
router.get("/get-pdf/:invoiceNumber", (req, res) => {
  const { invoiceNumber } = req.params;
  
  console.log('🔍 Fetching PDF for invoice:', invoiceNumber);
  
  // FIRST try with exact InvoiceNumber match
  const query = `
    SELECT VoucherID, pdf_data, pdf_file_name, InvoiceNumber, VchNo
    FROM voucher 
    WHERE InvoiceNumber = ?
    ORDER BY VoucherID DESC
    LIMIT 1
  `;
  
  db.query(query, [invoiceNumber], (err, results) => {
    if (err) {
      console.error('❌ Error fetching PDF:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error' 
      });
    }
    
    if (results.length === 0 || !results[0].pdf_data) {
      // Try alternative search with VchNo
      console.log('⚠️ Not found with InvoiceNumber, trying VchNo:', invoiceNumber);
      const alternativeQuery = `
        SELECT VoucherID, pdf_data, pdf_file_name, InvoiceNumber, VchNo
        FROM voucher 
        WHERE VchNo = ?
        ORDER BY VoucherID DESC
        LIMIT 1
      `;
      
      db.query(alternativeQuery, [invoiceNumber], (altErr, altResults) => {
        if (altErr) {
          console.error('❌ Error in alternative PDF fetch:', altErr);
          return res.status(500).json({ 
            success: false, 
            message: 'Database error' 
          });
        }
        
        if (altResults.length === 0 || !altResults[0].pdf_data) {
          console.log('❌ PDF not found for invoice:', invoiceNumber);
          return res.status(404).json({ 
            success: false, 
            message: 'PDF not found for this invoice' 
          });
        }
        
        sendPDFFile(altResults[0], res);
      });
      return;
    }
    
    sendPDFFile(results[0], res);
  });
});

// Helper function to send PDF file
function sendPDFFile(pdfRecord, res) {
  const { VoucherID, pdf_data, pdf_file_name, InvoiceNumber, VchNo } = pdfRecord;
  
  console.log('✅ Found PDF file:', {
    VoucherID,
    InvoiceNumber,
    VchNo,
    file: pdf_data
  });
  
  // Check if file exists
  if (!fs.existsSync(pdf_data)) {
    console.log('❌ PDF file not found on server:', pdf_data);
    return res.status(404).json({ 
      success: false, 
      message: 'PDF file not found on server' 
    });
  }
  
  // Send file
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdf_file_name}"`);
  
  const fileStream = fs.createReadStream(pdf_data);
  fileStream.pipe(res);
  
  fileStream.on('error', (error) => {
    console.error('❌ Error streaming PDF file:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error streaming PDF file' 
    });
  });
  
  fileStream.on('end', () => {
    console.log('✅ PDF sent successfully for VoucherID:', VoucherID);
  });
}

// Get PDF info without downloading
router.get("/pdf-info/:invoiceNumber", (req, res) => {
  const { invoiceNumber } = req.params;
  
  const query = `
    SELECT pdf_data, pdf_file_name, InvoiceNumber, VchNo, VoucherID, pdf_created_at
    FROM voucher 
    WHERE InvoiceNumber = ? OR VchNo = ?
  `;
  
  db.query(query, [invoiceNumber, invoiceNumber], (err, results) => {
    if (err) {
      console.error('Error fetching PDF info:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error' 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invoice not found' 
      });
    }
    
    const invoice = results[0];
    
    res.json({
      success: true,
      data: {
        voucherId: invoice.VoucherID,
        invoiceNumber: invoice.InvoiceNumber || invoice.VchNo,
        pdfPath: invoice.pdf_data,
        pdfFileName: invoice.pdf_file_name,
        pdfCreatedAt: invoice.pdf_created_at,
        hasPDF: !!invoice.pdf_data && !!invoice.pdf_file_name,
        fileExists: invoice.pdf_data ? fs.existsSync(invoice.pdf_data) : false
      }
    });
  });
});

module.exports = router;