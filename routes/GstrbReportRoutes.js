// GSTR-3B.js — Express router for GSTR-3B report API
// Mount in your app: app.use("/api/gstr3b", require("./routes/GSTR-3B"));
//
// Uses mysql2 (callback-based pool, NOT /promise).
// db is imported from ../db  (i.e. ledger-backend/db.js)

const express = require("express");
const router  = express.Router();
const db      = require("../db"); // ← callback-based mysql2 pool

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
    console.log("=== DISTINCT TransactionType values in voucher table ===");
    rows.forEach((r) => console.log(" •", JSON.stringify(r.TransactionType)));
    console.log("=== Use one of the above values in buildWhere() below ===");
  } catch (e) {
    console.error("[GSTR-3B startup diagnostic]", e.message);
  }
})();

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the WHERE clause shared by both /summary and /list.
 *
 * ⚠️  TransactionType filter is REMOVED by default so all records are returned.
 *     Once you see the correct value from the startup log above, add it back:
 *     e.g.  conditions.push("v.TransactionType = 'Sales'");
 */
function buildWhere({ fromDate, toDate, search, filterType }) {
  const conditions = [];
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
  } else if (filterType === "withGstin") {
    conditions.push("v.gstin IS NOT NULL AND v.gstin != '' AND v.gstin != 'N/A'");
  } else if (filterType === "noGstin") {
    conditions.push("(v.gstin IS NULL OR v.gstin = '' OR v.gstin = 'N/A')");
  }

  return {
    clause: conditions.length ? "WHERE " + conditions.join(" AND ") : "",
    params,
  };
}

