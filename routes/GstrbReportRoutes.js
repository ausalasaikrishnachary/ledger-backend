// GSTR-3B.js — Express router for GSTR-3B report API
// Mount in your app: app.use("/api/gstr3b", require("./routes/GSTR-3B"));
//
// Uses mysql2 (callback-based pool, NOT /promise).
// db is imported from ../db  (i.e. ledger-backend/db.js)

const express = require("express");
const router  = express.Router();
const db      = require("../db"); // ← callback-based mysql2 pool
const PDFDocument = require("pdfkit");
const excelJS = require("exceljs");

// ─── Promisify db.query ───────────────────────────────────────────────────────
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

// ─── DIAGNOSTIC: run once on startup to find actual TransactionType values ───
// Remove this block once you've confirmed the correct TransactionType value.
(async () => {
  try {
    const rows = await query("SELECT DISTINCT TransactionType FROM voucher LIMIT 20");
    rows.forEach((r) => JSON.stringify(r.TransactionType));
  } catch (e) {
    console.error("[GSTR-3B startup diagnostic]", e.message);
  }
})();

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the WHERE clause shared by both /summary and /list.
 *
 * Only Sales transactions are returned (TransactionType = 'Sales').
 */
function buildWhere({ fromDate, toDate, search, filterType }) {
  // ── Always filter to Sales invoices only ─────────────────────────────────
  // TransactionType = 'Sales' excludes Receipt, Payment, Journal, Contra, Purchase.
  // document_type IS NOT NULL ensures we only get actual invoice records
  // (Tax Invoice / Bill of Supply), excluding Receipt/Payment entries that
  // carry data_type = 'Sales' but have no document_type set.
  const conditions = [
    "v.TransactionType = 'Sales'",
    "v.document_type IS NOT NULL",
  ];
  const params     = [];

  // ── Date range ────────────────────────────────────────────────────────────
  if (fromDate) {
    conditions.push("DATE(v.Date) >= ?");
    params.push(fromDate);
  }
  if (toDate) {
    conditions.push("DATE(v.Date) <= ?");
    params.push(toDate);
  }

  // ── Search ────────────────────────────────────────────────────────────────
  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conditions.push(
      "(v.InvoiceNumber LIKE ? OR v.PartyName LIKE ? OR v.gstin LIKE ? OR v.hsn_code LIKE ?)"
    );
    params.push(like, like, like, like);
  }

  // ── Chip filters ──────────────────────────────────────────────────────────
  if (filterType === "b2b") {
    conditions.push("LOWER(v.bb_bc) = 'b2b'");
  } else if (filterType === "b2c") {
    conditions.push("LOWER(v.bb_bc) = 'b2c'");
  } else if (filterType === "5gst") {
    conditions.push(`EXISTS (
      SELECT 1 FROM voucherdetails vd
      WHERE vd.voucher_id = v.VoucherID AND vd.gst = 5
    )`);
  } else if (filterType === "0gst") {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM voucherdetails vd
      WHERE vd.voucher_id = v.VoucherID AND vd.gst > 0
    )`);
  } else if (filterType === "18gst") {
    // ← NEW: matches the "18% GST" chip on the frontend
    conditions.push(`EXISTS (
      SELECT 1 FROM voucherdetails vd
      WHERE vd.voucher_id = v.VoucherID AND vd.gst = 18
    )`);
  } else if (filterType === "12gst") {
    // ← NEW: matches the "12% GST" chip on the frontend
    conditions.push(`EXISTS (
      SELECT 1 FROM voucherdetails vd
      WHERE vd.voucher_id = v.VoucherID AND vd.gst = 12
    )`);
  } else if (filterType === "withGstin") {
    conditions.push("v.gstin IS NOT NULL AND v.gstin != '' AND v.gstin != 'N/A'");
  } else if (filterType === "noGstin") {
    conditions.push("(v.gstin IS NULL OR v.gstin = '' OR v.gstin = 'N/A')");
  }

  return {
    clause: "WHERE " + conditions.join(" AND "),
    params,
  };
}

// ─── GET /api/gstr3b/summary ──────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    const { clause, params } = buildWhere({ fromDate, toDate });

    const sql = `
      SELECT
        COALESCE(SUM(v.TotalAmount), 0)  AS totalBillAmount,
        COALESCE(SUM(v.BasicAmount), 0)  AS taxableAmount,
        COUNT(v.VoucherID)               AS totalTransactions,
        COALESCE(
          SUM(
            COALESCE(v.SGSTAmount, 0) +
            COALESCE(v.CGSTAmount, 0) +
            COALESCE(v.IGSTAmount, 0)
          ), 0
        )                                AS totalGSTCollected
      FROM voucher v
      ${clause}
    `;

    const rows = await query(sql, params);
    const row  = rows[0];

    res.json({
      totalBillAmount:   parseFloat(row.totalBillAmount)   || 0,
      taxableAmount:     parseFloat(row.taxableAmount)     || 0,
      totalTransactions: parseInt(row.totalTransactions)   || 0,
      totalGSTCollected: parseFloat(row.totalGSTCollected) || 0,
    });
  } catch (err) {
    console.error("[GSTR-3B /summary] ERROR:", err);
    res.status(500).json({ error: "Failed to fetch summary data.", detail: err.message });
  }
});

// ─── GET /api/gstr3b/list ─────────────────────────────────────────────────────
router.get("/list", async (req, res) => {
  try {
    const {
      page       = 1,
      limit      = 10,
      search     = "",
      fromDate   = "",
      toDate     = "",
      filterType = "all",
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * pageSize;

    const { clause, params } = buildWhere({ fromDate, toDate, search, filterType });

    // ── count ──────────────────────────────────────────────────────────────
    const countSql   = `SELECT COUNT(v.VoucherID) AS total FROM voucher v ${clause}`;
    const countRows  = await query(countSql, params);
    const totalRecords = parseInt(countRows[0].total) || 0;
    const totalPages   = Math.max(1, Math.ceil(totalRecords / pageSize));

    // ── data ───────────────────────────────────────────────────────────────
    const dataSql = `
      SELECT
        v.VoucherID,
        v.InvoiceNumber,
        DATE_FORMAT(v.Date, '%d/%m/%Y')          AS Date,
        v.PartyName,
        COALESCE(v.gstin,            'N/A')       AS gstin,
        COALESCE(v.bb_bc,            'b2c')       AS bb_bc,
        COALESCE(v.TransactionType,  'Sales')     AS TransactionType,
        COALESCE(
          NULLIF(TRIM(v.hsn_code), ''),
          (
            SELECT GROUP_CONCAT(
              DISTINCT vd.hsn_code
              ORDER BY vd.hsn_code
              SEPARATOR ', '
            )
            FROM voucherdetails vd
            WHERE vd.voucher_id = v.VoucherID
              AND vd.hsn_code IS NOT NULL
              AND TRIM(vd.hsn_code) != ''
          )
        )                                         AS hsn_code,
        COALESCE(v.TotalAmount, 0)                AS TotalAmount,
        COALESCE(v.BasicAmount, 0)                AS BasicAmount,
        COALESCE(v.SGSTAmount,  0)                AS SGSTAmount,
        COALESCE(v.CGSTAmount,  0)                AS CGSTAmount,
        COALESCE(v.IGSTAmount,  0)                AS IGSTAmount,
        COALESCE(
          (
            SELECT GROUP_CONCAT(
              DISTINCT CONCAT(FORMAT(vd.gst, 2), '%')
              ORDER BY vd.gst
              SEPARATOR ', '
            )
            FROM voucherdetails vd
            WHERE vd.voucher_id = v.VoucherID
              AND vd.gst IS NOT NULL
          ),
          '0.00%'
        ) AS gstPercentages
      FROM voucher v
      ${clause}
      ORDER BY v.Date DESC, v.VoucherID DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, pageSize, offset];

    const rows = await query(dataSql, dataParams);

    const data = rows.map((r) => ({
      id:              r.VoucherID,
      billNo:          r.InvoiceNumber   || "—",
      date:            r.Date            || "—",
      party:           r.PartyName       || "—",
      gstNo:           r.gstin,
      bbbc:            (r.bb_bc || "b2c").toLowerCase(),
      transactionType: r.TransactionType || "Sales",   // ← NEW field
      hsnCode:         r.hsn_code        || "—",
      billAmt:         parseFloat(r.TotalAmount)  || 0,
      taxableAmt:      parseFloat(r.BasicAmount)  || 0,
      sgst:            parseFloat(r.SGSTAmount)   || 0,
      cgst:            parseFloat(r.CGSTAmount)   || 0,
      igst:            parseFloat(r.IGSTAmount)   || 0,
      gst:             r.gstPercentages,
    }));

    res.json({ data, totalRecords, totalPages, currentPage: pageNum });
  } catch (err) {
    console.error("[GSTR-3B /list] ERROR:", err);
    res.status(500).json({ error: "Failed to fetch bill list.", detail: err.message });
  }
});

