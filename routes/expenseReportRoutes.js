const express = require("express");
const router = express.Router();
const db = require("../db");
const excelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// GET /api/reports/expense-report
router.get("/expense-report", (req, res) => {
  const { fromDate, toDate } = req.query;

  let sql = `
    SELECT 
      id AS expense_id,
      staff_name AS staff,
      category,
      amount,
      DATE(\`date\`) AS expense_date,
      status,
      payment_status
    FROM expensive
  `;
  const params = [];

  if (fromDate && toDate) {
    sql += " WHERE DATE(`date`) BETWEEN ? AND ? ";
    params.push(fromDate, toDate);
  }

  sql += " ORDER BY DATE(`date`) DESC";

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
});

// POST /api/reports/expense-report/download
router.post("/expense-report/download", (req, res) => {
  const { fromDate, toDate, format } = req.body;

  let sql = `
    SELECT 
      id AS expense_id,
      staff_name AS staff,
      category,
      amount,
      DATE(\`date\`) AS expense_date,
      status,
      payment_status
    FROM expensive
  `;
  const params = [];

  if (fromDate && toDate) {
    sql += " WHERE DATE(`date`) BETWEEN ? AND ? ";
    params.push(fromDate, toDate);
  }

  sql += " ORDER BY DATE(`date`) DESC";

  db.query(sql, params, async (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    // PDF
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
      res.setHeader("Content-Type", "application/pdf");
      // res.setHeader("Content-Disposition", `attachment; filename=Expense_Report.pdf`);
      doc.pipe(res);

      res.setHeader(
  "Content-Disposition",
  `attachment; filename=Expense_Report_${fromDate || "ALL"}_${toDate || "ALL"}.${format}`
);

      doc.fontSize(18).text("Expense Report", { align: "center" });
      if (fromDate && toDate) {
        doc.fontSize(12).text(`From ${fromDate} To ${toDate}`, { align: "center" });
      }
      doc.moveDown(2);

      const headers = ["ID", "Staff", "Category", "Amount", "Expense Date", "Status", "Payment Status"];
      const colWidths = [50, 100, 100, 80, 100, 100, 120];
      let y = 120;
      let x = 30;

      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], 25).fillAndStroke("#f2f2f2", "black");
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(h, x + 2, y + 8, {
          width: colWidths[i] - 4,
          align: "center",
        });
        x += colWidths[i];
      });

      y += 25;

      results.forEach((row) => {
        const rowData = [
          row.expense_id,
          row.staff,
          row.category,
          row.amount,
          row.expense_date ? new Date(row.expense_date).toLocaleDateString("en-GB") : "-",
          row.status,
          row.payment_status,
        ];
        x = 30;
        rowData.forEach((text, i) => {
          doc.rect(x, y, colWidths[i], 20).stroke();
          doc.font("Helvetica").fontSize(8).fillColor("#000").text(text || "-", x + 2, y + 6, {
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
      return;
    }

    // Excel
    if (format === "excel") {
      try {
        const workbook = new excelJS.Workbook();
        const sheet = workbook.addWorksheet("Expenses");

        sheet.columns = [
          { header: "ID", key: "expense_id", width: 10 },
          { header: "Staff", key: "staff", width: 20 },
          { header: "Category", key: "category", width: 20 },
          { header: "Amount", key: "amount", width: 15 },
          { header: "Expense Date", key: "expense_date", width: 20 },
          { header: "Status", key: "status", width: 15 },
          { header: "Payment Status", key: "payment_status", width: 20 },
        ];

        results.forEach((row) => {
          row.expense_date = row.expense_date
            ? new Date(row.expense_date).toLocaleDateString("en-GB")
            : "-";
          sheet.addRow(row);
        });

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F81BD" } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename=Expense_Report.xlsx`);

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
