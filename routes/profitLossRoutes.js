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
 *  COGS: Sum of (quantity * unit_cost) for all products sold in the period
 *        Uses products.purchase_price as the unit cost (existing costing method)
 *  Gross Profit = Total Sales - COGS
 *  Net Profit = Gross Profit - Operating Expenses + Other Income
 */
router.get("/profit-loss", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // --- 1. Total Sales (header level, for invoice count and date filtering) ---
    let salesHeaderQuery = `
      SELECT COALESCE(SUM(v.TotalAmount), 0) AS totalSales,
             COUNT(v.VoucherID) AS countSales
      FROM voucher v
      WHERE v.TransactionType = 'Sales'
        AND (v.status NOT IN ('Cancelled', 'canceled') OR v.status IS NULL OR v.status = '')
    `;
    const salesParams = [];

    if (fromDate) {
      salesHeaderQuery += ` AND DATE(v.Date) >= ?`;
      salesParams.push(fromDate);
    }
    if (toDate) {
      salesHeaderQuery += ` AND DATE(v.Date) <= ?`;
      salesParams.push(toDate);
    }

    // --- 2. COGS: For each product sold in the period, calculate quantity * unit_cost ---
    // Use products.purchase_price as the unit cost (the existing costing method in the app)
    let cogsQuery = `
      SELECT COALESCE(SUM(vd.quantity * COALESCE(p.purchase_price, 0)), 0) AS totalCOGS,
             COALESCE(SUM(vd.quantity), 0) AS totalUnitsSold
      FROM voucherdetails vd
      JOIN voucher v ON v.VoucherID = vd.voucher_id
      LEFT JOIN products p ON p.goods_name = vd.product
      WHERE v.TransactionType = 'Sales'
        AND (v.status NOT IN ('Cancelled', 'canceled') OR v.status IS NULL OR v.status = '')
        AND vd.transaction_type = 'Sales'
    `;
    const cogsParams = [];

    if (fromDate) {
      cogsQuery += ` AND DATE(v.Date) >= ?`;
      cogsParams.push(fromDate);
    }
    if (toDate) {
      cogsQuery += ` AND DATE(v.Date) <= ?`;
      cogsParams.push(toDate);
    }

    // --- 3. Total Purchases (for reference, but NOT used as COGS) ---
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

    // --- 4. Operating Expenses ---
    let expenseQuery = `
      SELECT COALESCE(SUM(amount), 0) AS totalExpenses,
             COUNT(*) AS countExpenses
      FROM expensive
      WHERE (status NOT IN ('Cancelled', 'canceled') OR status IS NULL OR status = '')
    `;
    const expenseParams = [];

    if (fromDate) {
      expenseQuery += ` AND DATE(\`date\`) >= ?`;
      expenseParams.push(fromDate);
    }
    if (toDate) {
      expenseQuery += ` AND DATE(\`date\`) <= ?`;
      expenseParams.push(toDate);
    }

    // --- 5. Sales Returns (credit notes) ---
    let salesReturnQuery = `
      SELECT COALESCE(SUM(TotalAmount), 0) AS totalSalesReturns,
             COUNT(*) AS countSalesReturns
      FROM voucher
      WHERE TransactionType = 'Sales'
        AND (status = 'Cancelled' OR status = 'canceled')
    `;
    const salesReturnParams = [];

    if (fromDate) {
      salesReturnQuery += ` AND DATE(Date) >= ?`;
      salesReturnParams.push(fromDate);
    }
    if (toDate) {
      salesReturnQuery += ` AND DATE(Date) <= ?`;
      salesReturnParams.push(toDate);
    }

    // --- 6. Purchase Returns (debit notes) ---
    let purchaseReturnQuery = `
      SELECT COALESCE(SUM(TotalAmount), 0) AS totalPurchaseReturns,
             COUNT(*) AS countPurchaseReturns
      FROM voucher
      WHERE TransactionType = 'Purchase'
        AND (status = 'Cancelled' OR status = 'canceled')
    `;
    const purchaseReturnParams = [];

    if (fromDate) {
      purchaseReturnQuery += ` AND DATE(Date) >= ?`;
      purchaseReturnParams.push(fromDate);
    }
    if (toDate) {
      purchaseReturnQuery += ` AND DATE(Date) <= ?`;
      purchaseReturnParams.push(toDate);
    }

    // Execute all queries in parallel
    const [salesResult, cogsResult, purchaseResult, expenseResult, salesReturnResult, purchaseReturnResult] =
      await Promise.all([
        runQuery(salesHeaderQuery, salesParams),
        runQuery(cogsQuery, cogsParams),
        runQuery(purchaseQuery, purchaseParams),
        runQuery(expenseQuery, expenseParams),
        runQuery(salesReturnQuery, salesReturnParams),
        runQuery(purchaseReturnQuery, purchaseReturnParams),
      ]);

    const totalSales = parseFloat(salesResult[0]?.totalSales || 0);
    const totalCOGS = parseFloat(cogsResult[0]?.totalCOGS || 0);
    const totalUnitsSold = parseFloat(cogsResult[0]?.totalUnitsSold || 0);
    const totalPurchase = parseFloat(purchaseResult[0]?.totalPurchase || 0);
    const totalExpenses = parseFloat(expenseResult[0]?.totalExpenses || 0);
    const totalSalesReturns = parseFloat(salesReturnResult[0]?.totalSalesReturns || 0);
    const totalPurchaseReturns = parseFloat(purchaseReturnResult[0]?.totalPurchaseReturns || 0);
    const countSales = parseInt(salesResult[0]?.countSales || 0, 10);
    const countPurchase = parseInt(purchaseResult[0]?.countPurchase || 0, 10);
    const countExpenses = parseInt(expenseResult[0]?.countExpenses || 0, 10);
    const countSalesReturns = parseInt(salesReturnResult[0]?.countSalesReturns || 0, 10);
    const countPurchaseReturns = parseInt(purchaseReturnResult[0]?.countPurchaseReturns || 0, 10);

    // Calculate Gross Profit = Net Sales - COGS
    const grossProfit = totalSales - totalCOGS;

    // Calculate Net Profit = Gross Profit - Operating Expenses
    // (Other income/expense tables may not exist in this schema, so we use what's available)
    const netProfit = grossProfit - totalExpenses;

    // Determine result type
    let profit = 0;
    let loss = 0;
    let resultType = "NO_PROFIT_NO_LOSS";

    const roundedNetProfit = Math.round(netProfit * 100) / 100;

    if (roundedNetProfit > 0) {
      profit = roundedNetProfit;
      loss = 0;
      resultType = "PROFIT";
    } else if (roundedNetProfit < 0) {
      profit = 0;
      loss = Math.abs(roundedNetProfit);
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
      totalSales: Math.round(totalSales * 100) / 100,
      totalPurchase: Math.round(totalPurchase * 100) / 100,
      totalCOGS: Math.round(totalCOGS * 100) / 100,
      totalUnitsSold: Math.round(totalUnitsSold * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalSalesReturns: Math.round(totalSalesReturns * 100) / 100,
      totalPurchaseReturns: Math.round(totalPurchaseReturns * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      loss: Math.round(loss * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      resultType,
      countSales,
      countPurchase,
      countExpenses,
      countSalesReturns,
      countPurchaseReturns,
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
