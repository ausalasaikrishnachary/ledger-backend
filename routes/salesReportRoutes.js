const express = require("express");
const router = express.Router();
const db = require("../db");
const excelJS = require("exceljs");
const PDFDocument = require("pdfkit");

/* ================= HELPER QUERY ================= */
function buildVoucherDetailsSQL() {
  return `
    SELECT 
      MIN(vd.id) AS id,
      vd.product,
      vd.product_id,
      vd.batch,
      DATE(v.Date) AS invoice_date,
      v.order_mode,
      v.Subtotal,
      v.PartyName AS retailer,
      a.name AS assigned_staff,
      a.address AS staff_address,
      SUM(vd.quantity) AS quantity,
      SUM(vd.price) AS price,
      SUM(vd.discount) AS discount,
      SUM(vd.gst) AS gst,
      SUM(vd.cgst) AS cgst,
      SUM(vd.sgst) AS sgst,
      SUM(vd.igst) AS igst,
      SUM(vd.cess) AS cess,
      SUM(vd.total) AS total,
      GROUP_CONCAT(DISTINCT v.InvoiceNumber SEPARATOR ', ') AS invoice_numbers
    FROM voucherdetails vd
    LEFT JOIN voucher v ON vd.voucher_id = v.VoucherID
    LEFT JOIN accounts a ON v.staffid = a.id
    WHERE v.TransactionType = 'Sales'
    GROUP BY 
      vd.product_id,
      vd.batch,
      vd.product,
      v.PartyName,
      a.name,
      a.address
    ORDER BY invoice_date DESC
  `;
}

/* ================= GET VOUCHER DETAILS ================= */
router.get("/sales-report", (req, res) => {
  const sql = buildVoucherDetailsSQL();

  db.query(sql, (err, results) => {
    if (err) {
      console.error("VoucherDetails GET error:", err);
      return res.status(500).json({ success: false });
    }

    const data = results.map((r, i) => ({
      sl_no: i + 1,
      ...r,
      invoice_date: r.invoice_date
        ? new Date(r.invoice_date).toLocaleDateString("en-IN")
        : "-"
    }));

    res.json({
      success: true,
      data,
      totalCount: data.length
    });
  });
});

