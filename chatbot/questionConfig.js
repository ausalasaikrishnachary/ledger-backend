// Centralized predefined question configuration for the Admin Chatbot.
// UI reads categories/questions from GET /api/chatbot/config.
// Each question maps to exactly one approved handler in services/chatbotService.js.

const CATEGORIES = [
  { id: 'customer', label: 'Customer / Retailer' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'invoice', label: 'Invoice' },
  { id: 'sales', label: 'Sales / Revenue' },
  { id: 'profitloss', label: 'Profit & Loss' },
  { id: 'inventory', label: 'Inventory / Stock' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'payments', label: 'Payments' },
  { id: 'receipts', label: 'Receipts / Receivables' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'creditnotes', label: 'Credit Notes' },
  { id: 'reports', label: 'Reports' },
  { id: 'dashboard', label: 'Dashboard Summary' },
];

const QUESTIONS = [
  // CUSTOMER
  { id: 'CUST_001', category: 'customer', question: 'Show customer details', requiredParams: ['customerId'], handler: 'getCustomerDetails' },
  { id: 'CUST_002', category: 'customer', question: 'Show customer outstanding balance', requiredParams: ['customerId'], handler: 'getCustomerOutstanding' },
  { id: 'CUST_003', category: 'customer', question: 'Show customer invoice history', requiredParams: ['customerId'], handler: 'getCustomerInvoices' },
  { id: 'CUST_004', category: 'customer', question: 'Show customer payment history', requiredParams: ['customerId'], handler: 'getCustomerPayments' },
  { id: 'CUST_005', category: 'customer', question: "Show customer's last payment", requiredParams: ['customerId'], handler: 'getCustomerLastPayment' },
  { id: 'CUST_006', category: 'customer', question: 'Show total sales for a customer', requiredParams: ['customerId'], handler: 'getCustomerTotalSales' },
  { id: 'CUST_007', category: 'customer', question: 'Show customer credit period', requiredParams: ['customerId'], handler: 'getCustomerCreditPeriod' },

  // LEDGER
  { id: 'LED_001', category: 'ledger', question: 'Show ledger for a selected customer', requiredParams: ['customerId', 'fromDate', 'toDate'], handler: 'getCustomerLedger' },
  { id: 'LED_002', category: 'ledger', question: 'Show outstanding amount', requiredParams: [], handler: 'getOutstandingTotal' },

  // INVOICE
  { id: 'INV_001', category: 'invoice', question: 'Search invoice by invoice number', requiredParams: ['invoiceNumber'], handler: 'searchInvoice' },
  { id: 'INV_002', category: 'invoice', question: 'Show invoice items', requiredParams: ['invoiceNumber'], handler: 'getInvoiceItems' },
  { id: 'INV_003', category: 'invoice', question: 'Show invoice total', requiredParams: ['invoiceNumber'], handler: 'getInvoiceTotal' },
  { id: 'INV_004', category: 'invoice', question: 'Show unpaid invoices', requiredParams: [], handler: 'getUnpaidInvoices' },
  { id: 'INV_005', category: 'invoice', question: 'Show invoices for selected customer', requiredParams: ['customerId'], handler: 'getCustomerInvoices' },
  { id: 'INV_006', category: 'invoice', question: 'Show invoices for selected date range', requiredParams: ['fromDate', 'toDate'], handler: 'getInvoicesByDateRange' },
  { id: 'INV_007', category: 'invoice', question: 'Show invoices by Sale Type', requiredParams: ['saleType'], handler: 'getInvoicesBySaleType' },

  // SALES
  { id: 'SAL_001', category: 'sales', question: "Show today's sales", requiredParams: [], handler: 'getTodaysSales' },
  { id: 'SAL_002', category: 'sales', question: "Show this week's sales", requiredParams: [], handler: 'getThisWeekSales' },
  { id: 'SAL_003', category: 'sales', question: "Show this month's sales", requiredParams: [], handler: 'getThisMonthSales' },
  { id: 'SAL_004', category: 'sales', question: "Show this year's sales", requiredParams: [], handler: 'getThisYearSales' },
  { id: 'SAL_005', category: 'sales', question: 'Show sales for selected date range', requiredParams: ['fromDate', 'toDate'], handler: 'getSalesByRange' },
  { id: 'SAL_006', category: 'sales', question: 'Show revenue by customer', requiredParams: [], handler: 'getRevenueByCustomer' },
  { id: 'SAL_007', category: 'sales', question: 'Show revenue by product', requiredParams: [], handler: 'getRevenueByProduct' },
  { id: 'SAL_008', category: 'sales', question: 'Show top customers', requiredParams: [], handler: 'getTopCustomers' },
  { id: 'SAL_009', category: 'sales', question: 'Show highest-selling products', requiredParams: [], handler: 'getTopProducts' },
  { id: 'SAL_010', category: 'sales', question: 'Show average invoice value', requiredParams: [], handler: 'getAverageInvoiceValue' },

  // P&L
  { id: 'PL_001', category: 'profitloss', question: 'Show Profit & Loss', requiredParams: ['fromDate', 'toDate'], handler: 'getProfitLoss' },

  // INVENTORY
  { id: 'STK_001', category: 'inventory', question: 'Show current inventory', requiredParams: [], handler: 'getInventory' },
  { id: 'STK_002', category: 'inventory', question: 'Show stock for selected product', requiredParams: ['productId'], handler: 'getStockForProduct' },
  { id: 'STK_003', category: 'inventory', question: 'Show out-of-stock products', requiredParams: [], handler: 'getOutOfStock' },
  { id: 'STK_004', category: 'inventory', question: 'Show low-stock products', requiredParams: [], handler: 'getLowStock' },
  { id: 'STK_005', category: 'inventory', question: 'Show highest-stock products', requiredParams: [], handler: 'getHighestStock' },
  { id: 'STK_006', category: 'inventory', question: 'Show stock by category', requiredParams: [], handler: 'getStockByCategory' },

  // PURCHASE
  { id: 'PUR_001', category: 'purchase', question: "Show today's purchases", requiredParams: [], handler: 'getTodaysPurchases' },
  { id: 'PUR_002', category: 'purchase', question: 'Show purchases for selected date range', requiredParams: ['fromDate', 'toDate'], handler: 'getPurchasesByRange' },
  { id: 'PUR_003', category: 'purchase', question: 'Show total purchase value', requiredParams: [], handler: 'getTotalPurchaseValue' },

  // PAYMENTS
  { id: 'PAY_001', category: 'payments', question: "Show today's payments", requiredParams: [], handler: 'getTodaysPayments' },
  { id: 'PAY_002', category: 'payments', question: 'Show payments for selected date range', requiredParams: ['fromDate', 'toDate'], handler: 'getPaymentsByRange' },
  { id: 'PAY_003', category: 'payments', question: 'Show payment history for customer', requiredParams: ['customerId'], handler: 'getCustomerPayments' },

  // RECEIPTS
  { id: 'REC_001', category: 'receipts', question: 'Show outstanding receivables', requiredParams: [], handler: 'getOutstandingReceivables' },
  { id: 'REC_002', category: 'receipts', question: 'Show customer-wise outstanding', requiredParams: [], handler: 'getCustomerWiseOutstanding' },

  // EXPENSES
  { id: 'EXP_001', category: 'expenses', question: "Show today's expenses", requiredParams: [], handler: 'getTodaysExpenses' },
  { id: 'EXP_002', category: 'expenses', question: 'Show monthly expenses', requiredParams: [], handler: 'getMonthlyExpenses' },
  { id: 'EXP_003', category: 'expenses', question: 'Show expense by category', requiredParams: [], handler: 'getExpensesByCategory' },

  // CREDIT NOTES
  { id: 'CN_001', category: 'creditnotes', question: 'Show credit notes', requiredParams: [], handler: 'getCreditNotes' },
  { id: 'CN_002', category: 'creditnotes', question: 'Show total credit note amount', requiredParams: [], handler: 'getCreditNotesTotal' },

  // REPORTS
  { id: 'REP_001', category: 'reports', question: 'Sales report', requiredParams: ['fromDate', 'toDate'], handler: 'getSalesReport' },
  { id: 'REP_002', category: 'reports', question: 'Purchase report', requiredParams: ['fromDate', 'toDate'], handler: 'getPurchaseReport' },
  { id: 'REP_003', category: 'reports', question: 'Stock report', requiredParams: [], handler: 'getStockReport' },
  { id: 'REP_004', category: 'reports', question: 'Expense report', requiredParams: ['fromDate', 'toDate'], handler: 'getExpenseReport' },
  { id: 'REP_005', category: 'reports', question: 'Payment report', requiredParams: ['fromDate', 'toDate'], handler: 'getPaymentReport' },
  { id: 'REP_006', category: 'reports', question: 'Outstanding report', requiredParams: [], handler: 'getOutstandingReport' },
  { id: 'REP_007', category: 'reports', question: 'Order report', requiredParams: [], handler: 'getOrderReport' },
  { id: 'REP_008', category: 'reports', question: 'Credit Note report', requiredParams: [], handler: 'getCreditNoteReport' },
  { id: 'REP_009', category: 'reports', question: 'Profit & Loss report', requiredParams: ['fromDate', 'toDate'], handler: 'getProfitLossReport' },
  { id: 'REP_010', category: 'reports', question: 'GST / HSN report', requiredParams: ['fromDate', 'toDate'], handler: 'getGstReport' },
  { id: 'REP_011', category: 'reports', question: 'Customer report', requiredParams: [], handler: 'getRetailerReport' },

  // Extra sales / P&L
  { id: 'SAL_011', category: 'sales', question: 'Show sales comparison between two periods', requiredParams: ['fromDate', 'toDate'], handler: 'getSalesComparison' },
  { id: 'PL_002', category: 'profitloss', question: 'Show monthly P&L', requiredParams: [], handler: 'getMonthlyProfitLoss' },
  { id: 'PL_003', category: 'profitloss', question: 'Show revenue vs expenses', requiredParams: ['fromDate', 'toDate'], handler: 'getRevenueVsExpenses' },
  { id: 'PL_004', category: 'profitloss', question: 'Show profit by product', requiredParams: ['fromDate', 'toDate'], handler: 'getProfitByProduct' },
  { id: 'REC_003', category: 'receipts', question: 'Show overdue receivables', requiredParams: [], handler: 'getOverdueReceivables' },
  { id: 'EXP_004', category: 'expenses', question: 'Show expense request status', requiredParams: [], handler: 'getExpenseRequestStatus' },

  // DASHBOARD
  { id: 'DASH_001', category: 'dashboard', question: "Show today's sales", requiredParams: [], handler: 'getTodaysSales' },
  { id: 'DASH_002', category: 'dashboard', question: "Show today's orders", requiredParams: [], handler: 'getTodaysOrders' },
  { id: 'DASH_003', category: 'dashboard', question: 'Show outstanding amount', requiredParams: [], handler: 'getOutstandingTotal' },
  { id: 'DASH_004', category: 'dashboard', question: 'Show low-stock count', requiredParams: [], handler: 'getLowStockCount' },
  { id: 'DASH_005', category: 'dashboard', question: 'Show out-of-stock count', requiredParams: [], handler: 'getOutOfStockCount' },
  { id: 'DASH_006', category: 'dashboard', question: 'Show quick business summary', requiredParams: [], handler: 'getBusinessSummary' },
];

function findQuestion(questionId) {
  return QUESTIONS.find((q) => q.id === questionId);
}

module.exports = { CATEGORIES, QUESTIONS, findQuestion };
