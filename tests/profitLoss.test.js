/**
 * Profit & Loss Report Tests
 * 
 * Tests the quantity-based COGS calculation for the P&L report.
 * Uses a dedicated test connection with transaction rollback for isolation.
 */

const mysql = require("mysql2");

// Create a dedicated test connection (not using the shared pool)
let testDb;

// Unique prefix for all test data
const TEST_PREFIX = `TEST_PL_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}_`;

// Helper to run queries with promises
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

// Cleanup: Remove all test data
async function cleanupTestData() {
  await runQuery(
    `DELETE FROM voucherdetails WHERE voucher_id IN (SELECT VoucherID FROM voucher WHERE InvoiceNumber LIKE ?)`,
    [`${TEST_PREFIX}%`]
  );
  await runQuery(`DELETE FROM voucher WHERE InvoiceNumber LIKE ?`, [`${TEST_PREFIX}%`]);
  await runQuery(`DELETE FROM products WHERE goods_name LIKE ?`, [`${TEST_PREFIX}%`]);
  await runQuery(`DELETE FROM expensive WHERE note LIKE ?`, [`${TEST_PREFIX}%`]);
}

// Simulate the P&L calculation logic (same as in profitLossRoutes.js)
async function calculateProfitLoss(fromDate, toDate) {
  let salesQuery = `
    SELECT COALESCE(SUM(v.TotalAmount), 0) AS totalSales,
           COUNT(v.VoucherID) AS countSales
    FROM voucher v
    WHERE v.TransactionType = 'Sales'
      AND (v.status NOT IN ('Cancelled', 'canceled') OR v.status IS NULL OR v.status = '')
  `;
  const salesParams = [];
  if (fromDate) { salesQuery += ` AND DATE(v.Date) >= ?`; salesParams.push(fromDate); }
  if (toDate) { salesQuery += ` AND DATE(v.Date) <= ?`; salesParams.push(toDate); }

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
  if (fromDate) { cogsQuery += ` AND DATE(v.Date) >= ?`; cogsParams.push(fromDate); }
  if (toDate) { cogsQuery += ` AND DATE(v.Date) <= ?`; cogsParams.push(toDate); }

  let expenseQuery = `
    SELECT COALESCE(SUM(amount), 0) AS totalExpenses,
           COUNT(*) AS countExpenses
    FROM expensive
    WHERE (status NOT IN ('Cancelled', 'canceled') OR status IS NULL OR status = '')
  `;
  const expenseParams = [];
  if (fromDate) { expenseQuery += ` AND DATE(\`date\`) >= ?`; expenseParams.push(fromDate); }
  if (toDate) { expenseQuery += ` AND DATE(\`date\`) <= ?`; expenseParams.push(toDate); }

  const [salesResult, cogsResult, expenseResult] = await Promise.all([
    runQuery(salesQuery, salesParams),
    runQuery(cogsQuery, cogsParams),
    runQuery(expenseQuery, expenseParams),
  ]);

  const totalSales = parseFloat(salesResult[0]?.totalSales || 0);
  const totalCOGS = parseFloat(cogsResult[0]?.totalCOGS || 0);
  const totalUnitsSold = parseFloat(cogsResult[0]?.totalUnitsSold || 0);
  const totalExpenses = parseFloat(expenseResult[0]?.totalExpenses || 0);

  const grossProfit = totalSales - totalCOGS;
  const netProfit = grossProfit - totalExpenses;

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    totalCOGS: Math.round(totalCOGS * 100) / 100,
    totalUnitsSold: Math.round(totalUnitsSold * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
  };
}

// ==================== TESTS ====================

