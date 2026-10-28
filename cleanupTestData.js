const db = require('./db');

async function cleanup() {
  try {
    // Delete voucherdetails first (child table)
    const detailResult = await new Promise((resolve, reject) => {
      db.query(
        'DELETE FROM voucherdetails WHERE voucher_id IN (SELECT VoucherID FROM voucher WHERE InvoiceNumber LIKE ?)',
        ['TEST_PL_%'],
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
    console.log('Deleted voucherdetails:', detailResult.affectedRows);

    // Delete vouchers (parent table)
    const voucherResult = await new Promise((resolve, reject) => {
      db.query(
        'DELETE FROM voucher WHERE InvoiceNumber LIKE ?',
        ['TEST_PL_%'],
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
    console.log('Deleted vouchers:', voucherResult.affectedRows);

    // Delete products
    const productResult = await new Promise((resolve, reject) => {
      db.query(
        'DELETE FROM products WHERE goods_name LIKE ?',
        ['TEST_PL_%'],
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
    console.log('Deleted products:', productResult.affectedRows);

    // Delete expenses
    const expenseResult = await new Promise((resolve, reject) => {
      db.query(
        'DELETE FROM expensive WHERE note LIKE ?',
        ['TEST_PL_%'],
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
    console.log('Deleted expenses:', expenseResult.affectedRows);

    console.log('Cleanup complete!');
    process.exit(0);
  } catch (err) {
    console.error('Cleanup error:', err.message);
    process.exit(1);
  }
}

cleanup();