// ─── GET /api/gstr3b/transactions ─────────────────────────────────────────────
// When a PARTY NAME is clicked — shows ALL voucherdetails rows for the party
// across ALL their invoices (all time, or filtered by date range on the detail page).
//
// Query params: billNo (required — used to resolve the party), fromDate, toDate
router.get("/transactions", async (req, res) => {
  try {
    const { billNo, fromDate, toDate } = req.query;

    if (!billNo || !billNo.trim()) {
      return res.status(400).json({ error: "billNo is required." });
    }

    // ── Step 1: resolve PartyName from the clicked InvoiceNumber ─────────
    const anchorSql = `
      SELECT v.PartyName, v.PartyID
      FROM voucher v
      WHERE v.InvoiceNumber = ?
        AND v.TransactionType = 'Sales'
        AND v.document_type IS NOT NULL
      LIMIT 1
    `;
    const anchorRows = await query(anchorSql, [billNo.trim()]);

    if (anchorRows.length === 0) {
      return res.json({
        transactions: [],
        summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
      });
    }

    const partyName = anchorRows[0].PartyName;
    const partyID   = anchorRows[0].PartyID;

    // ── Step 2: find ALL VoucherIDs for this party (Sales only) ──────────
    const voucherConditions = partyID
      ? ["v.PartyID = ?", "v.TransactionType = 'Sales'", "v.document_type IS NOT NULL"]
      : ["v.PartyName = ?", "v.TransactionType = 'Sales'", "v.document_type IS NOT NULL"];
    const voucherParams = partyID ? [partyID] : [partyName];

    if (fromDate) {
      voucherConditions.push("DATE(v.Date) >= ?");
      voucherParams.push(fromDate);
    }
    if (toDate) {
      voucherConditions.push("DATE(v.Date) <= ?");
      voucherParams.push(toDate);
    }

    const voucherSql = `
      SELECT
        v.VoucherID,
        v.PartyName,
        DATE_FORMAT(v.Date, '%d/%m/%Y') AS VoucherDate,
        v.InvoiceNumber
      FROM voucher v
      WHERE ${voucherConditions.join(" AND ")}
      ORDER BY v.Date DESC, v.VoucherID DESC
    `;
    const voucherRows = await query(voucherSql, voucherParams);

    if (voucherRows.length === 0) {
      return res.json({
        transactions: [],
        summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
      });
    }

    const voucherIds = voucherRows.map((v) => v.VoucherID);
    const voucherMeta = {};
    voucherRows.forEach((v) => {
      voucherMeta[v.VoucherID] = {
        partyName: v.PartyName     || "—",
        date:      v.VoucherDate   || "—",
        invoiceNo: v.InvoiceNumber || "—",
      };
    });

    // ── Step 3: fetch ALL voucherdetails for those VoucherIDs ─────────────
    const placeholders = voucherIds.map(() => "?").join(", ");

    const summarySql = `
      SELECT
        COALESCE(SUM(vd.total),    0) AS totalSales,
        COUNT(vd.id)                  AS totalTransactions,
        COALESCE(SUM(vd.quantity), 0) AS totalProductsSold
      FROM voucherdetails vd
      WHERE vd.voucher_id IN (${placeholders})
    `;
    const summaryRows = await query(summarySql, voucherIds);
    const kpiRow      = summaryRows[0];

    const detailSql = `
      SELECT
        vd.id                        AS id,
        vd.voucher_id                AS voucherId,
        COALESCE(vd.product,  '—')   AS productName,
        COALESCE(vd.price,     0)    AS ratePerUnit,
        COALESCE(vd.quantity,  0)    AS quantity,
        COALESCE(vd.total,     0)    AS amount,
        COALESCE(vd.hsn_code, '—')  AS hsnCode,
        COALESCE(vd.gst,       0)    AS gstPct,
        COALESCE(vd.sgst,      0)    AS sgst,
        COALESCE(vd.cgst,      0)    AS cgst,
        COALESCE(vd.igst,      0)    AS igst,
        COALESCE(vd.discount,  0)    AS discount
      FROM voucherdetails vd
      WHERE vd.voucher_id IN (${placeholders})
      ORDER BY vd.voucher_id DESC, vd.id ASC
    `;
    const detailRows = await query(detailSql, voucherIds);

    const transactions = detailRows.map((r) => {
      const meta = voucherMeta[r.voucherId] || { partyName: partyName || "—", date: "—", invoiceNo: "—" };
      return {
        id:          r.id,
        partyName:   meta.partyName,
        date:        meta.date,
        invoiceNo:   meta.invoiceNo,
        productName: r.productName || "—",
        ratePerUnit: parseFloat(r.ratePerUnit) || 0,
        quantity:    parseFloat(r.quantity)    || 0,
        amount:      parseFloat(r.amount)      || 0,
        hsnCode:     r.hsnCode     || "—",
        gstPct:      parseFloat(r.gstPct)      || 0,
        sgst:        parseFloat(r.sgst)        || 0,
        cgst:        parseFloat(r.cgst)        || 0,
        igst:        parseFloat(r.igst)        || 0,
        discount:    parseFloat(r.discount)    || 0,
      };
    });

    const totalSales = parseFloat(kpiRow.totalSales)        || 0;
    const totalTx    = parseInt(kpiRow.totalTransactions)   || 0;
    const totalQty   = parseFloat(kpiRow.totalProductsSold) || 0;

    res.json({
      transactions,
      summary: {
        totalSales,
        totalTransactions:   totalTx,
        totalProductsSold:   totalQty,
        avgTransactionValue: totalTx > 0 ? totalSales / totalTx : 0,
      },
    });
  } catch (err) {
    console.error("[GSTR-3B /transactions] ERROR:", err);
    res.status(500).json({ error: "Failed to fetch transactions.", detail: err.message });
  }
});