// ─── GET /api/gstr3b/summary ──────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    console.log("[GSTR-3B /summary] query params:", { fromDate, toDate });

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
    console.log("[GSTR-3B /summary] SQL:", sql);
    console.log("[GSTR-3B /summary] params:", params);

    const rows = await query(sql, params);
    const row  = rows[0];
    console.log("[GSTR-3B /summary] result:", row);

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
    console.log("[GSTR-3B /list] query params:", { page, limit, search, fromDate, toDate, filterType });

    const pageNum  = Math.max(1, parseInt(page));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * pageSize;

    const { clause, params } = buildWhere({ fromDate, toDate, search, filterType });

    // ── count ──────────────────────────────────────────────────────────────
    const countSql   = `SELECT COUNT(v.VoucherID) AS total FROM voucher v ${clause}`;
    console.log("[GSTR-3B /list] countSql:", countSql);
    const countRows  = await query(countSql, params);
    const totalRecords = parseInt(countRows[0].total) || 0;
    const totalPages   = Math.max(1, Math.ceil(totalRecords / pageSize));
    console.log("[GSTR-3B /list] totalRecords:", totalRecords);

    // ── data ───────────────────────────────────────────────────────────────
    const dataSql = `
      SELECT
        v.VoucherID,
        v.InvoiceNumber,
        DATE_FORMAT(v.Date, '%d/%m/%Y')   AS Date,
        v.PartyName,
        COALESCE(v.gstin,  'N/A')         AS gstin,
        COALESCE(v.bb_bc,  'b2c')         AS bb_bc,
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
        )                                 AS hsn_code,
        COALESCE(v.TotalAmount, 0)        AS TotalAmount,
        COALESCE(v.BasicAmount, 0)        AS BasicAmount,
        COALESCE(v.SGSTAmount,  0)        AS SGSTAmount,
        COALESCE(v.CGSTAmount,  0)        AS CGSTAmount,
        COALESCE(v.IGSTAmount,  0)        AS IGSTAmount,
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
    console.log("[GSTR-3B /list] dataSql:", dataSql);

    const rows = await query(dataSql, dataParams);
    console.log("[GSTR-3B /list] rows returned:", rows.length);

    const data = rows.map((r) => ({
      id:         r.VoucherID,
      billNo:     r.InvoiceNumber || "—",
      date:       r.Date         || "—",
      party:      r.PartyName    || "—",
      gstNo:      r.gstin,
      bbbc:       (r.bb_bc || "b2c").toLowerCase(),
      hsnCode:    r.hsn_code     || "—",
      billAmt:    parseFloat(r.TotalAmount)  || 0,
      taxableAmt: parseFloat(r.BasicAmount)  || 0,
      sgst:       parseFloat(r.SGSTAmount)   || 0,
      cgst:       parseFloat(r.CGSTAmount)   || 0,
      igst:       parseFloat(r.IGSTAmount)   || 0,
      gst:        r.gstPercentages,
    }));

    res.json({ data, totalRecords, totalPages, currentPage: pageNum });
  } catch (err) {
    console.error("[GSTR-3B /list] ERROR:", err);
    res.status(500).json({ error: "Failed to fetch bill list.", detail: err.message });
  }
});

// ─── GET /api/gstr3b/transactions ─────────────────────────────────────────────
// When a Bill No. is clicked, shows ALL voucherdetails rows for the PARTY
// that created that bill — across ALL their invoices (matching yesterday's
// working behaviour: 9 records for John Doe across multiple invoice numbers).
//
// Strategy:
//   Step 1 — resolve PartyName from the clicked InvoiceNumber.
//   Step 2 — find ALL VoucherIDs for that PartyName (all their invoices).
//   Step 3 — fetch ALL voucherdetails for those VoucherIDs.
//
// Column names verified from DESC voucherdetails:
//   product (name), price (rate per unit), quantity, total (line amount)
// Query params: billNo (required), fromDate (optional), toDate (optional)
router.get("/transactions", async (req, res) => {
  try {
    const { billNo, fromDate, toDate } = req.query;
    console.log("[GSTR-3B /transactions] query params:", { billNo, fromDate, toDate });

    if (!billNo || !billNo.trim()) {
      return res.status(400).json({ error: "billNo is required." });
    }

    // ── Step 1: resolve PartyName from the clicked InvoiceNumber ─────────
    const anchorSql = `
      SELECT v.PartyName, v.PartyID
      FROM voucher v
      WHERE v.InvoiceNumber = ?
      LIMIT 1
    `;
    console.log("[GSTR-3B /transactions] anchorSql:", anchorSql);
    const anchorRows = await query(anchorSql, [billNo.trim()]);
    console.log("[GSTR-3B /transactions] anchor rows:", anchorRows.length);

    if (anchorRows.length === 0) {
      return res.json({
        transactions: [],
        summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
      });
    }

    const partyName = anchorRows[0].PartyName;
    const partyID   = anchorRows[0].PartyID;
    console.log("[GSTR-3B /transactions] party:", { partyName, partyID });

    // ── Step 2: find ALL VoucherIDs for this party ────────────────────────
    // Match by PartyID if available, fall back to PartyName match.
    // Optional date range applied here so the party's invoice list can be
    // date-filtered if the user changes the date range on the detail page.
    const voucherConditions = partyID
      ? ["v.PartyID = ?"]
      : ["v.PartyName = ?"];
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
    console.log("[GSTR-3B /transactions] voucherSql:", voucherSql);
    const voucherRows = await query(voucherSql, voucherParams);
    console.log("[GSTR-3B /transactions] party vouchers found:", voucherRows.length);

    if (voucherRows.length === 0) {
      return res.json({
        transactions: [],
        summary: { totalSales: 0, totalTransactions: 0, totalProductsSold: 0, avgTransactionValue: 0 },
      });
    }

    // Build lookup map: VoucherID → { partyName, date, invoiceNo }
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
    console.log("[GSTR-3B /transactions] summarySql:", summarySql);
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
    console.log("[GSTR-3B /transactions] detailSql:", detailSql);
    const detailRows = await query(detailSql, voucherIds);
    console.log("[GSTR-3B /transactions] line items returned:", detailRows.length);

    // Merge voucher metadata into each detail row
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

module.exports = router;