describe("Profit & Loss Report - Quantity-Based COGS", () => {
  beforeAll(async () => {
    // Create a dedicated connection for testing
    testDb = mysql.createConnection({
      host: "localhost",
      user: "root",
      password: "",
      database: "ledger",
      port: 3306
    });

    // Clean up any leftover test data from previous runs using shared db
    const sharedDb = require("../db");
    await new Promise((resolve, reject) => {
      sharedDb.query(
        `DELETE FROM voucherdetails WHERE voucher_id IN (SELECT VoucherID FROM voucher WHERE InvoiceNumber LIKE 'TEST_PL_%')`,
        (err) => (err ? reject(err) : resolve())
      );
    });
    await new Promise((resolve, reject) => {
      sharedDb.query(`DELETE FROM voucher WHERE InvoiceNumber LIKE 'TEST_PL_%'`, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((resolve, reject) => {
      sharedDb.query(`DELETE FROM products WHERE goods_name LIKE 'TEST_PL_%'`, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((resolve, reject) => {
      sharedDb.query(`DELETE FROM expensive WHERE note LIKE 'TEST_PL_%'`, (err) => (err ? reject(err) : resolve()));
    });
  });

  afterAll(async () => {
    // Final cleanup
    await cleanupTestData();
    if (testDb) {
      testDb.end();
    }
  });

  beforeEach(async () => {
    // Start a transaction that will be rolled back after each test
    await new Promise((resolve, reject) => {
      testDb.beginTransaction((err) => (err ? reject(err) : resolve()));
    });
  });

  afterEach(async () => {
    // Rollback the transaction - this undoes all test data changes
    await new Promise((resolve, reject) => {
      testDb.rollback((err) => (err ? reject(err) : resolve()));
    });
  });

  // Helper to insert test product
  async function insertProduct(name, purchasePrice, sellingPrice) {
    const result = await runQuery(
      `INSERT INTO products (goods_name, purchase_price, price, unit, hsn_code) VALUES (?, ?, ?, ?, ?)`,
      [`${TEST_PREFIX}${name}`, purchasePrice, sellingPrice, "pcs", "1234"]
    );
    return result.insertId;
  }

  // Helper to insert test voucher
  async function insertVoucher(type, totalAmount, date, invoiceNumber) {
    const result = await runQuery(
      `INSERT INTO voucher (TransactionType, TotalAmount, Date, status, PartyName, InvoiceNumber) VALUES (?, ?, ?, ?, ?, ?)`,
      [type, totalAmount, date, "Paid", "Test Party", `${TEST_PREFIX}${invoiceNumber}`]
    );
    return result.insertId;
  }

  // Helper to insert test voucher details
  async function insertVoucherDetails(voucherId, product, productId, quantity, price, total, transactionType) {
    const result = await runQuery(
      `INSERT INTO voucherdetails (voucher_id, product, product_id, quantity, price, total, transaction_type) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [voucherId, `${TEST_PREFIX}${product}`, productId, quantity, price, total, transactionType]
    );
    return result.insertId;
  }

  // Helper to insert test expense
  async function insertExpense(amount, date, note) {
    const result = await runQuery(
      `INSERT INTO expensive (staff_name, category, amount, date, status, note) VALUES (?, ?, ?, ?, ?, ?)`,
      ["Test Staff", "Office Supplies", amount, date, "approved", `${TEST_PREFIX}${note}`]
    );
    return result.insertId;
  }

  test("Scenario 1: Full sale - Purchase 5 units for ₹5,900, Sell 5 units for ₹7,080", async () => {
    const productId = await insertProduct("PRODUCT", 1180, 1416);
    const purchaseVoucherId = await insertVoucher("Purchase", 5900, "2025-01-15", "PURCH_001");
    await insertVoucherDetails(purchaseVoucherId, "PRODUCT", productId, 5, 1180, 5900, "Purchase");
    const salesVoucherId = await insertVoucher("Sales", 7080, "2025-01-20", "SALES_001");
    await insertVoucherDetails(salesVoucherId, "PRODUCT", productId, 5, 1416, 7080, "Sales");
    const salesVoucher2Id = await insertVoucher("Sales", 2832, "2025-01-25", "SALES_002");
    await insertVoucherDetails(salesVoucher2Id, "PRODUCT", productId, 2, 1416, 2832, "Sales");
    await insertExpense(500, "2025-01-22", "expense");

    const result = await calculateProfitLoss("2025-01-01", "2025-01-31");
    expect(result.totalSales).toBe(9912);
    expect(result.totalCOGS).toBe(8260);
    expect(result.totalUnitsSold).toBe(7);
    expect(result.grossProfit).toBe(1652);
    expect(result.netProfit).toBe(1152);
  });

  test("Scenario 2: Partial sale - Purchase 5 units for ₹5,900, Sell 2 units for ₹2,832", async () => {
    const productId = await insertProduct("PARTIAL", 1180, 1416);
    const purchaseVoucherId = await insertVoucher("Purchase", 5900, "2025-01-15", "PURCH_P01");
    await insertVoucherDetails(purchaseVoucherId, "PARTIAL", productId, 5, 1180, 5900, "Purchase");
    const salesVoucherId = await insertVoucher("Sales", 2832, "2025-01-20", "SALES_P01");
    await insertVoucherDetails(salesVoucherId, "PARTIAL", productId, 2, 1416, 2832, "Sales");

    const result = await calculateProfitLoss("2025-01-01", "2025-01-31");
    expect(result.totalSales).toBe(2832);
    expect(result.totalCOGS).toBe(2360);
    expect(result.grossProfit).toBe(472);
  });

  test("Scenario 3: Date range filtering - only transactions in range are counted", async () => {
    const productId = await insertProduct("PRODUCT", 1180, 1416);
    const purchaseVoucherId = await insertVoucher("Purchase", 5900, "2025-01-15", "PURCH_001");
    await insertVoucherDetails(purchaseVoucherId, "PRODUCT", productId, 5, 1180, 5900, "Purchase");
    const salesVoucherId = await insertVoucher("Sales", 7080, "2025-01-20", "SALES_001");
    await insertVoucherDetails(salesVoucherId, "PRODUCT", productId, 5, 1416, 7080, "Sales");
    const salesVoucher2Id = await insertVoucher("Sales", 2832, "2025-01-25", "SALES_002");
    await insertVoucherDetails(salesVoucher2Id, "PRODUCT", productId, 2, 1416, 2832, "Sales");

    const result = await calculateProfitLoss("2025-01-15", "2025-01-20");
    expect(result.totalSales).toBe(7080);
    expect(result.totalCOGS).toBe(5900);
    expect(result.grossProfit).toBe(1180);
  });

  test("Scenario 4: Unsold inventory is not expensed", async () => {
    const productId = await insertProduct("UNSOLD", 1000, 1500);
    const purchaseVoucherId = await insertVoucher("Purchase", 10000, "2025-01-15", "PURCH_U01");
    await insertVoucherDetails(purchaseVoucherId, "UNSOLD", productId, 10, 1000, 10000, "Purchase");

    const result = await calculateProfitLoss("2025-01-01", "2025-01-31");
    expect(result.totalSales).toBe(0);
    expect(result.totalCOGS).toBe(0);
    expect(result.grossProfit).toBe(0);
  });

  test("Scenario 5: Multiple products with different costs", async () => {
    const productA = await insertProduct("A", 1180, 1416);
    const productB = await insertProduct("B", 500, 700);
    const salesA = await insertVoucher("Sales", 4248, "2025-01-20", "SALES_A01");
    await insertVoucherDetails(salesA, "A", productA, 3, 1416, 4248, "Sales");
    const salesB = await insertVoucher("Sales", 2800, "2025-01-21", "SALES_B01");
    await insertVoucherDetails(salesB, "B", productB, 4, 700, 2800, "Sales");

    const result = await calculateProfitLoss("2025-01-01", "2025-01-31");
    expect(result.totalSales).toBe(7048);
    expect(result.totalCOGS).toBe(5540);
    expect(result.grossProfit).toBe(1508);
  });

  test("Scenario 6: Operating expenses reduce net profit", async () => {
    const productId = await insertProduct("PRODUCT", 1180, 1416);
    const purchaseVoucherId = await insertVoucher("Purchase", 5900, "2025-01-15", "PURCH_001");
    await insertVoucherDetails(purchaseVoucherId, "PRODUCT", productId, 5, 1180, 5900, "Purchase");
    const salesVoucherId = await insertVoucher("Sales", 7080, "2025-01-20", "SALES_001");
    await insertVoucherDetails(salesVoucherId, "PRODUCT", productId, 5, 1416, 7080, "Sales");
    const salesVoucher2Id = await insertVoucher("Sales", 2832, "2025-01-25", "SALES_002");
    await insertVoucherDetails(salesVoucher2Id, "PRODUCT", productId, 2, 1416, 2832, "Sales");
    await insertExpense(500, "2025-01-22", "expense1");
    await insertExpense(1000, "2025-01-23", "expense2");

    const result = await calculateProfitLoss("2025-01-01", "2025-01-31");
    expect(result.totalExpenses).toBe(1500);
    expect(result.netProfit).toBe(152);
  });

  test("Scenario 7: No transactions in date range returns zero", async () => {
    const productId = await insertProduct("PRODUCT", 1180, 1416);
    const purchaseVoucherId = await insertVoucher("Purchase", 5900, "2025-01-15", "PURCH_001");
    await insertVoucherDetails(purchaseVoucherId, "PRODUCT", productId, 5, 1180, 5900, "Purchase");
    const salesVoucherId = await insertVoucher("Sales", 7080, "2025-01-20", "SALES_001");
    await insertVoucherDetails(salesVoucherId, "PRODUCT", productId, 5, 1416, 7080, "Sales");

    const result = await calculateProfitLoss("2025-02-01", "2025-02-28");
    expect(result.totalSales).toBe(0);
    expect(result.totalCOGS).toBe(0);
    expect(result.grossProfit).toBe(0);
    expect(result.netProfit).toBe(0);
  });
});