// ─── GET /api/gstr3b/bill-transactions ────────────────────────────────────────
// When a BILL NO. is clicked — shows voucherdetails rows for ALL vouchers
// sharing the same InvoiceNumber (Sales + Receipt + Payment + any other type).
//
// Previously only fetched the single Sales voucher — this fix fetches every
// TransactionType linked to that InvoiceNumber so Receipt/Payment rows appear.
//
// Query params: billNo (required), voucherId (optional — used to resolve the
//   InvoiceNumber when the same number exists across multiple TransactionTypes)
router.get("/bill-transactions", async (req, res) => {
  try {
    const { billNo, voucherId: voucherIdParam } = req.query;

    if (!billNo || !billNo.trim()) {
      return res.status(400).json({ error: "billNo is required." });
    }

    // ── Step 1: resolve the canonical InvoiceNumber ───────────────────────
    // If voucherId was passed, use it to get the exact InvoiceNumber (handles
    // cases where the same invoice string exists under different TransactionTypes).
    // Otherwise fall back to the billNo string directly.
    let resolvedInvoiceNumber = billNo.trim();

    if (voucherIdParam) {
      const resolveRows = await query(
        `SELECT InvoiceNumber FROM voucher WHERE VoucherID = ? LIMIT 1`,
        [parseInt(voucherIdParam)]
      );
      if (resolveRows.length > 0 && resolveRows[0].InvoiceNumber) {
        resolvedInvoiceNumber = resolveRows[0].InvoiceNumber;
      }
    }

    // ── Step 2: fetch ALL vouchers for this InvoiceNumber (all TransactionTypes)
    // This is the key fix — no TransactionType filter so Sales + Receipt +
    // Payment + Journal etc. are all included.
    const allVouchersSql = `
      SELECT
        v.VoucherID,
        v.PartyName,
        DATE_FORMAT(v.Date, '%d/%m/%Y')   AS VoucherDate,
        v.InvoiceNumber,
        COALESCE(v.TransactionType, '—')  AS TransactionType
      FROM voucher v
      WHERE v.InvoiceNumber = ?
      ORDER BY v.VoucherID ASC
    `;
    const allVouchers = await query(allVouchersSql, [resolvedInvoiceNumber]);

    if (allVouchers.length === 0) {
      return res.json({
        transactions: [],
        summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
      });
    }

    // Build a lookup map: VoucherID → { partyName, date, invoiceNo, transactionType }
    const voucherIds  = allVouchers.map((v) => v.VoucherID);
    const voucherMeta = {};
    allVouchers.forEach((v) => {
      voucherMeta[v.VoucherID] = {
        partyName:       v.PartyName       || "—",
        date:            v.VoucherDate     || "—",
        invoiceNo:       v.InvoiceNumber   || "—",
        transactionType: v.TransactionType || "—",
      };
    });

    const placeholders = voucherIds.map(() => "?").join(", ");

    // ── Step 3: summary KPIs across ALL vouchers for this InvoiceNumber ───
    const summarySql = `
      SELECT
        COALESCE(SUM(vd.total),    0) AS totalSales,
        COUNT(vd.id)                  AS totalTransactions,
        COALESCE(SUM(vd.quantity), 0) AS totalProductsSold
      FROM voucherdetails vd
      WHERE vd.voucher_id IN (${placeholders})
    `;
    const summaryRows = await query(summarySql, voucherIds);
    const kpiRow      = summaryRows[0];

    // ── Step 4: all line items across ALL vouchers for this InvoiceNumber ──
    const detailSql = `
      SELECT
        vd.id                            AS id,
        vd.voucher_id                    AS voucherId,
        COALESCE(vd.product,  '—')       AS productName,
        COALESCE(vd.price,     0)        AS ratePerUnit,
        COALESCE(vd.quantity,  0)        AS quantity,
        COALESCE(vd.total,     0)        AS amount,
        COALESCE(vd.hsn_code, '—')       AS hsnCode,
        COALESCE(vd.gst,       0)        AS gstPct,
        COALESCE(vd.sgst,      0)        AS sgst,
        COALESCE(vd.cgst,      0)        AS cgst,
        COALESCE(vd.igst,      0)        AS igst,
        COALESCE(vd.discount,  0)        AS discount
      FROM voucherdetails vd
      WHERE vd.voucher_id IN (${placeholders})
      ORDER BY vd.voucher_id ASC, vd.id ASC
    `;
    const detailRows = await query(detailSql, voucherIds);

    // Map each line item — pull partyName/date/invoiceNo/transactionType from
    // the voucher-level metadata so every row shows the correct TransactionType
    const transactions = detailRows.map((r) => {
      const meta = voucherMeta[r.voucherId] || {
        partyName: "—", date: "—", invoiceNo: resolvedInvoiceNumber, transactionType: "—",
      };
      return {
        id:              r.id,
        partyName:       meta.partyName,
        date:            meta.date,
        invoiceNo:       meta.invoiceNo,
        transactionType: meta.transactionType,
        productName:     r.productName || "—",
        ratePerUnit:     parseFloat(r.ratePerUnit) || 0,
        quantity:        parseFloat(r.quantity)    || 0,
        amount:          parseFloat(r.amount)      || 0,
        hsnCode:         r.hsnCode     || "—",
        gstPct:          parseFloat(r.gstPct)      || 0,
        sgst:            parseFloat(r.sgst)        || 0,
        cgst:            parseFloat(r.cgst)        || 0,
        igst:            parseFloat(r.igst)        || 0,
        discount:        parseFloat(r.discount)    || 0,
      };
    });

    const totalSales = parseFloat(kpiRow.totalSales)        || 0;
    const totalTx    = parseInt(kpiRow.totalTransactions)   || 0;
    const totalQty   = parseFloat(kpiRow.totalProductsSold) || 0;

    res.json({
      transactions,
      summary: {
        totalSales,
        totalTransactions:   totalTx,
        totalProductsSold:   totalQty,
        avgTransactionValue: totalTx > 0 ? totalSales / totalTx : 0,
      },
    });
  } catch (err) {
    console.error("[GSTR-3B /bill-transactions] ERROR:", err);
    res.status(500).json({ error: "Failed to fetch bill transactions.", detail: err.message });
  }
});

