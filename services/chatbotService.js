// Chatbot service: maps approved handler names to parameterized queries.
// READ-ONLY. Never accepts SQL from the client.
const db = require('../db');

function runQ(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

const num = (v) => Number(v || 0);

function tableResult(rows, summary) {
  return { summary, data: rows, message: rows.length ? undefined : 'No records found for the selected criteria.' };
}

const HANDLERS = {
  // ===== CUSTOMER =====
  async getCustomerDetails(p) {
    const rows = await runQ(
      `SELECT id, name, business_name, email, mobile_number, gstin, address, billing_city AS city, credit_limit, terms_of_payment, balance_amount, unpaid_amount
       FROM accounts WHERE id = ? AND role IN ('retailer','customer','supplier') LIMIT 1`, [p.customerId]);
    if (!rows.length) return { message: 'Customer not found.', data: [] };
    return { summary: { customer: rows[0].name, city: rows[0].city, creditLimit: num(rows[0].credit_limit) }, data: rows };
  },
  async getCustomerOutstanding(p) {
    const rows = await runQ(
      `SELECT a.id, a.name, COALESCE(a.unpaid_amount,0) AS unpaid, COALESCE(a.balance_amount,0) AS balance,
              COALESCE(SUM(v.balance_amount),0) AS openInvoiceBalance
       FROM accounts a LEFT JOIN voucher v ON v.PartyID = a.id AND v.TransactionType='Sales'
            AND (v.status='' OR v.status IS NULL OR v.status NOT IN ('Cancelled','canceled'))
       WHERE a.id = ? GROUP BY a.id`, [p.customerId]);
    if (!rows.length) return { message: 'Customer not found.', data: [] };
    return { summary: { customer: rows[0].name, outstanding: num(rows[0].openInvoiceBalance) }, data: rows };
  },
  async getCustomerInvoices(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, TotalAmount, paid_amount, balance_amount, status, saleType
       FROM voucher WHERE TransactionType='Sales' AND PartyID = ?
       ORDER BY Date DESC LIMIT 200`, [p.customerId]);
    const total = rows.reduce((s, r) => s + num(r.TotalAmount), 0);
    return tableResult(rows, { count: rows.length, total: total.toFixed(2) });
  },
  async getCustomerPayments(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, TotalAmount, paid_amount, payment_method
       FROM voucher WHERE TransactionType='Sales' AND PartyID = ? AND COALESCE(paid_amount,0) > 0
       ORDER BY Date DESC LIMIT 200`, [p.customerId]);
    const total = rows.reduce((s, r) => s + num(r.paid_amount), 0);
    return tableResult(rows, { count: rows.length, totalReceived: total.toFixed(2) });
  },
  async getCustomerLastPayment(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, paid_amount, payment_method
       FROM voucher WHERE TransactionType='Sales' AND PartyID = ? AND COALESCE(paid_amount,0) > 0
       ORDER BY Date DESC, VoucherID DESC LIMIT 1`, [p.customerId]);
    if (!rows.length) return { message: 'No payments found for this customer.', data: [] };
    return { summary: { lastPayment: num(rows[0].paid_amount), date: rows[0].Date, mode: rows[0].payment_method }, data: rows };
  },
  async getCustomerTotalSales(p) {
    const rows = await runQ(
      `SELECT COALESCE(SUM(TotalAmount),0) AS totalSales, COUNT(*) AS invoices
       FROM voucher WHERE TransactionType='Sales' AND PartyID = ?
         AND (status='' OR status IS NULL OR status NOT IN ('Cancelled','canceled'))`, [p.customerId]);
    return { summary: { totalSales: num(rows[0].totalSales).toFixed(2), invoices: rows[0].invoices }, data: rows };
  },
  async getCustomerCreditPeriod(p) {
    const rows = await runQ(
      `SELECT id, name, terms_of_payment, credit_limit FROM accounts WHERE id = ? LIMIT 1`, [p.customerId]);
    if (!rows.length) return { message: 'Customer not found.', data: [] };
    const cps = await runQ(`SELECT credit_period, credit_percentage FROM credit_periods`);
    return { summary: { customer: rows[0].name, terms: rows[0].terms_of_payment, creditLimit: num(rows[0].credit_limit) }, data: cps };
  },

  // ===== LEDGER =====
  async getCustomerLedger(p) {
    const { customerId, fromDate, toDate } = p;
    const opening = await runQ(
      `SELECT COALESCE(SUM(TotalAmount),0) AS billed, COALESCE(SUM(paid_amount),0) AS received
       FROM voucher WHERE PartyID = ? AND TransactionType='Sales' AND DATE(Date) < ?`, [customerId, fromDate]);
    const openingBalance = num(opening[0].billed) - num(opening[0].received);
    const rows = await runQ(
      `SELECT Date, InvoiceNumber, VchNo, TransactionType, saleType, TotalAmount, paid_amount, payment_method, status
       FROM voucher WHERE PartyID = ? AND TransactionType IN ('Sales','Purchase') AND DATE(Date) BETWEEN ? AND ?
       ORDER BY Date ASC, VoucherID ASC`, [customerId, fromDate, toDate]);
    let bal = openingBalance, totalDebit = 0, totalCredit = 0;
    const data = rows.map((r) => {
      const debit = r.TransactionType === 'Sales' ? num(r.TotalAmount) : 0;
      const credit = num(r.paid_amount);
      totalDebit += debit; totalCredit += credit;
      bal += debit - credit;
      return { date: r.Date, reference: r.InvoiceNumber || r.VchNo, type: r.TransactionType, debit, credit, balance: bal.toFixed(2), mode: r.payment_method, status: r.status };
    });
    return {
      summary: { customerId, fromDate, toDate, openingBalance: openingBalance.toFixed(2), totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2), closingBalance: bal.toFixed(2) },
      data, message: data.length ? undefined : 'No ledger records for the selected period.',
    };
  },
  async getOutstandingTotal() { return outstandingInner(); },

  // ===== INVOICE =====
  async searchInvoice(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, PartyName, TotalAmount, paid_amount, balance_amount, status, saleType, payment_method, due_date
       FROM voucher WHERE TransactionType='Sales' AND (InvoiceNumber = ? OR VchNo = ?) LIMIT 1`, [p.invoiceNumber, p.invoiceNumber]);
    if (!rows.length) return { message: 'Invoice not found.', data: [] };
    return { summary: { invoice: rows[0].InvoiceNumber, customer: rows[0].PartyName, total: num(rows[0].TotalAmount), balance: num(rows[0].balance_amount) }, data: rows };
  },
  async getInvoiceItems(p) {
    const rows = await runQ(
      `SELECT product, quantity, price, gst, cgst, sgst, igst, total, hsn_code
       FROM voucherdetails WHERE InvoiceNumber = ?`, [p.invoiceNumber]);
    return tableResult(rows, { items: rows.length, total: rows.reduce((s, r) => s + num(r.total), 0).toFixed(2) });
  },
  async getInvoiceTotal(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, TotalAmount, Subtotal, TaxAmount, paid_amount, balance_amount, status FROM voucher
       WHERE InvoiceNumber = ? AND TransactionType='Sales' LIMIT 1`, [p.invoiceNumber]);
    if (!rows.length) return { message: 'Invoice not found.', data: [] };
    const r = rows[0];
    return { summary: { invoice: r.InvoiceNumber, subtotal: num(r.Subtotal), tax: num(r.TaxAmount), total: num(r.TotalAmount), paid: num(r.paid_amount), balance: num(r.balance_amount), status: r.status }, data: rows };
  },
  async getUnpaidInvoices() {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, PartyName, TotalAmount, paid_amount, balance_amount, due_date
       FROM voucher WHERE TransactionType='Sales' AND COALESCE(balance_amount,0) > 0
       ORDER BY Date DESC LIMIT 200`);
    return tableResult(rows, { count: rows.length, totalDue: rows.reduce((s, r) => s + num(r.balance_amount), 0).toFixed(2) });
  },
  async getInvoicesByDateRange(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, PartyName, TotalAmount, paid_amount, balance_amount, status FROM voucher
       WHERE TransactionType='Sales' AND DATE(Date) BETWEEN ? AND ? ORDER BY Date DESC LIMIT 300`, [p.fromDate, p.toDate]);
    return tableResult(rows, { count: rows.length, total: rows.reduce((s, r) => s + num(r.TotalAmount), 0).toFixed(2) });
  },
  async getInvoicesBySaleType(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, PartyName, TotalAmount, saleType, status FROM voucher
       WHERE TransactionType='Sales' AND saleType = ? ORDER BY Date DESC LIMIT 300`, [p.saleType]);
    return tableResult(rows, { count: rows.length, total: rows.reduce((s, r) => s + num(r.TotalAmount), 0).toFixed(2) });
  },

  // ===== SALES =====
  async getTodaysSales() { return salesFor(`DATE(Date) = CURDATE()`, []); },
  async getThisWeekSales() { return salesFor(`YEARWEEK(Date,1) = YEARWEEK(CURDATE(),1)`, []); },
  async getThisMonthSales() { return salesFor(`YEAR(Date)=YEAR(CURDATE()) AND MONTH(Date)=MONTH(CURDATE())`, []); },
  async getThisYearSales() { return salesFor(`YEAR(Date)=YEAR(CURDATE())`, []); },
  async getSalesByRange(p) { return salesFor(`DATE(Date) BETWEEN ? AND ?`, [p.fromDate, p.toDate]); },
  async getRevenueByCustomer() {
    const rows = await runQ(
      `SELECT PartyName, COUNT(*) invoices, SUM(TotalAmount) total FROM voucher
       WHERE TransactionType='Sales' GROUP BY PartyName ORDER BY total DESC LIMIT 50`);
    return tableResult(rows, { count: rows.length });
  },
  async getRevenueByProduct() {
    const rows = await runQ(
      `SELECT product, SUM(quantity) qty, SUM(total) total FROM voucherdetails
       WHERE transaction_type='Sales' GROUP BY product ORDER BY total DESC LIMIT 50`);
    return tableResult(rows, { count: rows.length });
  },
  async getTopCustomers() {
    const rows = await runQ(
      `SELECT PartyName, SUM(TotalAmount) total, COUNT(*) invoices FROM voucher
       WHERE TransactionType='Sales' GROUP BY PartyName ORDER BY total DESC LIMIT 10`);
    return tableResult(rows, { top: rows.length });
  },
  async getTopProducts() {
    const rows = await runQ(
      `SELECT product, SUM(quantity) qty, SUM(total) total FROM voucherdetails
       WHERE transaction_type='Sales' GROUP BY product ORDER BY qty DESC LIMIT 10`);
    return tableResult(rows, { top: rows.length });
  },
  async getAverageInvoiceValue() {
    const rows = await runQ(
      `SELECT COUNT(*) invoices, COALESCE(AVG(TotalAmount),0) avgValue, COALESCE(SUM(TotalAmount),0) total FROM voucher
       WHERE TransactionType='Sales' AND (status='' OR status IS NULL OR status NOT IN ('Cancelled','canceled'))`);
    return { summary: { invoices: rows[0].invoices, averageInvoiceValue: num(rows[0].avgValue).toFixed(2), total: num(rows[0].total).toFixed(2) }, data: rows };
  },

  // ===== PROFIT & LOSS (reuse existing business rule) =====
  async getProfitLoss(p) {
    const sales = await runQ(
      `SELECT COALESCE(SUM(TotalAmount),0) t FROM voucher WHERE TransactionType='Sales'
       AND (status='' OR status IS NULL OR status NOT IN ('Cancelled','canceled'))
       AND DATE(Date) BETWEEN ? AND ?`, [p.fromDate, p.toDate]);
    const purchase = await runQ(
      `SELECT COALESCE(SUM(TotalAmount),0) t FROM voucher WHERE TransactionType='Purchase'
       AND (status='' OR status IS NULL OR status NOT IN ('Cancelled','canceled'))
       AND DATE(Date) BETWEEN ? AND ?`, [p.fromDate, p.toDate]);
    const expenses = await runQ(
      `SELECT COALESCE(SUM(amount),0) t FROM expensive
       WHERE DATE(date) BETWEEN ? AND ? AND (status IS NULL OR status NOT IN ('Cancelled','Rejected','rejected'))`, [p.fromDate, p.toDate]).catch(() => [{ t: 0 }]);
    const totalSales = num(sales[0].t), totalPurchase = num(purchase[0].t), totalExpenses = num(expenses[0].t);
    const grossProfit = totalSales - totalPurchase;
    const netProfit = grossProfit - totalExpenses;
    return {
      summary: {
        period: `${p.fromDate} to ${p.toDate}`,
        totalRevenue: totalSales.toFixed(2),
        totalPurchase: totalPurchase.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        grossProfit: grossProfit.toFixed(2),
        net: netProfit.toFixed(2),
        resultType: netProfit > 0 ? 'PROFIT' : netProfit < 0 ? 'LOSS' : 'NO_PROFIT_NO_LOSS',
        note: 'COGS/gross margin uses voucher purchase totals; expense table may be limited on this environment.',
      },
      data: [],
    };
  },

  // ===== INVENTORY =====
  async getInventory() {
    const rows = await runQ(
      `SELECT id, goods_name, hsn_code, unit, price, purchase_price, mrp, gst_rate, hsn_code as hsn FROM products LIMIT 500`);
    return tableResult(rows, { products: rows.length });
  },
  async getStockForProduct(p) {
    const rows = await runQ(
      `SELECT batch_number, quantity, opening_stock, stock_in, stock_out, cost_price, selling_price, mrp, barcode
       FROM batches WHERE product_id = ?`, [p.productId]);
    const qty = rows.reduce((s, r) => s + num(r.quantity), 0);
    return tableResult(rows, { productId: p.productId, totalQuantity: qty });
  },
  async getOutOfStock() {
    const rows = await runQ(
      `SELECT p.id, p.goods_name, COALESCE(SUM(b.quantity),0) qty FROM products p
       LEFT JOIN batches b ON b.product_id = p.id GROUP BY p.id HAVING qty <= 0 LIMIT 200`);
    return tableResult(rows, { count: rows.length });
  },
  async getLowStock() {
    const rows = await runQ(
      `SELECT p.id, p.goods_name, COALESCE(SUM(b.quantity),0) qty, p.min_stock_alert
       FROM products p LEFT JOIN batches b ON b.product_id = p.id GROUP BY p.id
       HAVING qty > 0 AND qty <= COALESCE(p.min_stock_alert,0) LIMIT 200`);
    return tableResult(rows, { count: rows.length });
  },
  async getHighestStock() {
    const rows = await runQ(
      `SELECT p.id, p.goods_name, COALESCE(SUM(b.quantity),0) qty FROM products p
       LEFT JOIN batches b ON b.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 20`);
    return tableResult(rows, { count: rows.length });
  },
  async getStockByCategory() {
    const rows = await runQ(
      `SELECT c.category_name AS category, COALESCE(SUM(b.quantity),0) qty, COUNT(DISTINCT p.id) products
       FROM categories c LEFT JOIN products p ON p.category_id = c.id LEFT JOIN batches b ON b.product_id = p.id
       GROUP BY c.id ORDER BY qty DESC`);
    return tableResult(rows, { count: rows.length });
  },

  // ===== PURCHASE =====
  async getTodaysPurchases() { return purchaseFor(`DATE(Date) = CURDATE()`, []); },
  async getPurchasesByRange(p) { return purchaseFor(`DATE(Date) BETWEEN ? AND ?`, [p.fromDate, p.toDate]); },
  async getTotalPurchaseValue() { return purchaseFor(`1=1`, []); },

  // ===== PAYMENTS =====
  async getTodaysPayments() { return paymentsFor(`DATE(Date) = CURDATE()`, []); },
  async getPaymentsByRange(p) { return paymentsFor(`DATE(Date) BETWEEN ? AND ?`, [p.fromDate, p.toDate]); },

  // ===== RECEIPTS =====
  async getOutstandingReceivables() { return outstandingInner(); },
  async getCustomerWiseOutstanding() {
    const rows = await runQ(
      `SELECT PartyName, SUM(TotalAmount) billed, SUM(paid_amount) paid, SUM(balance_amount) outstanding, COUNT(*) invoices
       FROM voucher WHERE TransactionType='Sales' AND COALESCE(balance_amount,0) > 0
       GROUP BY PartyName ORDER BY outstanding DESC LIMIT 100`);
    return tableResult(rows, { count: rows.length, totalOutstanding: rows.reduce((s, r) => s + num(r.outstanding), 0).toFixed(2) });
  },

  // ===== EXPENSES =====
  async getTodaysExpenses() { return expensesFor(`DATE(date) = CURDATE()`, []); },
  async getMonthlyExpenses() { return expensesFor(`YEAR(date)=YEAR(CURDATE()) AND MONTH(date)=MONTH(CURDATE())`, []); },
  async getExpensesByCategory() {
    const rows = await runQ(
      `SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) entries FROM expensive GROUP BY category ORDER BY total DESC`);
    return tableResult(rows, { total: rows.reduce((s, r) => s + num(r.total), 0).toFixed(2) });
  },

  // ===== CREDIT NOTES =====
  async getCreditNotes() {
    const rows = await runQ(
      `SELECT InvoiceNumber, VchNo, Date, PartyName, TotalAmount, paid_amount, status FROM voucher
       WHERE document_type LIKE '%Credit%' OR note LIKE '%credit%' ORDER BY Date DESC LIMIT 200`)
      .catch(() => []);
    return tableResult(rows, { count: rows.length, total: rows.reduce((s, r) => s + num(r.TotalAmount), 0).toFixed(2) });
  },
  async getCreditNotesTotal() {
    const r = await runQ(
      `SELECT COALESCE(SUM(TotalAmount),0) t, COUNT(*) c FROM voucher WHERE document_type LIKE '%Credit%'`).catch(() => [{ t: 0, c: 0 }]);
    return { summary: { totalCreditNotes: num(r[0].t).toFixed(2), count: r[0].c }, data: r };
  },

  async getMonthlyProfitLoss() {
    const rows = await runQ(
      `SELECT DATE_FORMAT(Date,'%Y-%m') month,
              SUM(IF(TransactionType='Sales',TotalAmount,0)) revenue,
              SUM(IF(TransactionType='Purchase',TotalAmount,0)) purchase,
              SUM(IF(TransactionType='Sales',TotalAmount,0)) - SUM(IF(TransactionType='Purchase',TotalAmount,0)) net
       FROM voucher WHERE TransactionType IN ('Sales','Purchase')
         AND (status='' OR status IS NULL OR status NOT IN ('Cancelled','canceled'))
       GROUP BY month ORDER BY month DESC LIMIT 12`);
    return tableResult(rows, { months: rows.length });
  },
  async getRevenueVsExpenses(p) {
    const rev = await runQ(
      `SELECT COALESCE(SUM(TotalAmount),0) t FROM voucher WHERE TransactionType='Sales' AND (status='' OR status IS NULL OR status NOT IN ('Cancelled','canceled')) AND DATE(Date) BETWEEN ? AND ?`, [p.fromDate, p.toDate]);
    const exp = await runQ(
      `SELECT COALESCE(SUM(amount),0) t FROM expensive WHERE DATE(date) BETWEEN ? AND ?`, [p.fromDate, p.toDate]).catch(() => [{ t: 0 }]);
    return { summary: { period: `${p.fromDate} to ${p.toDate}`, revenue: num(rev[0].t).toFixed(2), expenses: num(exp[0].t).toFixed(2), difference: (num(rev[0].t) - num(exp[0].t)).toFixed(2) }, data: [] };
  },
  async getProfitByProduct(p) {
    const rows = await runQ(
      `SELECT vd.product, SUM(vd.total) sales, SUM(vd.quantity) qty
       FROM voucherdetails vd JOIN voucher v ON v.VoucherID = vd.voucher_id
       WHERE vd.transaction_type='Sales' AND DATE(v.Date) BETWEEN ? AND ?
       GROUP BY vd.product ORDER BY sales DESC LIMIT 50`, [p.fromDate, p.toDate]);
    return tableResult(rows, { count: rows.length, note: 'Product-level profit requires cost data; showing sales contribution.' });
  },
  async getSalesComparison(p) {
    // uses fromDate..toDate vs the immediately preceding period of equal length
    const r = await runQ(
      `SELECT SUM(IF(DATE(Date) BETWEEN ? AND ?, TotalAmount, 0)) AS currentPeriod,
              SUM(IF(DATE(Date) BETWEEN DATE_SUB(?, INTERVAL DATEDIFF(?, ?)+1 DAY) AND DATE_SUB(?, INTERVAL 1 DAY), TotalAmount, 0)) AS previousPeriod
       FROM voucher WHERE TransactionType='Sales'`, [p.fromDate, p.toDate, p.fromDate, p.toDate, p.fromDate, p.fromDate]);
    const cur = num(r[0].currentPeriod), prev = num(r[0].previousPeriod);
    return { summary: { currentPeriod: `${p.fromDate} to ${p.toDate}`, currentTotal: cur.toFixed(2), previousTotal: prev.toFixed(2), change: (cur - prev).toFixed(2), changePercent: prev ? ((cur - prev) / prev * 100).toFixed(2) + '%' : 'N/A' }, data: r };
  },
  async getCustomerReceiptHistory() { return outstandingInner(); },
  async getOverdueReceivables() {
    const rows = await runQ(
      `SELECT PartyName, InvoiceNumber, Date, due_date, TotalAmount, balance_amount
       FROM voucher WHERE TransactionType='Sales' AND COALESCE(balance_amount,0) > 0 AND due_date IS NOT NULL AND due_date < CURDATE()
       ORDER BY due_date ASC LIMIT 100`);
    return tableResult(rows, { count: rows.length, totalOverdue: rows.reduce((s, r) => s + num(r.balance_amount), 0).toFixed(2) });
  },
  async getExpenseRequestStatus() {
    const rows = await runQ(`SELECT status, COUNT(*) entries, COALESCE(SUM(amount),0) total FROM expensive GROUP BY status`);
    return tableResult(rows, { count: rows.length });
  },
  async getGstReport(p) {
    const rows = await runQ(
      `SELECT hsn_code, SUM(quantity) qty, SUM(total) taxable, SUM(cgst) cgst, SUM(sgst) sgst, SUM(igst) igst
       FROM voucherdetails vd JOIN voucher v ON v.VoucherID = vd.voucher_id
       WHERE vd.transaction_type='Sales' AND DATE(v.Date) BETWEEN ? AND ?
       GROUP BY hsn_code ORDER BY taxable DESC LIMIT 100`, [p.fromDate, p.toDate]);
    return tableResult(rows, { count: rows.length });
  },
  async getOrderReport() {
    try {
      const rows = await runQ(
        `SELECT order_status, approval_status, COUNT(*) orders, COALESCE(SUM(order_total),0) total FROM orders GROUP BY order_status, approval_status`);
      return tableResult(rows, { count: rows.length });
    } catch { return { message: 'Order data not available.', data: [] }; }
  },
  async getSalesReport(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, PartyName, saleType, TotalAmount, paid_amount, status FROM voucher
       WHERE TransactionType='Sales' AND DATE(Date) BETWEEN ? AND ? ORDER BY Date DESC LIMIT 300`, [p.fromDate, p.toDate]);
    return tableResult(rows, { count: rows.length, total: rows.reduce((s, r) => s + num(r.TotalAmount), 0).toFixed(2) });
  },
  async getPurchaseReport(p) {
    const rows = await runQ(
      `SELECT InvoiceNumber, Date, PartyName, TotalAmount, paid_amount, status FROM voucher
       WHERE TransactionType='Purchase' AND DATE(Date) BETWEEN ? AND ? ORDER BY Date DESC LIMIT 300`, [p.fromDate, p.toDate]);
    return tableResult(rows, { count: rows.length, total: rows.reduce((s, r) => s + num(r.TotalAmount), 0).toFixed(2) });
  },
  async getStockReport() {
    const rows = await runQ(
      `SELECT p.goods_name, COALESCE(SUM(b.quantity),0) qty, COALESCE(SUM(b.stock_in),0) stock_in, COALESCE(SUM(b.stock_out),0) stock_out
       FROM products p LEFT JOIN batches b ON b.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 300`);
    return tableResult(rows, { count: rows.length });
  },
  async getExpenseReport(p) {
    const rows = await runQ(
      `SELECT date, staff_name, category, amount, status, payment_status FROM expensive WHERE DATE(date) BETWEEN ? AND ? ORDER BY date DESC LIMIT 300`, [p.fromDate, p.toDate])
      .catch(() => []);
    return tableResult(rows, { count: rows.length, total: rows.reduce((s, r) => s + num(r.amount), 0).toFixed(2) });
  },
  async getPaymentReport(p) {
    const rows = await runQ(
      `SELECT Date, PartyName, InvoiceNumber, paid_amount, payment_method FROM voucher
       WHERE TransactionType='Sales' AND COALESCE(paid_amount,0) > 0 AND DATE(Date) BETWEEN ? AND ? ORDER BY Date DESC LIMIT 300`, [p.fromDate, p.toDate]);
    return tableResult(rows, { count: rows.length, total: rows.reduce((s, r) => s + num(r.paid_amount), 0).toFixed(2) });
  },
  async getOutstandingReport() { return outstandingInner(); },
  async getCreditNoteReport() { return HANDLERS.getCreditNotes(); },
  async getProfitLossReport(p) { return HANDLERS.getProfitLoss(p); },
  async getRetailerReport() {
    const rows = await runQ(
      `SELECT a.id, a.name, COALESCE(SUM(v.TotalAmount),0) totalSales, COALESCE(SUM(v.balance_amount),0) outstanding
       FROM accounts a LEFT JOIN voucher v ON v.PartyID = a.id AND v.TransactionType='Sales'
       WHERE a.role='retailer' GROUP BY a.id ORDER BY totalSales DESC LIMIT 100`);
    return tableResult(rows, { count: rows.length });
  },

  // ===== DASHBOARD =====
  async getTodaysOrders() {
    try {
      const r = await runQ(`SELECT COUNT(*) c, COALESCE(SUM(order_total),0) t FROM orders WHERE DATE(created_at)=CURDATE()`);
      return { summary: { ordersToday: r[0].c, orderValue: num(r[0].t).toFixed(2) }, data: r };
    } catch { return { message: 'Order data not available.', data: [] }; }
  },
  async getLowStockCount() {
    const r = await runQ(
      `SELECT COUNT(*) c FROM (SELECT COALESCE(SUM(b.quantity),0) qty, p.min_stock_alert m FROM products p LEFT JOIN batches b ON b.product_id=p.id GROUP BY p.id HAVING qty > 0 AND qty <= COALESCE(m,0)) x`);
    return { summary: { lowStockCount: r[0].c }, data: r };
  },
  async getOutOfStockCount() {
    const r = await runQ(
      `SELECT COUNT(*) c FROM (SELECT COALESCE(SUM(b.quantity),0) qty FROM products p LEFT JOIN batches b ON b.product_id=p.id GROUP BY p.id HAVING qty <= 0) x`);
    return { summary: { outOfStockCount: r[0].c }, data: r };
  },
  async getBusinessSummary() {
    const sales = await runQ(`SELECT COALESCE(SUM(TotalAmount),0) t FROM voucher WHERE TransactionType='Sales' AND DATE(Date)=CURDATE()`);
    const orders = await runQ(`SELECT COUNT(*) c FROM orders WHERE DATE(created_at)=CURDATE()`).catch(() => [{ c: 0 }]);
    const outstanding = await runQ(`SELECT COALESCE(SUM(balance_amount),0) t FROM voucher WHERE TransactionType='Sales' AND COALESCE(balance_amount,0)>0`);
    const expenses = await runQ(`SELECT COALESCE(SUM(amount),0) t FROM expensive WHERE YEAR(date)=YEAR(CURDATE()) AND MONTH(date)=MONTH(CURDATE())`).catch(() => [{ t: 0 }]);
    return {
      summary: {
        todaysSales: num(sales[0].t).toFixed(2),
        todaysOrders: orders[0].c,
        outstanding: num(outstanding[0].t).toFixed(2),
        thisMonthExpenses: num(expenses[0].t).toFixed(2),
      },
      data: [],
    };
  },
};

// ---------- helpers ----------
async function salesFor(where, params) {
  const rows = await runQ(
    `SELECT Date, PartyName, InvoiceNumber, TotalAmount, status FROM voucher WHERE TransactionType='Sales' AND ${where} ORDER BY Date DESC LIMIT 300`, params);
  const r = await runQ(`SELECT COUNT(*) c, COALESCE(SUM(TotalAmount),0) t FROM voucher WHERE TransactionType='Sales' AND ${where}`, params);
  return { summary: { invoices: r[0].c, totalSales: num(r[0].t).toFixed(2) }, data: rows, message: rows.length ? undefined : 'No records found for the selected criteria.' };
}
async function purchaseFor(where, params) {
  const r = await runQ(`SELECT COUNT(*) c, COALESCE(SUM(TotalAmount),0) t FROM voucher WHERE TransactionType='Purchase' AND ${where}`, params);
  const rows = await runQ(`SELECT Date, PartyName, InvoiceNumber, TotalAmount, status FROM voucher WHERE TransactionType='Purchase' AND ${where} ORDER BY Date DESC LIMIT 300`, params);
  return { summary: { entries: r[0].c, totalPurchase: num(r[0].t).toFixed(2) }, data: rows, message: rows.length ? undefined : 'No records found for the selected criteria.' };
}
async function paymentsFor(where, params) {
  const r = await runQ(`SELECT COUNT(*) c, COALESCE(SUM(paid_amount),0) t FROM voucher WHERE TransactionType='Sales' AND COALESCE(paid_amount,0)>0 AND ${where}`, params);
  const rows = await runQ(`SELECT Date, PartyName, InvoiceNumber, paid_amount, payment_method FROM voucher WHERE TransactionType='Sales' AND COALESCE(paid_amount,0)>0 AND ${where} ORDER BY Date DESC LIMIT 300`, params);
  return { summary: { entries: r[0].c, totalReceived: num(r[0].t).toFixed(2) }, data: rows, message: rows.length ? undefined : 'No records found for the selected criteria.' };
}
async function expensesFor(where, params) {
  try {
    const r = await runQ(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM expensive WHERE ${where}`, params);
    const rows = await runQ(`SELECT date, staff_name, category, amount, status, payment_status FROM expensive WHERE ${where} ORDER BY date DESC LIMIT 300`, params);
    return { summary: { entries: r[0].c, totalExpenses: num(r[0].t).toFixed(2) }, data: rows, message: rows.length ? undefined : 'No records found for the selected criteria.' };
  } catch (e) {
    return { success: false, message: 'Expense data is not available in this environment.', data: [] };
  }
}
async function outstandingInner() {
  const r = await runQ(
    `SELECT COUNT(*) c, COALESCE(SUM(balance_amount),0) t FROM voucher WHERE TransactionType='Sales' AND COALESCE(balance_amount,0) > 0`);
  const rows = await runQ(
    `SELECT PartyName, InvoiceNumber, Date, TotalAmount, balance_amount FROM voucher WHERE TransactionType='Sales' AND COALESCE(balance_amount,0) > 0 ORDER BY balance_amount DESC LIMIT 50`);
  return { summary: { unpaidInvoices: r[0].c, outstanding: num(r[0].t).toFixed(2) }, data: rows };
}

async function executeHandler(handlerName, parameters) {
  const fn = HANDLERS[handlerName];
  if (!fn) return { success: false, error: 'Unsupported question' };
  try {
    const result = await fn(parameters || {});
    return { success: true, ...result };
  } catch (err) {
    console.error(`Chatbot handler ${handlerName} failed:`, err.message);
    return { success: false, error: 'Unable to fetch data for this request right now.' };
  }
}

module.exports = { executeHandler };
