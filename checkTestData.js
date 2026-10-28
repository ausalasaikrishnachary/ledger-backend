const db = require('./db');

async function check() {
  const vouchers = await new Promise((resolve, reject) => {
    db.query('SELECT COUNT(*) as cnt FROM voucher WHERE InvoiceNumber LIKE "TEST_PL_%"', (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  console.log('Test vouchers in DB:', vouchers[0].cnt);

  const details = await new Promise((resolve, reject) => {
    db.query('SELECT COUNT(*) as cnt FROM voucherdetails WHERE product LIKE "TEST_PL_%"', (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  console.log('Test voucherdetails in DB:', details[0].cnt);

  const products = await new Promise((resolve, reject) => {
    db.query('SELECT COUNT(*) as cnt FROM products WHERE goods_name LIKE "TEST_PL_%"', (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  console.log('Test products in DB:', products[0].cnt);

  const expenses = await new Promise((resolve, reject) => {
    db.query('SELECT COUNT(*) as cnt FROM expensive WHERE note LIKE "TEST_PL_%"', (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  console.log('Test expenses in DB:', expenses[0].cnt);

  process.exit(0);
}

check();
