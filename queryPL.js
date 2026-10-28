const db = require('./db');

async function query() {
  // Get all Sales vouchers in the period
  const salesVouchers = await new Promise((resolve, reject) => {
    db.query(
      `SELECT VoucherID, InvoiceNumber, Date, PartyName, TotalAmount, status
       FROM voucher
       WHERE TransactionType = 'Sales'
         AND DATE(Date) BETWEEN '2026-04-01' AND '2026-10-15'
       ORDER BY Date`,
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  console.log('=== SALES VOUCHERS ===');
  console.log(JSON.stringify(salesVouchers, null, 2));

  // Get all Sales voucher details in the period
  const salesDetails = await new Promise((resolve, reject) => {
    db.query(
      `SELECT vd.voucher_id, vd.product, vd.quantity, vd.price, vd.total, vd.transaction_type,
              v.InvoiceNumber, v.Date, v.TotalAmount as voucher_total
       FROM voucherdetails vd
       JOIN voucher v ON v.VoucherID = vd.voucher_id
       WHERE v.TransactionType = 'Sales'
         AND DATE(v.Date) BETWEEN '2026-04-01' AND '2026-10-15'
         AND vd.transaction_type = 'Sales'
       ORDER BY v.Date`,
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  console.log('\n=== SALES DETAILS (COGS Calculation) ===');
  console.log(JSON.stringify(salesDetails, null, 2));

  // Get product purchase prices
  const products = await new Promise((resolve, reject) => {
    db.query(
      `SELECT goods_name, purchase_price, price
       FROM products
       WHERE goods_name IN (SELECT DISTINCT vd.product
                            FROM voucherdetails vd
                            JOIN voucher v ON v.VoucherID = vd.voucher_id
                            WHERE v.TransactionType = 'Sales'
                              AND DATE(v.Date) BETWEEN '2026-04-01' AND '2026-10-15'
                              AND vd.transaction_type = 'Sales')`,
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  console.log('\n=== PRODUCT PURCHASE PRICES ===');
  console.log(JSON.stringify(products, null, 2));

  // Get all Purchase vouchers in the period
  const purchaseVouchers = await new Promise((resolve, reject) => {
    db.query(
      `SELECT VoucherID, InvoiceNumber, Date, PartyName, TotalAmount, status
       FROM voucher
       WHERE TransactionType = 'Purchase'
         AND DATE(Date) BETWEEN '2026-04-01' AND '2026-10-15'
       ORDER BY Date`,
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  console.log('\n=== PURCHASE VOUCHERS ===');
  console.log(JSON.stringify(purchaseVouchers, null, 2));

  // Get all Purchase voucher details in the period
  const purchaseDetails = await new Promise((resolve, reject) => {
    db.query(
      `SELECT vd.voucher_id, vd.product, vd.quantity, vd.price, vd.total, vd.transaction_type,
              v.InvoiceNumber, v.Date, v.TotalAmount as voucher_total
       FROM voucherdetails vd
       JOIN voucher v ON v.VoucherID = vd.voucher_id
       WHERE v.TransactionType = 'Purchase'
         AND DATE(v.Date) BETWEEN '2026-04-01' AND '2026-10-15'
         AND vd.transaction_type = 'Purchase'
       ORDER BY v.Date`,
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  console.log('\n=== PURCHASE DETAILS ===');
  console.log(JSON.stringify(purchaseDetails, null, 2));

  // Get expenses in the period
  const expenses = await new Promise((resolve, reject) => {
    db.query(
      `SELECT id, staff_name, category, amount, date, status, payment_status
       FROM expensive
       WHERE DATE(date) BETWEEN '2026-04-01' AND '2026-10-15'
       ORDER BY date`,
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  console.log('\n=== EXPENSES ===');
  console.log(JSON.stringify(expenses, null, 2));

  // Get ALL vouchers in the period (to check for any other types)
  const allVouchers = await new Promise((resolve, reject) => {
    db.query(
      `SELECT VoucherID, TransactionType, InvoiceNumber, Date, PartyName, TotalAmount, status
       FROM voucher
       WHERE DATE(Date) BETWEEN '2026-04-01' AND '2026-10-15'
       ORDER BY Date`,
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  console.log('\n=== ALL VOUCHERS IN PERIOD ===');
  console.log(JSON.stringify(allVouchers, null, 2));

  process.exit(0);
}

query();
