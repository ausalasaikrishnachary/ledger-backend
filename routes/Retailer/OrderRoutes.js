const express = require("express");
const router = express.Router();
const db = require('./../../db');


// ===================================================
// 📌 GET ALL ORDERS
// ===================================================
router.get("/all-orders", (req, res) => {
  db.query("SELECT * FROM orders ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    
    // Add a flag to indicate if invoice can be generated
    const ordersWithInvoiceFlag = rows.map(order => ({
      ...order,
      canGenerateInvoice: order.invoice_status === 0 || order.invoice_status === null
    }));
    
    res.json(ordersWithInvoiceFlag);
  });
});

// ===================================================
// 📌 GET ORDERS BY CUSTOMER ID
// ===================================================
router.get("/customer-orders/:customer_id", (req, res) => {
  const { customer_id } = req.params;

  db.query(
    "SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC",
    [customer_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err });
      res.json(rows);
    }
  );
});

// ===================================================
// 📌 GET SINGLE ORDER WITH ITEMS
// ===================================================
router.get("/details/:order_number", (req, res) => {
  const { order_number } = req.params;

  db.query(
    "SELECT * FROM orders WHERE order_number = ?",
    [order_number],
    (err, orderRows) => {
      if (err) return res.status(500).json({ error: err });

      if (orderRows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      db.query(
        "SELECT * FROM order_items WHERE order_number = ?",
        [order_number],
        (err, itemRows) => {
          if (err) return res.status(500).json({ error: err });

          res.json({
            order: orderRows[0],
            items: itemRows,
          });
        }
      );
    }
  );
});


// POST /api/orders/complete-order - Create complete order with order_items
router.post('/complete-order', async (req, res) => {
  console.log('📦 Received complete order request:', req.body);

  const {
    order_number,
    customer_id,
    customer_name,
    order_total,
    discount_amount,
    taxable_amount,
    tax_amount,
    net_payable,
    credit_period,
    estimated_delivery_date,
    order_placed_by,
    order_mode,
    invoice_number,
    invoice_date,
    order_items
  } = req.body;

  // Validate required fields
  if (!order_number || !customer_id || !customer_name || !order_items || !order_items.length) {
    console.log('❌ Missing required fields');
    return res.status(400).json({
      error: 'Missing required fields: order_number, customer_id, customer_name, order_items'
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    console.log('✅ Starting order creation transaction');

    // Step 1: Insert into orders table
    const orderQuery = `
      INSERT INTO orders (
        order_number, customer_id, customer_name, order_total, discount_amount,
        taxable_amount, tax_amount, net_payable, credit_period, estimated_delivery_date,
        order_placed_by, order_mode, invoice_number, invoice_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    const orderValues = [
      order_number,
      customer_id,
      customer_name,
      order_total,
      discount_amount || 0,
      taxable_amount,
      tax_amount || 0,
      net_payable,
      credit_period || '0',
      estimated_delivery_date,
      order_placed_by,
      order_mode,
      invoice_number,
      invoice_date
    ];

    console.log('🚀 Inserting order with values:', orderValues);
    const [orderResult] = await connection.execute(orderQuery, orderValues);
    console.log('✅ Order inserted with ID:', orderResult.insertId);

    // Step 2: Insert order items
    const orderItemQuery = `
      INSERT INTO order_items (
        order_number, item_name, product_id, mrp, sale_price, price, quantity,
        total_amount, discount_percentage, discount_amount, taxable_amount,
        tax_percentage, tax_amount, item_total, credit_period, credit_percentage,
        sgst_percentage, sgst_amount, cgst_percentage, cgst_amount, discount_applied_scheme
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const item of order_items) {
      const itemValues = [
        order_number,
        item.item_name,
        item.product_id,
        item.mrp || 0,
        item.sale_price || item.price,
        item.price,
        item.quantity,
        item.total_amount,
        item.discount_percentage || 0,
        item.discount_amount || 0,
        item.taxable_amount,
        item.tax_percentage || 0,
        item.tax_amount || 0,
        item.item_total,
        item.credit_period || '0',
        item.credit_percentage || 0,
        item.sgst_percentage || 0,
        item.sgst_amount || 0,
        item.cgst_percentage || 0,
        item.cgst_amount || 0,
        item.discount_applied_scheme || 'none'
      ];

      console.log('📦 Inserting order item:', itemValues);
      await connection.execute(orderItemQuery, itemValues);
    }

    console.log(`✅ ${order_items.length} order items inserted`);

    // Step 3: Update stock for each product
    for (const item of order_items) {
      const stockQuery = `
        INSERT INTO stock (product_id, price_per_unit, opening_stock, stock_out, balance_stock, date)
        SELECT 
          ? as product_id,
          ? as price_per_unit,
          opening_stock,
          ? as stock_out,
          (opening_stock - ?) as balance_stock,
          CURDATE() as date
        FROM products 
        WHERE id = ?
      `;

      const stockValues = [
        item.product_id,
        item.price,
        item.quantity,
        item.quantity,
        item.product_id
      ];

      console.log('📊 Updating stock for product:', item.product_id);
      await connection.execute(stockQuery, stockValues);

      // Update products table balance_stock
      const updateProductQuery = `
        UPDATE products 
        SET balance_stock = balance_stock - ?, updated_at = NOW()
        WHERE id = ?
      `;

      await connection.execute(updateProductQuery, [item.quantity, item.product_id]);
    }

    console.log('✅ Stock updated for all products');

    // Commit transaction
    await connection.commit();
    console.log('✅ Transaction committed successfully');

    res.status(201).json({
      success: true,
      orderId: order_number,
      message: 'Order created successfully',
      orderNumber: order_number
    });

  } catch (error) {
    // Rollback transaction on error
    if (connection) {
      await connection.rollback();
    }
    console.error('❌ Order creation failed:', error);
    res.status(500).json({
      error: 'Failed to create order',
      details: error.message,
      sqlMessage: error.sqlMessage
    });
  } finally {
    if (connection) {
      connection.release();
      console.log('✅ Database connection released');
    }
  }
});


router.post('/create-complete-order', (req, res) => {
  console.log('📦 Creating complete order:', req.body);

  const { order, orderItems } = req.body;

  if (!order || !orderItems) {
    return res.status(400).json({
      error: 'Missing order or orderItems data'
    });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Database connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }

    // Start transaction
    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error('❌ Transaction start error:', err);
        return res.status(500).json({ error: 'Failed to start transaction' });
      }

      try {
        // Step 1: Insert into orders table
        const orderQuery = `
          INSERT INTO orders (
            order_number, customer_id, customer_name, order_total, discount_amount,
            taxable_amount, tax_amount, net_payable, credit_period,
            estimated_delivery_date, order_placed_by, order_mode,
             created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  NOW())
        `;

        const orderValues = [
          order.order_number,
          order.customer_id,
          order.customer_name,
          order.order_total,
          order.discount_amount,
          order.taxable_amount,
          order.tax_amount,
          order.net_payable,
          order.credit_period,
          order.estimated_delivery_date,
          order.order_placed_by, // This should be the account ID, not name
          order.order_mode,
        
        ];

        console.log('🚀 Inserting order with values:', orderValues);

        const orderResult = await new Promise((resolve, reject) => {
          connection.query(orderQuery, orderValues, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Order inserted with ID:', orderResult.insertId);

        // Step 2: Insert order items
        const orderItemQuery = `
          INSERT INTO order_items (
            order_number, item_name, product_id, mrp, sale_price, price, quantity,
            total_amount, discount_percentage, discount_amount, taxable_amount,
            tax_percentage, tax_amount, item_total, credit_period, credit_percentage,
            sgst_percentage, sgst_amount, cgst_percentage, cgst_amount, discount_applied_scheme
          ) VALUES ?
        `;

        const orderItemValues = orderItems.map(item => [
          order.order_number,
          item.item_name,
          item.product_id,
          item.mrp,
          item.sale_price,
          item.price,
          item.quantity,
          item.total_amount,
          item.discount_percentage,
          item.discount_amount,
          item.taxable_amount,
          item.tax_percentage,
          item.tax_amount,
          item.item_total,
          item.credit_period,
          item.credit_percentage,
          item.sgst_percentage,
          item.sgst_amount,
          item.cgst_percentage,
          item.cgst_amount,
          item.discount_applied_scheme
        ]);

        console.log('🚀 Inserting order items:', orderItemValues.length);

        const orderItemsResult = await new Promise((resolve, reject) => {
          connection.query(orderItemQuery, [orderItemValues], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Order items inserted:', orderItemsResult.affectedRows);

        // Commit transaction
        await new Promise((resolve, reject) => {
          connection.commit((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        console.log('✅ Transaction committed successfully');

        connection.release();

        res.status(201).json({
          success: true,
          order_number: order.order_number,
          order_id: orderResult.insertId,
          message: 'Order created successfully'
        });

      } catch (error) {
        // Rollback transaction on error
        connection.rollback(() => {
          connection.release();
          console.error('❌ Transaction error, rolled back:', error);
          res.status(500).json({
            error: 'Failed to create order',
            details: error.message,
            sqlMessage: error.sqlMessage
          });
        });
      }
    });
  });
});


router.get("/orders-placed-by/:order_placed_by", (req, res) => {
  const { order_placed_by } = req.params;

  db.query(
    "SELECT * FROM orders WHERE order_placed_by = ? ORDER BY id DESC",
    [order_placed_by],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err });
      res.json(rows);
    }
  );
});


module.exports = router;
