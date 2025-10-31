const express = require("express");
const router = express.Router();
const db = require("../db");
const excelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// ----------------------
// GET Customers (via retailer-report path)
// ----------------------
router.get("/retailer-report", (req, res) => {
  const sql = `
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
    WHERE \`group\` = 'customer'
    ORDER BY id ASC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
});

// ----------------------
// POST Download Report (PDF / Excel)
// ----------------------
router.post("/retailer-report/download", (req, res) => {
  const { format } = req.body;

  const sql = `
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
    WHERE \`group\` = 'customer'
    ORDER BY id ASC
  `;

  db.query(sql, async (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    // ---------------- PDF ----------------
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=Customers_Report.pdf`);
      doc.pipe(res);

      // Title
      doc.fontSize(18).text("Retailers Report", { align: "center" });
      doc.moveDown(2);

      // Table headers
      const headers = [
        "ID", "Name", "Mobile", "Email",
        "GSTIN", "GST Registered Name", "Business Name", "Display Name"
      ];
      const colWidths = [40, 100, 100, 150, 100, 120, 120, 120];
      let y = 100;
      let x = 30;

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

        // Define headers
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
        res.setHeader("Content-Disposition", `attachment; filename=Customers_Report.xlsx`);

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