/* ================= POST DOWNLOAD ================= */
router.post("/sales-report/download", (req, res) => {
  const { format } = req.body;
  const sql = buildVoucherDetailsSQL();

  db.query(sql, async (err, results) => {
    if (err) {
      console.error("VoucherDetails download error:", err);
      return res.status(500).json({ error: err.message });
    }

    /* ================== PDF EXPORT ================== */
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 30, layout: "landscape" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=Sales_Details_Report_${new Date().toISOString().split('T')[0]}.pdf`
      );

      doc.pipe(res);

      // Title with larger font
      doc.fontSize(22).text("Sales Details Report", { align: "center" });
      doc.moveDown(1);
      
      // Report date
      doc.fontSize(10).text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: "center" });
      doc.moveDown(2);

      const headers = [
        "Sl No",
        "Product",
        "Quantity",
        "Taxable Amount",
        "Total Amount",
        "Retailer",
        "Staff",
        "Date"
      ];

      // Adjusted column widths for better spacing
      const widths = [50, 150, 70, 100, 100, 140, 120, 90];

      let x = 30;
      let y = 130;

      /* ===== HEADER ===== */
      headers.forEach((h, i) => {
        doc
          .rect(x, y, widths[i], 25)
          .fillAndStroke("#343a40", "black");

        doc
          .fillColor("white")
          .font("Helvetica-Bold")
          .fontSize(11) // Increased font size
          .text(h, x + 4, y + 8, {
            width: widths[i] - 8,
            align: "center"
          });

        doc.fillColor("black");
        x += widths[i];
      });

      y += 25;

      /* ===== ROWS ===== */
      results.forEach((r, i) => {
        const row = [
          i + 1,
          r.product || "-",
          r.quantity || 0,
          r.Subtotal ? `₹${parseFloat(r.Subtotal).toFixed(2)}` : "₹0.00",
          r.total ? `₹${parseFloat(r.total).toFixed(2)}` : "₹0.00",
          r.retailer || "-",
          r.assigned_staff || "-",
          r.invoice_date
            ? new Date(r.invoice_date).toLocaleDateString("en-IN")
            : "-"
        ];

        x = 30;
        row.forEach((val, j) => {
          doc.rect(x, y, widths[j], 22).stroke();
          doc.font("Helvetica").fontSize(10) // Increased font size
            .text(String(val), x + 4, y + 8, {
              width: widths[j] - 8,
              align: "center"
            });
          x += widths[j];
        });

        y += 22;
        if (y > doc.page.height - 50) {
          doc.addPage({ layout: "landscape" });
          y = 60;
        }
      });

      // Add summary at the end
      const totalSales = results.reduce((sum, r) => sum + parseFloat(r.total || 0), 0);
      const totalSubtotal = results.reduce((sum, r) => sum + parseFloat(r.Subtotal || 0), 0);
      
      doc.moveDown(3);
      doc.fontSize(12).font("Helvetica-Bold")
        .text("Summary", { align: "center" });
      doc.moveDown(0.5);
      
      doc.fontSize(10).font("Helvetica")
        .text(`Total Taxable Amount: ₹${totalSubtotal.toFixed(2)}`, { align: "center" });
      doc.text(`Total Sales Amount: ₹${totalSales.toFixed(2)}`, { align: "center" });
      doc.text(`Total Records: ${results.length}`, { align: "center" });

      doc.end();
      return;
    }

    /* ================== EXCEL EXPORT ================== */
    if (format === "excel") {
      const workbook = new excelJS.Workbook();
      const ws = workbook.addWorksheet("Sales Details");

      ws.columns = [
        { header: "Sl No", key: "sl_no", width: 8 },
        { header: "Product", key: "product", width: 30 },
        { header: "Quantity", key: "quantity", width: 12 },
        { header: "Taxable Amount", key: "subtotal", width: 18 },
        { header: "Total Amount", key: "total", width: 18 },
        { header: "Retailer", key: "retailer", width: 30 },
        { header: "Staff", key: "assigned_staff", width: 25 },
        { header: "Date", key: "invoice_date", width: 15 }
      ];

      results.forEach((r, i) => {
        ws.addRow({
          sl_no: i + 1,
          product: r.product || "-",
          quantity: r.quantity || 0,
          subtotal: r.Subtotal ? parseFloat(r.Subtotal) : 0,
          total: r.total ? parseFloat(r.total) : 0,
          retailer: r.retailer || "-",
          assigned_staff: r.assigned_staff || "-",
          invoice_date: r.invoice_date
            ? new Date(r.invoice_date).toLocaleDateString("en-IN")
            : "-"
        });
      });

      // Add summary row
      const totalRow = ws.addRow({});
      ws.addRow({
        product: "TOTAL",
        subtotal: results.reduce((sum, r) => sum + parseFloat(r.Subtotal || 0), 0),
        total: results.reduce((sum, r) => sum + parseFloat(r.total || 0), 0)
      });

      /* ===== HEADER STYLE ===== */
      const headerRow = ws.getRow(1);
      headerRow.font = {
        bold: true,
        size: 12, // Increased font size
        color: { argb: "FFFFFFFF" }
      };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF343A40" }
      };
      headerRow.alignment = {
        horizontal: "center",
        vertical: "middle"
      };

      // Style for summary row
      const summaryRow = ws.getRow(results.length + 2);
      summaryRow.font = {
        bold: true,
        size: 11
      };
      summaryRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF0F0F0" }
      };

      // Center align all cells
      ws.eachRow((row) => {
        row.alignment = {
          vertical: "middle",
          horizontal: "center"
        };
      });

      // Format currency columns
      const subtotalCol = ws.getColumn(4);
      const totalCol = ws.getColumn(5);
      
      [subtotalCol, totalCol].forEach(col => {
        col.eachCell((cell) => {
          if (cell.value && typeof cell.value === 'number') {
            cell.numFmt = '"₹"#,##0.00';
          }
        });
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=Sales_Details_Report_${new Date().toISOString().split('T')[0]}.xlsx`
      );

      await workbook.xlsx.write(res);
      return res.end();
    }

    res.status(400).json({ error: "Invalid format (pdf / excel)" });
  });
});

module.exports = router;