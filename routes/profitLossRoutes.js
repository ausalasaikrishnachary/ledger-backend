const express = require("express");
const router = express.Router();
const db = require("../db");

/**
 * Helper to execute a query using Promise (compatible with mysql2 pool callbacks)
 */
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

/**
 * GET /api/reports/profit-loss
 * Query Params:
 *  - fromDate (YYYY-MM-DD)
 *  - toDate (YYYY-MM-DD)
 *
 * Scope:
 *  Total Sales: Sum of TotalAmount from voucher where TransactionType = 'Sales'
 *               (EXCLUDING 'stock transfer')
 *               and status NOT IN ('Cancelled', 'canceled')
 *  Total Purchase: Sum of TotalAmount from voucher where TransactionType = 'Purchase'
 *                  (EXCLUDING 'stock inward')
 *                  and status NOT IN ('Cancelled', 'canceled')
 *  Profit / Loss = Total Sales - Total Purchase
 */
router.get("/profit-loss", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    let salesQuery = `
      SELECT COALESCE(SUM(v.TotalAmount), 0) AS totalSales,
             COUNT(v.VoucherID) AS countSales
      FROM voucher v
      WHERE v.TransactionType = 'Sales'
        AND (v.status NOT IN ('Cancelled', 'canceled') OR v.status IS NULL OR v.status = '')
    `;
    const salesParams = [];

    if (fromDate) {
      salesQuery += ` AND DATE(v.Date) >= ?`;
      salesParams.push(fromDate);
    }
    if (toDate) {
      salesQuery += ` AND DATE(v.Date) <= ?`;
      salesParams.push(toDate);
    }

    let purchaseQuery = `
      SELECT COALESCE(SUM(v.TotalAmount), 0) AS totalPurchase,
             COUNT(v.VoucherID) AS countPurchase
      FROM voucher v
      WHERE v.TransactionType = 'Purchase'
        AND (v.status NOT IN ('Cancelled', 'canceled') OR v.status IS NULL OR v.status = '')
    `;
    const purchaseParams = [];

    if (fromDate) {
      purchaseQuery += ` AND DATE(v.Date) >= ?`;
      purchaseParams.push(fromDate);
    }
    if (toDate) {
      purchaseQuery += ` AND DATE(v.Date) <= ?`;
      purchaseParams.push(toDate);
    }

    const [salesResult, purchaseResult] = await Promise.all([
      runQuery(salesQuery, salesParams),
      runQuery(purchaseQuery, purchaseParams),
    ]);

    const totalSales = parseFloat(salesResult[0]?.totalSales || 0);
    const totalPurchase = parseFloat(purchaseResult[0]?.totalPurchase || 0);
    const countSales = parseInt(salesResult[0]?.countSales || 0, 10);
    const countPurchase = parseInt(purchaseResult[0]?.countPurchase || 0, 10);

    const diff = totalSales - totalPurchase;
    let profit = 0;
    let loss = 0;
    let resultType = "NO_PROFIT_NO_LOSS";

    // Rounded to 2 decimal places to avoid float precision issues
    const roundedDiff = Math.round(diff * 100) / 100;

    if (roundedDiff > 0) {
      profit = roundedDiff;
      loss = 0;
      resultType = "PROFIT";
    } else if (roundedDiff < 0) {
      profit = 0;
      loss = Math.abs(roundedDiff);
      resultType = "LOSS";
    } else {
      profit = 0;
      loss = 0;
      resultType = "NO_PROFIT_NO_LOSS";
    }

    return res.json({
      success: true,
      fromDate: fromDate || null,
      toDate: toDate || null,
      totalSales,
      totalPurchase,
      profit,
      loss,
      resultType,
      countSales,
      countPurchase,
    });
  } catch (error) {
    console.error("Error calculating Profit & Loss:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to calculate Profit & Loss",
      details: error.message,
    });
  }
});

module.exports = router;
