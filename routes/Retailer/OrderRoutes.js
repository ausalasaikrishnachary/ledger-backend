const express = require("express");
const router = express.Router();
const db = require('./../../db');

// Utility: generate order number -> ORD0001
function generateOrderNumber(id) {
  return "ORD" + String(id).padStart(5, "0");
}

// ===================================================
// 📌 PLACE ORDER
// ===================================================
// ===================================================
// 📌 PLACE ORDER (Updated with staff_id)
// ===================================================
router.post("/place-order", (req, res) => {
  const {
    customer_id,
    customer_name,
    staff_id, // Add staff_id here
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
    items,
  } = req.body;

  if (!customer_id || !items || items.length === 0) {
    return res.status(400).json({ error: "Customer ID and items are required" });
  }

  // 1️⃣ Insert into orders (temporary placeholder order_number)
  const insertOrderQuery = `
    INSERT INTO orders (
      order_number,
      customer_id, 
      customer_name,
      staff_id, -- Add staff_id column
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
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  db.query(
    insertOrderQuery,
    [
      "TEMP", // placeholder
      customer_id,
      customer_name,
      staff_id || null, // Include staff_id
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
    ],
    (err, orderResult) => {
      if (err) {
        console.error("Order insert error:", err);
        return res.status(500).json({ error: "Order insert failed", details: err.message });
      }

      const orderId = orderResult.insertId;
      const generatedOrderNumber = generateOrderNumber(orderId);

      // 2️⃣ Update the correct order_number now
      db.query(
        "UPDATE orders SET order_number = ? WHERE id = ?",
        [generatedOrderNumber, orderId],
        (updateErr) => {
          if (updateErr) {
            console.error("Update order number error:", updateErr);
            return res.status(500).json({ error: "Failed to update order number" });
          }

          // 3️⃣ Insert Items
          const insertItemQuery = `
            INSERT INTO order_items (
              order_number, 
              item_name, 
              product_id,
              mrp, 
              sale_price, 
              price, 
              quantity, 
              total_amount,
              discount_percentage, 
              discount_amount,
              taxable_amount,
              tax_percentage, 
              tax_amount,
              item_total,
              credit_period, 
              credit_percentage,
              sgst_percentage, 
              sgst_amount,
              cgst_percentage, 
              cgst_amount,
              discount_applied_scheme
            ) VALUES ?
          `;

          const values = items.map(item => [
            generatedOrderNumber,
            item.item_name,
            item.product_id,
            item.mrp || 0,
            item.sale_price || item.price,
            item.price,
            item.quantity,
            item.total_amount,
            item.discount_percentage || 0,
            item.discount_amount || 0,
            item.taxable_amount || 0,
            item.tax_percentage || 0,
            item.tax_amount || 0,
            item.item_total,
            item.credit_period || 0,
            item.credit_percentage || 0,
            item.sgst_percentage || 0,
            item.sgst_amount || 0,
            item.cgst_percentage || 0,
            item.cgst_amount || 0,
            item.discount_applied_scheme || 'none'
          ]);

          db.query(insertItemQuery, [values], (itemsErr) => {
            if (itemsErr) {
              console.error("Order items insert error:", itemsErr);
              return res.status(500).json({ error: "Order items insert failed", details: itemsErr.message });
            }

            // 4️⃣ Delete cart items of customer
            db.query(
              "DELETE FROM cart_items WHERE customer_id = ?",
              [customer_id],
              (deleteErr) => {
                if (deleteErr) {
                  console.error("Cart cleanup error:", deleteErr);
                  return res.status(500).json({ error: "Cart cleanup failed" });
                }

                return res.json({
                  success: true,
                  message: "Order placed successfully",
                  order_number: generatedOrderNumber,
                  order_id: orderId
                });
              }
            );
          });
        }
      );
    }
  );
});

// ===================================================
// 📌 PLACE ORDER BY STAFF (Simplified version)
// ===================================================
// Add this route to your existing order routes file
router.post("/place-order-by-staff", (req, res) => {
  const {
    customer_id,
    customer_name,
    order_total,
    discount_amount,
    taxable_amount,
    tax_amount,
    net_payable,
    credit_period,
    estimated_delivery_date,
    order_placed_by, // This should be staff_id
    order_mode,
    items,
    staff_id // Add this parameter
  } = req.body;

  if (!customer_id || !items || items.length === 0) {
    return res.status(400).json({ 
      error: "Customer ID and items are required" 
    });
  }

  // Generate order number
  const orderNumber = "ORD" + Date.now().toString().slice(-8);
  
  // Use staff_id if provided, otherwise use order_placed_by
  const actualStaffId = staff_id || order_placed_by;
  
  if (!actualStaffId) {
    return res.status(400).json({ 
      error: "Staff ID is required" 
    });
  }

  console.log("Staff ID being stored:", actualStaffId);
  console.log("Order placed by (original):", order_placed_by);

  // 1️⃣ Insert into orders - FIXED to include staff_id or use order_placed_by for staff
  const insertOrderQuery = `
    INSERT INTO orders (
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
      order_placed_by,  -- This should store staff_id
      staff_id,         -- If you have this column, otherwise remove
      order_mode,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  const orderValues = [
    orderNumber,
    customer_id,
    customer_name,
    order_total,
    discount_amount || 0,
    taxable_amount,
    tax_amount || 0,
    net_payable,
    credit_period || '0',
    estimated_delivery_date,
    actualStaffId,  // Staff ID goes in order_placed_by
    actualStaffId,  // Also in staff_id if column exists
    order_mode || 'POS',
  ];

  console.log("Order values:", orderValues);

  db.query(
    insertOrderQuery,
    orderValues,
    (err, orderResult) => {
      if (err) {
        console.error("Order insert error:", err);
        return res.status(500).json({ 
          error: "Order insert failed", 
          details: err.message,
          sql: err.sql
        });
      }

      const orderId = orderResult.insertId;

      // 2️⃣ Insert Items
      const insertItemQuery = `
        INSERT INTO order_items (
          order_number, 
          item_name, 
          product_id,
          price, 
          quantity, 
          total_amount,
          discount_percentage, 
          discount_amount,
          taxable_amount,
          tax_percentage, 
          tax_amount,
          item_total,
          credit_period, 
          credit_percentage
        ) VALUES ?
      `;

      const values = items.map(item => [
        orderNumber,
        item.item_name,
        item.product_id,
        item.price,
        item.quantity,
        item.total_amount,
        item.discount_percentage || 0,
        item.discount_amount || 0,
        item.taxable_amount || 0,
        item.tax_percentage || 0,
        item.tax_amount || 0,
        item.item_total || 0,
        item.credit_period || '0',
        item.credit_percentage || 0
      ]);

      db.query(insertItemQuery, [values], (err) => {
        if (err) {
          console.error("Order items insert error:", err);
          return res.status(500).json({ 
            error: "Order items insert failed", 
            details: err.message
          });
        }

        // 3️⃣ Delete cart items of customer
        db.query(
          "DELETE FROM cart_items WHERE customer_id = ?",
          [customer_id],
          (err) => {
            if (err) {
              console.error("Cart cleanup error:", err);
              // Don't fail the order if cart cleanup fails
            }

            return res.json({
              success: true,
              message: "Order placed successfully by staff",
              order_number: orderNumber,
              order_id: orderId,
              net_payable: net_payable,
              staff_id: actualStaffId
            });
          }
        );
      });
    }
  );
});


// ===================================================
// 📌 GET ALL ORDERS
// ===================================================
router.get("/all-orders", (req, res) => {
  db.query("SELECT * FROM orders ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    res.json(rows);
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


// Update the backend route
// Update the backend route
router.post('/create-complete-order', (req, res) => {
  console.log('📦 Creating complete order:', req.body);

  // Accept both structures for backward compatibility
  let orderData, orderItems;
  
  // Check if it's the new structure (from place-order-by-staff)
  if (req.body.customer_id && req.body.items) {
    // Transform staff-order data to complete-order format
    orderData = {
      order_number: req.body.order_number || "ORD" + Date.now().toString().slice(-8),
      customer_id: req.body.customer_id,
      customer_name: req.body.customer_name,
      order_total: req.body.order_total,
      discount_amount: req.body.discount_amount,
      taxable_amount: req.body.taxable_amount,
      tax_amount: req.body.tax_amount,
      net_payable: req.body.net_payable,
      credit_period: req.body.credit_period,
      estimated_delivery_date: req.body.estimated_delivery_date,
      order_placed_by: req.body.order_placed_by, // staff_id
      staff_id: req.body.staff_id || req.body.order_placed_by, // Use staff_id if provided
      order_mode: req.body.order_mode || 'KACHA'
    };
    
    orderItems = req.body.items.map(item => ({
      item_name: item.item_name,
      product_id: item.product_id,
      price: item.price,
      quantity: item.quantity,
      total_amount: item.total_amount,
      discount_percentage: item.discount_percentage,
      discount_amount: item.discount_amount,
      taxable_amount: item.taxable_amount,
      tax_percentage: item.tax_percentage,
      tax_amount: item.tax_amount,
      item_total: item.item_total,
      credit_period: item.credit_period,
      credit_percentage: item.credit_percentage,
      // Set defaults for other fields if not provided
      mrp: item.mrp || item.price,
      sale_price: item.sale_price || item.price,
      sgst_percentage: item.sgst_percentage || 0,
      sgst_amount: item.sgst_amount || 0,
      cgst_percentage: item.cgst_percentage || 0,
      cgst_amount: item.cgst_amount || 0,
      discount_applied_scheme: item.discount_applied_scheme || null
    }));
  } 
  // Original structure
  else if (req.body.order && req.body.orderItems) {
    orderData = req.body.order;
    orderItems = req.body.orderItems;
  } 
  else {
    return res.status(400).json({
      error: 'Invalid request format. Provide either customer_id+items OR order+orderItems'
    });
  }

  // Validate required fields
  if (!orderData.customer_id || !orderItems || orderItems.length === 0) {
    return res.status(400).json({
      error: 'Customer ID and items are required'
    });
  }

  // Validate staff ID
  const staffId = orderData.staff_id || orderData.order_placed_by;
  if (!staffId) {
    return res.status(400).json({
      error: 'Staff ID is required'
    });
  }

  console.log('👤 Staff ID:', staffId);
  console.log('🛒 Order data:', orderData);

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
        // Step 1: Insert into orders table - UPDATED to include staff_id
        const orderQuery = `
          INSERT INTO orders (
            order_number, customer_id, customer_name, order_total, discount_amount,
            taxable_amount, tax_amount, net_payable, credit_period,
            estimated_delivery_date, order_placed_by, staff_id, order_mode,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        const orderValues = [
          orderData.order_number,
          orderData.customer_id,
          orderData.customer_name,
          orderData.order_total,
          orderData.discount_amount || 0,
          orderData.taxable_amount,
          orderData.tax_amount || 0,
          orderData.net_payable,
          orderData.credit_period || '0',
          orderData.estimated_delivery_date,
          staffId, // order_placed_by - staff ID
          staffId, // staff_id - same as order_placed_by
          orderData.order_mode || 'KACHA'
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
          orderData.order_number,
          item.item_name,
          item.product_id,
          item.mrp || item.price,
          item.sale_price || item.price,
          item.price,
          item.quantity,
          item.total_amount,
          item.discount_percentage || 0,
          item.discount_amount || 0,
          item.taxable_amount || 0,
          item.tax_percentage || 0,
          item.tax_amount || 0,
          item.item_total || item.total_amount || 0,
          item.credit_period || '0',
          item.credit_percentage || 0,
          item.sgst_percentage || 0,
          item.sgst_amount || 0,
          item.cgst_percentage || 0,
          item.cgst_amount || 0,
          item.discount_applied_scheme || null
        ]);

        console.log('🚀 Inserting order items:', orderItemValues.length);

        await new Promise((resolve, reject) => {
          connection.query(orderItemQuery, [orderItemValues], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Order items inserted');

        // Step 3: Clear cart items for this customer (optional)
        if (orderData.customer_id && req.body.clear_cart !== false) {
          await new Promise((resolve, reject) => {
            connection.query(
              "DELETE FROM cart_items WHERE customer_id = ?",
              [orderData.customer_id],
              (err, result) => {
                if (err) {
                  console.warn("⚠️ Cart cleanup failed:", err);
                  // Don't reject, just log warning
                  resolve();
                } else {
                  console.log('✅ Cart cleared for customer');
                  resolve();
                }
              }
            );
          });
        }

        // Step 4: Commit transaction
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
          order_number: orderData.order_number,
          order_id: orderResult.insertId,
          net_payable: orderData.net_payable,
          staff_id: staffId,
          message: 'Order created successfully by staff'
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

module.exports = router;
