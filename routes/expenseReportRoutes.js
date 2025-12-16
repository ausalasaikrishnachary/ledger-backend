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
      const doc = new PDFDocument({ 
        margin: 20, 
        size: "A4", 
        layout: "landscape" 
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=Expense_Report_${fromDate || "ALL"}_${toDate || "ALL"}.pdf`
      );
      doc.pipe(res);

      // Title
      doc.fontSize(20).font("Helvetica-Bold").text("EXPENSE REPORT", { 
        align: "center",
        underline: true 
      });
      
      doc.moveDown(0.5);
      
      // Date Range
      if (fromDate && toDate) {
        doc.fontSize(12).font("Helvetica").text(`From: ${fromDate}  |  To: ${toDate}`, { 
          align: "center" 
        });
      } else {
        doc.fontSize(12).font("Helvetica").text("All Expenses", { 
          align: "center" 
        });
      }
      
      doc.moveDown(1);
      
      // Generated info
      doc.fontSize(10).font("Helvetica").text(
        `Generated on: ${new Date().toLocaleDateString('en-IN')}  |  Total Records: ${results.length}`, 
        { align: "center" }
      );
      
      doc.moveDown(2);

      // Table setup with wider columns for amount
      const headers = ["ID", "Staff", "Category", "Amount", "Expense Date", "Status", "Payment Status"];
      const colWidths = [50, 120, 100, 110, 100, 100, 120]; // Increased Amount column to 110
      
      let y = 140;
      let x = 20;

      /* ========== TABLE HEADER ========== */
      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], 28)
          .fillAndStroke("#000000", "#000000");
        
        doc.fillColor("#FFFFFF")
          .font("Helvetica-Bold")
          .fontSize(11)
          .text(h, x, y + 9, {
            width: colWidths[i],
            align: "center"
          });
        
        x += colWidths[i];
      });

      y += 28;

      /* ========== TABLE ROWS ========== */
      results.forEach((row, index) => {
        // Format amount properly without leading apostrophe
        let formattedAmount = "₹0.00";
        if (row.amount) {
          const amountNum = parseFloat(row.amount);
          if (!isNaN(amountNum)) {
            // Use toLocaleString for proper formatting with commas
            formattedAmount = "₹" + amountNum.toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });
          }
        }

        const rowData = [
          row.expense_id,
          row.staff || "-",
          row.category || "-",
          formattedAmount, // Use properly formatted amount
          row.expense_date ? new Date(row.expense_date).toLocaleDateString("en-IN") : "-",
          row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : "-",
          row.payment_status ? row.payment_status.charAt(0).toUpperCase() + row.payment_status.slice(1) : "-"
        ];
        
        x = 20;
        
        // Alternate row colors
        const rowColor = index % 2 === 0 ? "#FFFFFF" : "#F8F9FA";
        
        rowData.forEach((text, i) => {
          // Draw cell with border
          doc.rect(x, y, colWidths[i], 24)
            .fillAndStroke(rowColor, "#CCCCCC");
          
          // Set text color and font
          let textColor = "#000000";
          let fontStyle = "Helvetica";
          let fontSize = 9;
          
          // Adjust font size for amount column to prevent cutting
          if (i === 3) { // Amount column
            fontSize = 8; // Smaller font for amount to fit better
          }
          
          if (i === 5) { // Status column
            const status = text.toLowerCase();
            if (status === "approved") {
              textColor = "#28a745";
              fontStyle = "Helvetica-Bold";
            } else if (status === "pending") {
              textColor = "#ff9800";
              fontStyle = "Helvetica-Bold";
            } else if (status === "rejected") {
              textColor = "#dc3545";
              fontStyle = "Helvetica-Bold";
            }
          } else if (i === 6) { // Payment Status column
            const paymentStatus = text.toLowerCase();
            if (paymentStatus === "paid") {
              textColor = "#28a745";
              fontStyle = "Helvetica-Bold";
            } else if (paymentStatus === "unpaid") {
              textColor = "#dc3545";
              fontStyle = "Helvetica-Bold";
            }
          }
          
          // Center text with proper padding
          const textWidth = colWidths[i] - 4; // Reduce width for padding
          const textX = x + (colWidths[i] - textWidth) / 2;
          
          doc.fillColor(textColor)
            .font(fontStyle)
            .fontSize(fontSize)
            .text(String(text), textX, y + 8, {
              width: textWidth,
              align: "center",
              ellipsis: true // Add ellipsis if text is too long
            });
          
          x += colWidths[i];
        });

        y += 24;
        
        // Page break check
        if (y > doc.page.height - 50) {
          doc.addPage({ 
            layout: "landscape",
            margin: 20 
          });
          y = 50;
        }
      });

      /* ========== SUMMARY SECTION ========== */
      doc.moveDown(2);
      
      // Calculate total amount
      const totalAmount = results.reduce((sum, row) => {
        const amount = parseFloat(row.amount || 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);
      
      // Calculate status counts
      const statusCounts = results.reduce((acc, row) => {
        const status = (row.status || '').toLowerCase();
        if (status) {
          acc[status] = (acc[status] || 0) + 1;
        }
        return acc;
      }, {});
      
      const pendingCount = statusCounts.pending || 0;
      const approvedCount = statusCounts.approved || 0;
      const rejectedCount = statusCounts.rejected || 0;
      
      // Summary box with increased width
      const summaryWidth = doc.page.width - 40;
      const summaryY = y + 10;
      
      // Summary background
      doc.rect(20, summaryY, summaryWidth, 70)
        .fill("#F8F9FA")
        .stroke("#000000");
      
      // Summary title
      doc.fillColor("#000000")
        .font("Helvetica-Bold")
        .fontSize(14)
        .text("SUMMARY", 20, summaryY + 10, {
          width: summaryWidth,
          align: "center"
        });
      
      // Summary content - formatted properly
      const leftColX = 40;
      const leftValueX = leftColX + 120;
      const rightColX = leftValueX + 100;
      const rightValueX = rightColX + 100;
      
      // Format total amount with commas
      const formattedTotalAmount = "₹" + totalAmount.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      
      doc.fillColor("#000000")
        .font("Helvetica")
        .fontSize(11)
        .text("Total Expenses:", leftColX, summaryY + 30)
        .font("Helvetica-Bold")
        .text(results.length.toString(), leftValueX, summaryY + 30)
        .font("Helvetica")
        .text("Total Amount:", leftColX, summaryY + 50)
        .font("Helvetica-Bold")
        .text(formattedTotalAmount, leftValueX, summaryY + 50);
      
      // Status counts on the right side
      doc.font("Helvetica")
        .text("Pending:", rightColX, summaryY + 30)
        .font("Helvetica-Bold")
        .text(pendingCount.toString(), rightValueX, summaryY + 30)
        .font("Helvetica")
        .text("Approved:", rightColX, summaryY + 50)
        .font("Helvetica-Bold")
        .text(approvedCount.toString(), rightValueX, summaryY + 50);
      
      if (rejectedCount > 0) {
        doc.font("Helvetica")
          .text("Rejected:", rightColX, summaryY + 70)
          .font("Helvetica-Bold")
          .text(rejectedCount.toString(), rightValueX, summaryY + 70);
      }

      doc.end();
      return;
    }

    // Excel - also fix the formatting here
    if (format === "excel") {
      try {
        const workbook = new excelJS.Workbook();
        const sheet = workbook.addWorksheet("Expenses");

        // Column definitions
        sheet.columns = [
          { header: "ID", key: "expense_id", width: 15 },
          { header: "Staff", key: "staff", width: 25 },
          { header: "Category", key: "category", width: 20 },
          { header: "Amount", key: "amount", width: 20 },
          { header: "Expense Date", key: "expense_date", width: 20 },
          { header: "Status", key: "status", width: 15 },
          { header: "Payment Status", key: "payment_status", width: 20 },
        ];

        // Add rows with proper formatting
        results.forEach((row) => {
          sheet.addRow({
            expense_id: row.expense_id,
            staff: row.staff || "-",
            category: row.category || "-",
            amount: row.amount ? parseFloat(row.amount) : 0,
            expense_date: row.expense_date 
              ? new Date(row.expense_date).toLocaleDateString("en-IN")
              : "-",
            status: row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : "-",
            payment_status: row.payment_status ? row.payment_status.charAt(0).toUpperCase() + row.payment_status.slice(1) : "-"
          });
        });

        // Black header styling
        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          cell.font = { 
            bold: true, 
            size: 12,
            color: { argb: "FFFFFFFF" }
          };
          cell.fill = { 
            type: "pattern", 
            pattern: "solid", 
            fgColor: { argb: "FF000000" }
          };
          cell.alignment = { 
            vertical: "middle", 
            horizontal: "center" 
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFFFFFFF' } },
            left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
            bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
            right: { style: 'thin', color: { argb: 'FFFFFFFF' } }
          };
        });

        // Format amount column with ₹ symbol and comma separators
        const amountCol = sheet.getColumn(4);
        amountCol.eachCell((cell) => {
          if (cell.value && typeof cell.value === 'number') {
            cell.numFmt = '[₹]#,##0.00';
            cell.alignment = { horizontal: "right" };
          }
        });

        // Center align all other cells
        [1, 2, 3, 5, 6, 7].forEach(colNum => {
          const col = sheet.getColumn(colNum);
          col.alignment = { horizontal: "center", vertical: "middle" };
        });

        // Calculate totals
        const totalAmount = results.reduce((sum, row) => {
          const amount = parseFloat(row.amount || 0);
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);

        // Add summary row
        sheet.addRow({}); // Empty row
        const totalRow = sheet.addRow({
          category: "TOTAL EXPENSES",
          amount: totalAmount
        });

        totalRow.getCell(3).font = { bold: true, size: 11 };
        totalRow.getCell(4).font = { bold: true, size: 11 };
        totalRow.getCell(4).numFmt = '[₹]#,##0.00';
        totalRow.getCell(4).alignment = { horizontal: "right" };

        // Add record count
        sheet.addRow({
          category: "TOTAL RECORDS",
          status: results.length
        });

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=Expense_Report_${fromDate || "ALL"}_${toDate || "ALL"}.xlsx`
        );

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
