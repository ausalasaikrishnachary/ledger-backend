const express = require("express");
const router = express.Router();
const db = require("../db");
const excelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// Helper function to format date as DD/MM/YYYY
function formatDateToDDMMYYYY(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Helper function to convert DD/MM/YYYY to YYYY-MM-DD for SQL
function formatDateToYYYYMMDD(dateString) {
  if (!dateString) return '';
  const parts = dateString.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateString;
}

// ----------------------
// GET Retailer Report with Date Filtering
// ----------------------
router.get("/retailer-report", (req, res) => {
  const { fromDate, toDate } = req.query;
  
  let sql = `
    SELECT 
      id,
      name,
      mobile_number,
      email,
      gstin,
      gst_registered_name,
      business_name,
      display_name,
      created_at,
      staffid,
      assigned_staff,
      billing_state
    FROM accounts
    WHERE \`group\` = 'Retailer'
  `;
  
  const params = [];
  
  // Add date filtering if provided
  if (fromDate && toDate) {
    const fromDateFormatted = formatDateToYYYYMMDD(fromDate);
    const toDateFormatted = formatDateToYYYYMMDD(toDate);
    sql += ` AND DATE(created_at) BETWEEN ? AND ?`;
    params.push(fromDateFormatted, toDateFormatted);
  } else if (fromDate) {
    const fromDateFormatted = formatDateToYYYYMMDD(fromDate);
    sql += ` AND DATE(created_at) >= ?`;
    params.push(fromDateFormatted);
  } else if (toDate) {
    const toDateFormatted = formatDateToYYYYMMDD(toDate);
    sql += ` AND DATE(created_at) <= ?`;
    params.push(toDateFormatted);
  }
  
  sql += ` ORDER BY id ASC`;
  
  console.log("📊 Retailer Report SQL:", sql);
  console.log("📊 Retailer Report Params:", params);

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    
    // Format dates in response to DD/MM/YYYY
    const formattedResults = results.map(retailer => ({
      ...retailer,
      created_at_formatted: formatDateToDDMMYYYY(retailer.created_at)
    }));
    
    console.log(`📊 Retrieved ${results.length} retailers`);
    res.json(formattedResults);
  });
});

// ----------------------
// POST Download Report (PDF / Excel) with Date Filtering
// ----------------------
router.post("/retailer-report/download", (req, res) => {
  const { fromDate, toDate, format } = req.body;

  let sql = `
    SELECT 
      id,
      name,
      mobile_number,
      email,
      gstin,
      gst_registered_name,
      business_name,
      display_name
    FROM accounts
    WHERE \`group\` = 'Retailer'
  `;
  
  const params = [];
  
  // Add date filtering if provided
  if (fromDate && toDate) {
    const fromDateFormatted = formatDateToYYYYMMDD(fromDate);
    const toDateFormatted = formatDateToYYYYMMDD(toDate);
    sql += ` AND DATE(created_at) BETWEEN ? AND ?`;
    params.push(fromDateFormatted, toDateFormatted);
  } else if (fromDate) {
    const fromDateFormatted = formatDateToYYYYMMDD(fromDate);
    sql += ` AND DATE(created_at) >= ?`;
    params.push(fromDateFormatted);
  } else if (toDate) {
    const toDateFormatted = formatDateToYYYYMMDD(toDate);
    sql += ` AND DATE(created_at) <= ?`;
    params.push(toDateFormatted);
  }
  
  sql += ` ORDER BY id ASC`;
  
  console.log("📥 Download SQL:", sql);
  console.log("📥 Download Params:", params);

  db.query(sql, params, async (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    console.log(`📥 Retrieved ${results.length} retailers for download`);

    // ---------------- PDF ----------------
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
      
      // Set filename with date range in DD/MM/YYYY format
      let filename = "Retailers_Report";
      if (fromDate && toDate) {
        filename = `Retailers_Report_${fromDate}_to_${toDate}`;
      } else if (fromDate) {
        filename = `Retailers_Report_from_${fromDate}`;
      } else if (toDate) {
        filename = `Retailers_Report_until_${toDate}`;
      }
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}.pdf`);
      doc.pipe(res);

      // Title
      doc.fontSize(18).text("Retailers Report", { align: "center" });
      
      // Add date range subtitle in DD/MM/YYYY format
      doc.moveDown(1);
      doc.fontSize(10);
      if (fromDate && toDate) {
        doc.text(`Date Range: ${fromDate} to ${toDate}`, { align: "center" });
      } else if (fromDate) {
        doc.text(`From Date: ${fromDate}`, { align: "center" });
      } else if (toDate) {
        doc.text(`Until Date: ${toDate}`, { align: "center" });
      }
      doc.text(`Total Retailers: ${results.length}`, { align: "center" });
      doc.moveDown(2);

      // Table headers (Your original layout)
      const headers = [
        "ID", "Name", "Mobile", "Email",
        "GSTIN", "GST Registered Name", "Business Name", "Display Name"
      ];
      const colWidths = [100, 100, 100, 110, 100, 100, 100, 100];
      let y = 100;
      let x = 30;

      // Draw header row
      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], 25).fillAndStroke("#f2f2f2", "black");
        doc
          .fillColor("#000")
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(h, x + 2, y + 8, { width: colWidths[i] - 4, align: "center" });
        x += colWidths[i];
      });

      y += 25;

      // Data rows
      results.forEach((row) => {
        const rowData = [
          row.id,
          row.name,
          row.mobile_number,
          row.email,
          row.gstin,
          row.gst_registered_name,
          row.business_name,
          row.display_name,
        ];
        x = 30;
        rowData.forEach((text, i) => {
          doc.rect(x, y, colWidths[i], 20).stroke();
          doc
            .font("Helvetica")
            .fontSize(8)
            .fillColor("#000")
            .text(text || "-", x + 2, y + 6, {
              width: colWidths[i] - 4,
              align: "center",
            });
          x += colWidths[i];
        });
        y += 20;

        if (y > doc.page.height - 50) {
          doc.addPage({ layout: "landscape" });
          y = 50;
        }
      });

      doc.end();
    }

    // ---------------- Excel ----------------
    else if (format === "excel") {
      try {
        const workbook = new excelJS.Workbook();
        const sheet = workbook.addWorksheet("Customers");

        // Define headers (Your original layout)
        sheet.columns = [
          { header: "ID", key: "id", width: 10 },
          { header: "Name", key: "name", width: 25 },
          { header: "Mobile", key: "mobile_number", width: 15 },
          { header: "Email", key: "email", width: 25 },
          { header: "GSTIN", key: "gstin", width: 20 },
          { header: "GST Registered Name", key: "gst_registered_name", width: 25 },
          { header: "Business Name", key: "business_name", width: 25 },
          { header: "Display Name", key: "display_name", width: 25 },
        ];

        // Add rows
        results.forEach((row) => sheet.addRow(row));

        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4F81BD" },
          };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        
        // Set filename with date range in DD/MM/YYYY format
        let filename = "Retailers_Report";
        if (fromDate && toDate) {
          filename = `Retailers_Report_${fromDate}_to_${toDate}`;
        } else if (fromDate) {
          filename = `Retailers_Report_from_${fromDate}`;
        } else if (toDate) {
          filename = `Retailers_Report_until_${toDate}`;
        }
        
        res.setHeader("Content-Disposition", `attachment; filename=${filename}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
      } catch (err) {
        console.error("❌ Excel generation error:", err);
        res.status(500).json({ error: "Excel generation failed" });
      }
    }
  });
});

module.exports = router;