const express = require("express");
const router = express.Router();
const db = require("../db"); // your MySQL connection
const excelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// ---------- Helper to build SQL ----------
function buildSalesSQL(fromDate, toDate) {
  let sql = `
    SELECT 
      a.name AS service_name,
      v.InvoiceNumber AS invoice,
      DATE(v.Date) AS invoice_date,
      v.SubTotal AS taxable_amount,
      v.TotalAmount AS net_payable
    FROM voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id
    WHERE v.TransactionType = 'Sales'
  `;
  const params = [];

  if (fromDate && toDate) {
    sql += ` AND DATE(v.Date) BETWEEN ? AND ?`;
    params.push(fromDate, toDate);
  }

  sql += ` ORDER BY v.Date DESC`;
  return { sql, params };
}

// ---------- GET: Fetch Sales Data ----------
router.get("/sales-report", (req, res) => {
  const { fromDate, toDate } = req.query;
  const { sql, params } = buildSalesSQL(fromDate, toDate);

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ DB Error (sales-report):", err);
      return res.status(500).json({ error: err.message });
    }

    // ✅ Add serial numbers to results for frontend
    const dataWithSlNo = results.map((r, i) => ({ sl_no: i + 1, ...r }));
    res.json(dataWithSlNo);
  });
});

// ---------- POST: Download Sales Report ----------
router.post("/sales-report/download", (req, res) => {
  const { fromDate, toDate, format } = req.body;
  const { sql, params } = buildSalesSQL(fromDate, toDate);

  db.query(sql, params, async (err, results) => {
    if (err) {
      console.error("❌ DB Error (download sales):", err);
      return res.status(500).json({ error: err.message });
    }

    // ===== PDF EXPORT =====
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 30, layout: "landscape" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=Sales_Report_${fromDate || "ALL"}_${toDate || "ALL"}.pdf`
      );
      doc.pipe(res);

      // Title
      doc.fontSize(18).text("Sales Report", { align: "center" });
      doc.moveDown();
      if (fromDate && toDate) {
        doc.fontSize(12).text(`From ${fromDate} to ${toDate}`, { align: "center" });
      } else {
        doc.fontSize(12).text("All Dates", { align: "center" });
      }
      doc.moveDown(1.2);

      // ✅ Headers including Sl No
      const headers = ["Sl No", "Service", "Invoice", "Date", "Taxable Amount", "Net Payable"];
      const widths = [50, 180, 120, 100, 120, 120];

      let y = 100;
      let x = 30;

      // Header row
      headers.forEach((h, i) => {
        doc.rect(x, y, widths[i], 25).fillAndStroke("#e9ecef", "black");
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(10).text(h, x + 5, y + 8);
        x += widths[i];
      });

      y += 25;
      let totalTaxable = 0;
      let totalNet = 0;

      // Data rows
      results.forEach((r, index) => {
        totalTaxable += Number(r.taxable_amount || 0);
        totalNet += Number(r.net_payable || 0);

        const row = [
          index + 1, // ✅ Sl No
          r.service_name || "-",
          r.invoice || "-",
          r.invoice_date ? new Date(r.invoice_date).toLocaleDateString("en-GB") : "-",
          Number(r.taxable_amount || 0).toFixed(2),
          Number(r.net_payable || 0).toFixed(2),
        ];

        x = 30;
        row.forEach((val, i) => {
          doc.rect(x, y, widths[i], 20).stroke();
          doc.font("Helvetica").fontSize(9).fillColor("#000").text(String(val), x + 5, y + 6);
          x += widths[i];
        });
        y += 20;

        if (y > doc.page.height - 60) {
          doc.addPage({ layout: "landscape" });
          y = 60;
        }
      });

      // Totals Row
      x = 30;
      const totals = [
        { text: "TOTAL", width: widths[0] + widths[1] + widths[2] + widths[3] },
        { text: totalTaxable.toFixed(2), width: widths[4] },
        { text: totalNet.toFixed(2), width: widths[5] },
      ];
      totals.forEach((cell) => {
        doc.rect(x, y, cell.width, 22).fillAndStroke("#dee2e6", "black");
        doc.font("Helvetica-Bold").fontSize(10).text(cell.text, x + 5, y + 6);
        x += cell.width;
      });

      doc.end();
      return;
    }

    // ===== EXCEL EXPORT =====
    if (format === "excel") {
      const workbook = new excelJS.Workbook();
      const ws = workbook.addWorksheet("Sales Report");

      ws.columns = [
        { header: "Sl No", key: "sl_no", width: 8 },
        { header: "Service", key: "service_name", width: 35 },
        { header: "Invoice", key: "invoice", width: 18 },
        { header: "Date", key: "invoice_date", width: 16 },
        { header: "Taxable Amount", key: "taxable_amount", width: 18 },
        { header: "Net Payable", key: "net_payable", width: 18 },
      ];

      let totalTaxable = 0;
      let totalNet = 0;

      results.forEach((r, index) => {
        totalTaxable += Number(r.taxable_amount || 0);
        totalNet += Number(r.net_payable || 0);

        ws.addRow({
          sl_no: index + 1,
          service_name: r.service_name || "-",
          invoice: r.invoice || "-",
          invoice_date: r.invoice_date
            ? new Date(r.invoice_date).toLocaleDateString("en-GB")
            : "-",
          taxable_amount: Number(r.taxable_amount || 0),
          net_payable: Number(r.net_payable || 0),
        });
      });

      const totalsRow = ws.addRow({
        sl_no: "",
        service_name: "TOTAL",
        invoice: "",
        invoice_date: "",
        taxable_amount: totalTaxable,
        net_payable: totalNet,
      });

      totalsRow.font = { bold: true };
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4F81BD" },
      };

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=Sales_Report_${fromDate || "ALL"}_${toDate || "ALL"}.xlsx`
      );

      await workbook.xlsx.write(res);
      return res.end();
    }

    res.status(400).json({ error: "Invalid format (use pdf or excel)" });
  });
});

module.exports = router;