// ─── POST /api/gstr3b/download ───────────────────────────────────────────────
// Generates the GSTR-3B report as a downloadable PDF or Excel file, honoring
// the same filters used by /list (fromDate, toDate, search, filterType).
// Body: { format: "pdf" | "excel", fromDate, toDate, search, filterType }
router.post("/download", async (req, res) => {
  try {
    const {
      format,
      fromDate   = "",
      toDate     = "",
      search     = "",
      filterType = "all",
    } = req.body;

    const { clause, params } = buildWhere({ fromDate, toDate, search, filterType });

    const dataSql = `
      SELECT
        v.VoucherID,
        v.InvoiceNumber,
        DATE_FORMAT(v.Date, '%d/%m/%Y')          AS Date,
        v.PartyName,
        COALESCE(v.gstin,            'N/A')       AS gstin,
        COALESCE(v.bb_bc,            'b2c')       AS bb_bc,
        COALESCE(v.TransactionType,  'Sales')     AS TransactionType,
        COALESCE(
          NULLIF(TRIM(v.hsn_code), ''),
          (
            SELECT GROUP_CONCAT(
              DISTINCT vd.hsn_code
              ORDER BY vd.hsn_code
              SEPARATOR ', '
            )
            FROM voucherdetails vd
            WHERE vd.voucher_id = v.VoucherID
              AND vd.hsn_code IS NOT NULL
              AND TRIM(vd.hsn_code) != ''
          )
        )                                         AS hsn_code,
        COALESCE(v.TotalAmount, 0)                AS TotalAmount,
        COALESCE(v.BasicAmount, 0)                AS BasicAmount,
        COALESCE(v.SGSTAmount,  0)                AS SGSTAmount,
        COALESCE(v.CGSTAmount,  0)                AS CGSTAmount,
        COALESCE(v.IGSTAmount,  0)                AS IGSTAmount,
        COALESCE(
          (
            SELECT GROUP_CONCAT(
              DISTINCT CONCAT(FORMAT(vd.gst, 2), '%')
              ORDER BY vd.gst
              SEPARATOR ', '
            )
            FROM voucherdetails vd
            WHERE vd.voucher_id = v.VoucherID
              AND vd.gst IS NOT NULL
          ),
          '0.00%'
        ) AS gstPercentages
      FROM voucher v
      ${clause}
      ORDER BY v.Date DESC, v.VoucherID DESC
    `;

    const rows = await query(dataSql, params);

    const results = rows.map((r) => ({
      billNo:          r.InvoiceNumber   || "—",
      date:            r.Date            || "—",
      party:           r.PartyName       || "—",
      gstNo:           r.gstin           || "N/A",
      bbbc:            (r.bb_bc || "b2c").toLowerCase(),
      transactionType: r.TransactionType || "Sales",
      hsnCode:         r.hsn_code        || "—",
      billAmt:         parseFloat(r.TotalAmount)  || 0,
      taxableAmt:      parseFloat(r.BasicAmount)  || 0,
      sgst:            parseFloat(r.SGSTAmount)   || 0,
      cgst:            parseFloat(r.CGSTAmount)   || 0,
      igst:            parseFloat(r.IGSTAmount)   || 0,
      gst:             r.gstPercentages || "0.00%",
    }));

    const displayFrom = fromDate || "ALL";
    const displayTo   = toDate   || "ALL";

    /* ================== PDF EXPORT ================== */
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 30, layout: "landscape" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=GSTR3B_Report_${new Date().toISOString().split('T')[0]}.pdf`
      );

      doc.pipe(res);

      doc.fontSize(18).text("GSTR-3B Report", { align: "center" });
      doc.moveDown(1);

      doc.fontSize(10).text(`Period: ${displayFrom} to ${displayTo}`, { align: "center" });
      doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: "center" });
      doc.text(`Total Records: ${results.length}`, { align: "center" });
      doc.moveDown(2);

      const headers = [
        "Bill No", "Date", "Party", "GST No", "BB/BC",
        "Bill Amt", "Taxable Amt", "SGST", "CGST", "IGST"
      ];
      const widths = [80, 60, 130, 90, 45, 65, 70, 60, 60, 60];

      let x = 30;
      let y = 150;

      headers.forEach((h, i) => {
        doc.rect(x, y, widths[i], 25).fillAndStroke("#343a40", "black");
        doc.fillColor("white").font("Helvetica-Bold").fontSize(9)
          .text(h, x + 4, y + 8, { width: widths[i] - 8, align: "center" });
        doc.fillColor("black");
        x += widths[i];
      });

      y += 25;

      results.forEach((r) => {
        const row = [
          r.billNo, r.date, r.party, r.gstNo, r.bbbc.toUpperCase(),
          `₹${r.billAmt.toFixed(2)}`, `₹${r.taxableAmt.toFixed(2)}`,
          `₹${r.sgst.toFixed(2)}`, `₹${r.cgst.toFixed(2)}`, `₹${r.igst.toFixed(2)}`,
        ];

        x = 30;
        row.forEach((val, j) => {
          doc.rect(x, y, widths[j], 22).stroke();
          doc.font("Helvetica").fontSize(8)
            .text(String(val), x + 3, y + 7, { width: widths[j] - 6, align: "center" });
          x += widths[j];
        });

        y += 22;
        if (y > doc.page.height - 50) {
          doc.addPage({ layout: "landscape" });
          y = 60;
        }
      });

      const totalBillAmt = results.reduce((sum, r) => sum + r.billAmt, 0);
      const totalTaxable = results.reduce((sum, r) => sum + r.taxableAmt, 0);
      const totalGst     = results.reduce((sum, r) => sum + r.sgst + r.cgst + r.igst, 0);

      doc.moveDown(2);
      doc.fontSize(12).font("Helvetica-Bold").text("Summary", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica")
        .text(`Total Bill Amount: ₹${totalBillAmt.toFixed(2)}`, { align: "center" });
      doc.text(`Total Taxable Amount: ₹${totalTaxable.toFixed(2)}`, { align: "center" });
      doc.text(`Total GST Collected: ₹${totalGst.toFixed(2)}`, { align: "center" });
      doc.text(`Total Records: ${results.length}`, { align: "center" });

      doc.end();
      return;
    }

    /* ================== EXCEL EXPORT ================== */
    if (format === "excel") {
      const workbook = new excelJS.Workbook();
      const ws = workbook.addWorksheet("GSTR-3B");

      ws.columns = [
        { header: "Bill No", key: "billNo", width: 18 },
        { header: "Date", key: "date", width: 12 },
        { header: "Party", key: "party", width: 28 },
        { header: "GST No", key: "gstNo", width: 20 },
        { header: "BB/BC", key: "bbbc", width: 8 },
        { header: "Transaction Type", key: "transactionType", width: 16 },
        { header: "HSN Code", key: "hsnCode", width: 14 },
        { header: "Bill Amt", key: "billAmt", width: 14 },
        { header: "Taxable Amt", key: "taxableAmt", width: 14 },
        { header: "GST %", key: "gst", width: 10 },
        { header: "SGST", key: "sgst", width: 12 },
        { header: "CGST", key: "cgst", width: 12 },
        { header: "IGST", key: "igst", width: 12 }
      ];

      results.forEach((r) => {
        ws.addRow({
          billNo: r.billNo, date: r.date, party: r.party, gstNo: r.gstNo,
          bbbc: r.bbbc, transactionType: r.transactionType, hsnCode: r.hsnCode,
          billAmt: r.billAmt, taxableAmt: r.taxableAmt, gst: r.gst,
          sgst: r.sgst, cgst: r.cgst, igst: r.igst
        });
      });

      ws.addRow({});
      ws.addRow({
        party: "TOTAL",
        billAmt: results.reduce((s, r) => s + r.billAmt, 0),
        taxableAmt: results.reduce((s, r) => s + r.taxableAmt, 0),
        sgst: results.reduce((s, r) => s + r.sgst, 0),
        cgst: results.reduce((s, r) => s + r.cgst, 0),
        igst: results.reduce((s, r) => s + r.igst, 0)
      });

      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF343A40" } };
      headerRow.alignment = { horizontal: "center", vertical: "middle" };

      const summaryRow = ws.getRow(results.length + 3);
      summaryRow.font = { bold: true };
      summaryRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } };

      [ws.getColumn(8), ws.getColumn(9), ws.getColumn(11), ws.getColumn(12), ws.getColumn(13)].forEach((col) => {
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
        `attachment; filename=GSTR3B_Report_${new Date().toISOString().split('T')[0]}.xlsx`
      );

      await workbook.xlsx.write(res);
      return res.end();
    }

    res.status(400).json({ error: "Invalid format (pdf / excel)" });
  } catch (err) {
    console.error("[GSTR-3B /download] ERROR:", err);
    res.status(500).json({ error: "Failed to generate report.", detail: err.message });
  }
});


module.exports = router;




// GSTR-3B.js — Express router for GSTR-3B report API
// Mount in your app: app.use("/api/gstr3b", require("./routes/GSTR-3B"));
//
// Uses mysql2 (callback-based pool, NOT /promise).
// db is imported from ../db  (i.e. ledger-backend/db.js)

// const express = require("express");
// const router  = express.Router();
// const db      = require("../db"); // ← callback-based mysql2 pool

// // ─── Promisify db.query ───────────────────────────────────────────────────────
// function query(sql, params = []) {
//   return new Promise((resolve, reject) => {
//     db.query(sql, params, (err, results) => {
//       if (err) return reject(err);
//       resolve(results);
//     });
//   });
// }

// // ─── DIAGNOSTIC: run once on startup to find actual TransactionType values ───
// // Remove this block once you've confirmed the correct TransactionType value.
// (async () => {
//   try {
//     const rows = await query("SELECT DISTINCT TransactionType FROM voucher LIMIT 20");
//     console.log("=== DISTINCT TransactionType values in voucher table ===");
//     rows.forEach((r) => console.log(" •", JSON.stringify(r.TransactionType)));
//     console.log("=== Use one of the above values in buildWhere() below ===");
//   } catch (e) {
//     console.error("[GSTR-3B startup diagnostic]", e.message);
//   }
// })();

// // ─── helpers ──────────────────────────────────────────────────────────────────

// /**
//  * Build the WHERE clause shared by both /summary and /list.
//  *
//  * Only Sales transactions are returned (TransactionType = 'Sales').
//  */
// function buildWhere({ fromDate, toDate, search, filterType }) {
//   // ── Always filter to Sales invoices only ─────────────────────────────────
//   // TransactionType = 'Sales' excludes Receipt, Payment, Journal, Contra, Purchase.
//   // document_type IS NOT NULL ensures we only get actual invoice records
//   // (Tax Invoice / Bill of Supply), excluding Receipt/Payment entries that
//   // carry data_type = 'Sales' but have no document_type set.
//   const conditions = [
//     "v.TransactionType = 'Sales'",
//     "v.document_type IS NOT NULL",
//   ];
//   const params     = [];

//   // ── Date range ────────────────────────────────────────────────────────────
//   if (fromDate) {
//     conditions.push("DATE(v.Date) >= ?");
//     params.push(fromDate);
//   }
//   if (toDate) {
//     conditions.push("DATE(v.Date) <= ?");
//     params.push(toDate);
//   }

//   // ── Search ────────────────────────────────────────────────────────────────
//   if (search && search.trim()) {
//     const like = `%${search.trim()}%`;
//     conditions.push(
//       "(v.InvoiceNumber LIKE ? OR v.PartyName LIKE ? OR v.gstin LIKE ? OR v.hsn_code LIKE ?)"
//     );
//     params.push(like, like, like, like);
//   }

//   // ── Chip filters ──────────────────────────────────────────────────────────
//   if (filterType === "b2b") {
//     conditions.push("LOWER(v.bb_bc) = 'b2b'");
//   } else if (filterType === "b2c") {
//     conditions.push("LOWER(v.bb_bc) = 'b2c'");
//   } else if (filterType === "5gst") {
//     conditions.push(`EXISTS (
//       SELECT 1 FROM voucherdetails vd
//       WHERE vd.voucher_id = v.VoucherID AND vd.gst = 5
//     )`);
//   } else if (filterType === "0gst") {
//     conditions.push(`NOT EXISTS (
//       SELECT 1 FROM voucherdetails vd
//       WHERE vd.voucher_id = v.VoucherID AND vd.gst > 0
//     )`);
//   } else if (filterType === "withGstin") {
//     conditions.push("v.gstin IS NOT NULL AND v.gstin != '' AND v.gstin != 'N/A'");
//   } else if (filterType === "noGstin") {
//     conditions.push("(v.gstin IS NULL OR v.gstin = '' OR v.gstin = 'N/A')");
//   }

//   return {
//     clause: "WHERE " + conditions.join(" AND "),
//     params,
//   };
// }

// // ─── GET /api/gstr3b/summary ──────────────────────────────────────────────────
// router.get("/summary", async (req, res) => {
//   try {
//     const { fromDate, toDate } = req.query;
//     console.log("[GSTR-3B /summary] query params:", { fromDate, toDate });

//     const { clause, params } = buildWhere({ fromDate, toDate });

//     const sql = `
//       SELECT
//         COALESCE(SUM(v.TotalAmount), 0)  AS totalBillAmount,
//         COALESCE(SUM(v.BasicAmount), 0)  AS taxableAmount,
//         COUNT(v.VoucherID)               AS totalTransactions,
//         COALESCE(
//           SUM(
//             COALESCE(v.SGSTAmount, 0) +
//             COALESCE(v.CGSTAmount, 0) +
//             COALESCE(v.IGSTAmount, 0)
//           ), 0
//         )                                AS totalGSTCollected
//       FROM voucher v
//       ${clause}
//     `;
//     console.log("[GSTR-3B /summary] SQL:", sql);
//     console.log("[GSTR-3B /summary] params:", params);

//     const rows = await query(sql, params);
//     const row  = rows[0];
//     console.log("[GSTR-3B /summary] result:", row);

//     res.json({
//       totalBillAmount:   parseFloat(row.totalBillAmount)   || 0,
//       taxableAmount:     parseFloat(row.taxableAmount)     || 0,
//       totalTransactions: parseInt(row.totalTransactions)   || 0,
//       totalGSTCollected: parseFloat(row.totalGSTCollected) || 0,
//     });
//   } catch (err) {
//     console.error("[GSTR-3B /summary] ERROR:", err);
//     res.status(500).json({ error: "Failed to fetch summary data.", detail: err.message });
//   }
// });

// // ─── GET /api/gstr3b/list ─────────────────────────────────────────────────────
// router.get("/list", async (req, res) => {
//   try {
//     const {
//       page       = 1,
//       limit      = 10,
//       search     = "",
//       fromDate   = "",
//       toDate     = "",
//       filterType = "all",
//     } = req.query;
//     console.log("[GSTR-3B /list] query params:", { page, limit, search, fromDate, toDate, filterType });

//     const pageNum  = Math.max(1, parseInt(page));
//     const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
//     const offset   = (pageNum - 1) * pageSize;

//     const { clause, params } = buildWhere({ fromDate, toDate, search, filterType });

//     // ── count ──────────────────────────────────────────────────────────────
//     const countSql   = `SELECT COUNT(v.VoucherID) AS total FROM voucher v ${clause}`;
//     console.log("[GSTR-3B /list] countSql:", countSql);
//     const countRows  = await query(countSql, params);
//     const totalRecords = parseInt(countRows[0].total) || 0;
//     const totalPages   = Math.max(1, Math.ceil(totalRecords / pageSize));
//     console.log("[GSTR-3B /list] totalRecords:", totalRecords);

//     // ── data ───────────────────────────────────────────────────────────────
//     const dataSql = `
//       SELECT
//         v.VoucherID,
//         v.InvoiceNumber,
//         DATE_FORMAT(v.Date, '%d/%m/%Y')   AS Date,
//         v.PartyName,
//         COALESCE(v.gstin,  'N/A')         AS gstin,
//         COALESCE(v.bb_bc,  'b2c')         AS bb_bc,
//         COALESCE(
//           NULLIF(TRIM(v.hsn_code), ''),
//           (
//             SELECT GROUP_CONCAT(
//               DISTINCT vd.hsn_code
//               ORDER BY vd.hsn_code
//               SEPARATOR ', '
//             )
//             FROM voucherdetails vd
//             WHERE vd.voucher_id = v.VoucherID
//               AND vd.hsn_code IS NOT NULL
//               AND TRIM(vd.hsn_code) != ''
//           )
//         )                                 AS hsn_code,
//         COALESCE(v.TotalAmount, 0)        AS TotalAmount,
//         COALESCE(v.BasicAmount, 0)        AS BasicAmount,
//         COALESCE(v.SGSTAmount,  0)        AS SGSTAmount,
//         COALESCE(v.CGSTAmount,  0)        AS CGSTAmount,
//         COALESCE(v.IGSTAmount,  0)        AS IGSTAmount,
//         COALESCE(
//           (
//             SELECT GROUP_CONCAT(
//               DISTINCT CONCAT(FORMAT(vd.gst, 2), '%')
//               ORDER BY vd.gst
//               SEPARATOR ', '
//             )
//             FROM voucherdetails vd
//             WHERE vd.voucher_id = v.VoucherID
//               AND vd.gst IS NOT NULL
//           ),
//           '0.00%'
//         ) AS gstPercentages
//       FROM voucher v
//       ${clause}
//       ORDER BY v.Date DESC, v.VoucherID DESC
//       LIMIT ? OFFSET ?
//     `;
//     const dataParams = [...params, pageSize, offset];
//     console.log("[GSTR-3B /list] dataSql:", dataSql);

//     const rows = await query(dataSql, dataParams);
//     console.log("[GSTR-3B /list] rows returned:", rows.length);

//     const data = rows.map((r) => ({
//       id:         r.VoucherID,
//       billNo:     r.InvoiceNumber || "—",
//       date:       r.Date         || "—",
//       party:      r.PartyName    || "—",
//       gstNo:      r.gstin,
//       bbbc:       (r.bb_bc || "b2c").toLowerCase(),
//       hsnCode:    r.hsn_code     || "—",
//       billAmt:    parseFloat(r.TotalAmount)  || 0,
//       taxableAmt: parseFloat(r.BasicAmount)  || 0,
//       sgst:       parseFloat(r.SGSTAmount)   || 0,
//       cgst:       parseFloat(r.CGSTAmount)   || 0,
//       igst:       parseFloat(r.IGSTAmount)   || 0,
//       gst:        r.gstPercentages,
//     }));

//     res.json({ data, totalRecords, totalPages, currentPage: pageNum });
//   } catch (err) {
//     console.error("[GSTR-3B /list] ERROR:", err);
//     res.status(500).json({ error: "Failed to fetch bill list.", detail: err.message });
//   }
// });

// // ─── GET /api/gstr3b/transactions ─────────────────────────────────────────────
// // When a PARTY NAME is clicked — shows ALL voucherdetails rows for the party
// // across ALL their invoices (all time, or filtered by date range on the detail page).
// //
// // Query params: billNo (required — used to resolve the party), fromDate, toDate
// router.get("/transactions", async (req, res) => {
//   try {
//     const { billNo, fromDate, toDate } = req.query;
//     console.log("[GSTR-3B /transactions] query params:", { billNo, fromDate, toDate });

//     if (!billNo || !billNo.trim()) {
//       return res.status(400).json({ error: "billNo is required." });
//     }

//     // ── Step 1: resolve PartyName from the clicked InvoiceNumber ─────────
//     const anchorSql = `
//       SELECT v.PartyName, v.PartyID
//       FROM voucher v
//       WHERE v.InvoiceNumber = ?
//         AND v.TransactionType = 'Sales'
//         AND v.document_type IS NOT NULL
//       LIMIT 1
//     `;
//     console.log("[GSTR-3B /transactions] anchorSql:", anchorSql);
//     const anchorRows = await query(anchorSql, [billNo.trim()]);
//     console.log("[GSTR-3B /transactions] anchor rows:", anchorRows.length);

//     if (anchorRows.length === 0) {
//       return res.json({
//         transactions: [],
//         summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
//       });
//     }

//     const partyName = anchorRows[0].PartyName;
//     const partyID   = anchorRows[0].PartyID;
//     console.log("[GSTR-3B /transactions] party:", { partyName, partyID });

//     // ── Step 2: find ALL VoucherIDs for this party (Sales only) ──────────
//     const voucherConditions = partyID
//       ? ["v.PartyID = ?", "v.TransactionType = 'Sales'", "v.document_type IS NOT NULL"]
//       : ["v.PartyName = ?", "v.TransactionType = 'Sales'", "v.document_type IS NOT NULL"];
//     const voucherParams = partyID ? [partyID] : [partyName];

//     if (fromDate) {
//       voucherConditions.push("DATE(v.Date) >= ?");
//       voucherParams.push(fromDate);
//     }
//     if (toDate) {
//       voucherConditions.push("DATE(v.Date) <= ?");
//       voucherParams.push(toDate);
//     }

//     const voucherSql = `
//       SELECT
//         v.VoucherID,
//         v.PartyName,
//         DATE_FORMAT(v.Date, '%d/%m/%Y') AS VoucherDate,
//         v.InvoiceNumber
//       FROM voucher v
//       WHERE ${voucherConditions.join(" AND ")}
//       ORDER BY v.Date DESC, v.VoucherID DESC
//     `;
//     console.log("[GSTR-3B /transactions] voucherSql:", voucherSql);
//     const voucherRows = await query(voucherSql, voucherParams);
//     console.log("[GSTR-3B /transactions] party vouchers found:", voucherRows.length);

//     if (voucherRows.length === 0) {
//       return res.json({
//         transactions: [],
//         summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
//       });
//     }

//     const voucherIds = voucherRows.map((v) => v.VoucherID);
//     const voucherMeta = {};
//     voucherRows.forEach((v) => {
//       voucherMeta[v.VoucherID] = {
//         partyName: v.PartyName     || "—",
//         date:      v.VoucherDate   || "—",
//         invoiceNo: v.InvoiceNumber || "—",
//       };
//     });

//     // ── Step 3: fetch ALL voucherdetails for those VoucherIDs ─────────────
//     const placeholders = voucherIds.map(() => "?").join(", ");

//     const summarySql = `
//       SELECT
//         COALESCE(SUM(vd.total),    0) AS totalSales,
//         COUNT(vd.id)                  AS totalTransactions,
//         COALESCE(SUM(vd.quantity), 0) AS totalProductsSold
//       FROM voucherdetails vd
//       WHERE vd.voucher_id IN (${placeholders})
//     `;
//     console.log("[GSTR-3B /transactions] summarySql:", summarySql);
//     const summaryRows = await query(summarySql, voucherIds);
//     const kpiRow      = summaryRows[0];

//     const detailSql = `
//       SELECT
//         vd.id                        AS id,
//         vd.voucher_id                AS voucherId,
//         COALESCE(vd.product,  '—')   AS productName,
//         COALESCE(vd.price,     0)    AS ratePerUnit,
//         COALESCE(vd.quantity,  0)    AS quantity,
//         COALESCE(vd.total,     0)    AS amount,
//         COALESCE(vd.hsn_code, '—')  AS hsnCode,
//         COALESCE(vd.gst,       0)    AS gstPct,
//         COALESCE(vd.sgst,      0)    AS sgst,
//         COALESCE(vd.cgst,      0)    AS cgst,
//         COALESCE(vd.igst,      0)    AS igst,
//         COALESCE(vd.discount,  0)    AS discount
//       FROM voucherdetails vd
//       WHERE vd.voucher_id IN (${placeholders})
//       ORDER BY vd.voucher_id DESC, vd.id ASC
//     `;
//     console.log("[GSTR-3B /transactions] detailSql:", detailSql);
//     const detailRows = await query(detailSql, voucherIds);
//     console.log("[GSTR-3B /transactions] line items returned:", detailRows.length);

//     const transactions = detailRows.map((r) => {
//       const meta = voucherMeta[r.voucherId] || { partyName: partyName || "—", date: "—", invoiceNo: "—" };
//       return {
//         id:          r.id,
//         partyName:   meta.partyName,
//         date:        meta.date,
//         invoiceNo:   meta.invoiceNo,
//         productName: r.productName || "—",
//         ratePerUnit: parseFloat(r.ratePerUnit) || 0,
//         quantity:    parseFloat(r.quantity)    || 0,
//         amount:      parseFloat(r.amount)      || 0,
//         hsnCode:     r.hsnCode     || "—",
//         gstPct:      parseFloat(r.gstPct)      || 0,
//         sgst:        parseFloat(r.sgst)        || 0,
//         cgst:        parseFloat(r.cgst)        || 0,
//         igst:        parseFloat(r.igst)        || 0,
//         discount:    parseFloat(r.discount)    || 0,
//       };
//     });

//     const totalSales = parseFloat(kpiRow.totalSales)        || 0;
//     const totalTx    = parseInt(kpiRow.totalTransactions)   || 0;
//     const totalQty   = parseFloat(kpiRow.totalProductsSold) || 0;

//     res.json({
//       transactions,
//       summary: {
//         totalSales,
//         totalTransactions:   totalTx,
//         totalProductsSold:   totalQty,
//         avgTransactionValue: totalTx > 0 ? totalSales / totalTx : 0,
//       },
//     });
//   } catch (err) {
//     console.error("[GSTR-3B /transactions] ERROR:", err);
//     res.status(500).json({ error: "Failed to fetch transactions.", detail: err.message });
//   }
// });

// // ─── GET /api/gstr3b/bill-transactions ────────────────────────────────────────
// // NEW — When a BILL NO. is clicked — shows only the voucherdetails rows for
// // that single InvoiceNumber (no date filter needed; a bill is a fixed document).
// //
// // Query params: billNo (required)
// router.get("/bill-transactions", async (req, res) => {
//   try {
//     const { billNo } = req.query;
//     console.log("[GSTR-3B /bill-transactions] query params:", { billNo });

//     if (!billNo || !billNo.trim()) {
//       return res.status(400).json({ error: "billNo is required." });
//     }

//     // ── Step 1: resolve VoucherID + header info ───────────────────────────
//     // Prefer voucherId (exact row) when provided; fall back to InvoiceNumber.
//     const { voucherId: voucherIdParam } = req.query;

//     let voucherSql;
//     let voucherBindParams;

//     if (voucherIdParam) {
//       // Exact lookup by primary key — no ambiguity
//       voucherSql = `
//         SELECT
//           v.VoucherID,
//           v.PartyName,
//           DATE_FORMAT(v.Date, '%d/%m/%Y') AS VoucherDate,
//           v.InvoiceNumber,
//           COALESCE(v.TransactionType, '—') AS TransactionType
//         FROM voucher v
//         WHERE v.VoucherID = ?
//         LIMIT 1
//       `;
//       voucherBindParams = [parseInt(voucherIdParam)];
//     } else {
//       voucherSql = `
//         SELECT
//           v.VoucherID,
//           v.PartyName,
//           DATE_FORMAT(v.Date, '%d/%m/%Y') AS VoucherDate,
//           v.InvoiceNumber,
//           COALESCE(v.TransactionType, '—') AS TransactionType
//         FROM voucher v
//         WHERE v.InvoiceNumber = ?
//           AND v.TransactionType = 'Sales'
//           AND v.document_type IS NOT NULL
//         LIMIT 1
//       `;
//       voucherBindParams = [billNo.trim()];
//     }
//     console.log("[GSTR-3B /bill-transactions] voucherSql:", voucherSql);
//     const voucherRows = await query(voucherSql, voucherBindParams);
//     console.log("[GSTR-3B /bill-transactions] voucher rows:", voucherRows.length);

//     if (voucherRows.length === 0) {
//       return res.json({
//         transactions: [],
//         summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
//       });
//     }

//     const voucher   = voucherRows[0];
//     const voucherId = voucher.VoucherID;

//     // ── Step 2: summary KPIs for this single voucher ──────────────────────
//     const summarySql = `
//       SELECT
//         COALESCE(SUM(vd.total),    0) AS totalSales,
//         COUNT(vd.id)                  AS totalTransactions,
//         COALESCE(SUM(vd.quantity), 0) AS totalProductsSold
//       FROM voucherdetails vd
//       WHERE vd.voucher_id = ?
//     `;
//     console.log("[GSTR-3B /bill-transactions] summarySql:", summarySql);
//     const summaryRows = await query(summarySql, [voucherId]);
//     const kpiRow      = summaryRows[0];

//     // ── Step 3: line items for this single voucher ────────────────────────
//     const detailSql = `
//       SELECT
//         vd.id                        AS id,
//         vd.voucher_id                AS voucherId,
//         COALESCE(vd.product,  '—')   AS productName,
//         COALESCE(vd.price,     0)    AS ratePerUnit,
//         COALESCE(vd.quantity,  0)    AS quantity,
//         COALESCE(vd.total,     0)    AS amount,
//         COALESCE(vd.hsn_code, '—')  AS hsnCode,
//         COALESCE(vd.gst,       0)    AS gstPct,
//         COALESCE(vd.sgst,      0)    AS sgst,
//         COALESCE(vd.cgst,      0)    AS cgst,
//         COALESCE(vd.igst,      0)    AS igst,
//         COALESCE(vd.discount,  0)    AS discount,
//         COALESCE(v.TransactionType, '—') AS transactionType
//       FROM voucherdetails vd
//       JOIN voucher v ON v.VoucherID = vd.voucher_id
//       WHERE vd.voucher_id = ?
//       ORDER BY vd.id ASC
//     `;
//     console.log("[GSTR-3B /bill-transactions] detailSql:", detailSql);
//     const detailRows = await query(detailSql, [voucherId]);
//     console.log("[GSTR-3B /bill-transactions] line items returned:", detailRows.length);

//     const transactions = detailRows.map((r) => ({
//       id:              r.id,
//       partyName:       voucher.PartyName     || "—",
//       date:            voucher.VoucherDate   || "—",
//       invoiceNo:       voucher.InvoiceNumber || "—",
//       transactionType: r.transactionType     || voucher.TransactionType || "—",
//       productName:     r.productName || "—",
//       ratePerUnit:     parseFloat(r.ratePerUnit) || 0,
//       quantity:        parseFloat(r.quantity)    || 0,
//       amount:          parseFloat(r.amount)      || 0,
//       hsnCode:         r.hsnCode     || "—",
//       gstPct:          parseFloat(r.gstPct)      || 0,
//       sgst:            parseFloat(r.sgst)        || 0,
//       cgst:            parseFloat(r.cgst)        || 0,
//       igst:            parseFloat(r.igst)        || 0,
//       discount:        parseFloat(r.discount)    || 0,
//     }));

//     const totalSales = parseFloat(kpiRow.totalSales)        || 0;
//     const totalTx    = parseInt(kpiRow.totalTransactions)   || 0;
//     const totalQty   = parseFloat(kpiRow.totalProductsSold) || 0;

//     res.json({
//       transactions,
//       summary: {
//         totalSales,
//         totalTransactions:   totalTx,
//         totalProductsSold:   totalQty,
//         avgTransactionValue: totalTx > 0 ? totalSales / totalTx : 0,
//       },
//     });
//   } catch (err) {
//     console.error("[GSTR-3B /bill-transactions] ERROR:", err);
//     res.status(500).json({ error: "Failed to fetch bill transactions.", detail: err.message });
//   }
// });

// module.exports = router;