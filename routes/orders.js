const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/orders - Create a new order
// router.post('/orders', async (req, res) => {
//   console.log('📦 Received order request:', req.body);
  
//   const { category, product, quantity, price, totalPrice, user_id, status } = req.body;

//   // Validate required fields
//   if (!category || !product || !quantity || !price || !totalPrice || !user_id) {
//     console.log('❌ Missing required fields:', { category, product, quantity, price, totalPrice, user_id });
//     return res.status(400).json({
//       error: 'Missing required fields: category, product, quantity, price, totalPrice, user_id',
//       received: { category, product, quantity, price, totalPrice, user_id }
//     });
//   }

//   let connection;
//   try {
//     // ✅ Get database connection with better error handling
//     connection = await db.getConnection();
//     console.log('✅ Database connection established');

//     const query = `
//       INSERT INTO orders (category, product, quantity, price, total_price, user_id, status, order_date)
//       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
//     `;
    
//     const values = [category, product, quantity, price, totalPrice, user_id, status || 'pending'];
    
//     console.log('🚀 Executing query with values:', values);
    
//     const [result] = await connection.execute(query, values);
//     console.log('✅ Order inserted with ID:', result.insertId);

//     // Fetch the newly created order
//     const [orders] = await connection.execute(
//       'SELECT * FROM orders WHERE id = ?',
//       [result.insertId]
//     );

//     if (orders.length === 0) {
//       console.log('❌ Failed to retrieve created order');
//       return res.status(500).json({ error: 'Failed to retrieve created order' });
//     }

//     const newOrder = {
//       id: orders[0].id,
//       category: orders[0].category,
//       product: orders[0].product,
//       quantity: orders[0].quantity,
//       price: parseFloat(orders[0].price),
//       totalPrice: parseFloat(orders[0].total_price),
//       status: orders[0].status,
//       date: orders[0].order_date.toISOString().split('T')[0],
//       user_id: orders[0].user_id
//     };

//     console.log('✅ Order created successfully:', newOrder);
//     res.status(201).json(newOrder);

//   } catch (error) {
//     console.error('❌ Database error:', error);
//     res.status(500).json({ 
//       error: 'Failed to create order',
//       details: error.message,
//       sqlMessage: error.sqlMessage // Include SQL error details
//     });
//   } finally {
//     // ✅ Always release connection
//     if (connection) {
//       connection.release();
//       console.log('✅ Database connection released');
//     }
//   }
// });

// POST /api/orders - Create a new order with GST
router.post('/orders', (req, res) => {
  console.log('📦 Received order request:', req.body);

  const { category, product, quantity, price, totalPrice, user_id, status, gst_rate, gst_amount } = req.body;

  // Validate required fields
  if (!category || !product || !quantity || !price || !totalPrice || !user_id) {
    console.log('❌ Missing required fields:', { category, product, quantity, price, totalPrice, user_id });
    return res.status(400).json({
      error: 'Missing required fields: category, product, quantity, price, totalPrice, user_id',
      received: { category, product, quantity, price, totalPrice, user_id }
    });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Database connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    console.log('✅ Database connection established');

    // Check if GST columns exist
    const columnQuery = `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND TABLE_SCHEMA = DATABASE()
    `;

    connection.query(columnQuery, (err, columns) => {
      if (err) {
        connection.release();
        console.error('❌ Failed to fetch table columns:', err);
        return res.status(500).json({ error: 'Failed to check table columns' });
      }

      const columnNames = columns.map(col => col.COLUMN_NAME);
      const hasGstRate = columnNames.includes('gst_rate');
      const hasGstAmount = columnNames.includes('gst_amount');

      let query, values;

      if (hasGstRate && hasGstAmount) {
        query = `
          INSERT INTO orders (category, product, quantity, price, total_price, user_id, status, gst_rate, gst_amount, order_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        values = [category, product, quantity, price, totalPrice, user_id, status || 'pending', gst_rate || 0, gst_amount || 0];
      } else {
        query = `
          INSERT INTO orders (category, product, quantity, price, total_price, user_id, status, order_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        values = [category, product, quantity, price, totalPrice, user_id, status || 'pending'];
      }

      console.log('🚀 Executing query with values:', values);

      connection.query(query, values, (err, result) => {
        if (err) {
          console.error('❌ Insert error:', err);
          connection.release();
          return res.status(500).json({
            error: 'Failed to create order',
            details: err.message,
            sqlMessage: err.sqlMessage
          });
        }

        console.log('✅ Order inserted with ID:', result.insertId);

        // Fetch the newly created order
        const selectQuery = 'SELECT * FROM orders WHERE id = ?';
        connection.query(selectQuery, [result.insertId], (err, rows) => {
          connection.release();

          if (err) {
            console.error('❌ Fetch error:', err);
            return res.status(500).json({ error: 'Failed to retrieve created order' });
          }

          if (rows.length === 0) {
            console.log('❌ No order found after insert');
            return res.status(500).json({ error: 'Failed to retrieve created order' });
          }

          const order = rows[0];
          const newOrder = {
            id: order.id,
            category: order.category,
            product: order.product,
            quantity: order.quantity,
            price: parseFloat(order.price),
            totalPrice: parseFloat(order.total_price),
            status: order.status,
            date: order.order_date.toISOString().split('T')[0],
            user_id: order.user_id
          };

          if (hasGstRate) newOrder.gst_rate = parseFloat(order.gst_rate || 0);
          if (hasGstAmount) newOrder.gst_amount = parseFloat(order.gst_amount || 0);

          console.log('✅ Order created successfully:', newOrder);
          res.status(201).json(newOrder);
        });
      });
    });
  });
});


// GET /api/orders - Get all orders
router.get('/orders', (req, res) => {
  db.getConnection((err, connection) => {
    if (err) {
      console.error('Database connection failed:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }

    const query = `
      SELECT id, category, product, quantity, price, total_price AS totalPrice,
             status, order_date AS date, user_id
      FROM orders
      ORDER BY order_date DESC
    `;

    connection.query(query, (err, rows) => {
      connection.release();

      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to fetch orders' });
      }

      const orders = rows.map(order => ({
        ...order,
        price: parseFloat(order.price),
        totalPrice: parseFloat(order.totalPrice)
      }));

      res.json(orders);
    });
  });
});


// GET /api/orders/user/:userId - Get orders by user ID
router.get('/orders/user/:userId', (req, res) => {
  const { userId } = req.params;

  db.getConnection((err, connection) => {
    if (err) {
      console.error('Database connection failed:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }

    const query = `
      SELECT id, category, product, quantity, price, total_price AS totalPrice,
             status, order_date AS date, user_id
      FROM orders
      WHERE user_id = ?
      ORDER BY order_date DESC
    `;

    connection.query(query, [userId], (err, rows) => {
      connection.release();

      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to fetch user orders' });
      }

      const orders = rows.map(order => ({
        ...order,
        price: parseFloat(order.price),
        totalPrice: parseFloat(order.totalPrice)
      }));

      res.json(orders);
    });
  });
});
// PUT /api/orders/:id - Update an order
// PUT /api/orders/:id - Update an order
// PUT /api/orders/:id - Update an order
// router.put('/orders/:id', async (req, res) => {
//   const { id } = req.params;
//   const { category, product, quantity, price, totalPrice, status, category_id, product_id } = req.body;

//   console.log('📝 Updating order:', id, req.body);

//   // Validate required fields
//   if (!category || !product || !quantity || !price) {
//     return res.status(400).json({ 
//       error: 'Missing required fields: category, product, quantity, price' 
//     });
//   }

//   let connection;
//   try {
//     connection = await db.getConnection();

//     // First check if order exists
//     const [existingOrders] = await connection.execute(
//       'SELECT * FROM orders WHERE id = ?',
//       [id]
//     );

//     if (existingOrders.length === 0) {
//       return res.status(404).json({ error: 'Order not found' });
//     }

//     // Check if the table has the new columns
//     const [columns] = await connection.execute(`
//       SELECT COLUMN_NAME 
//       FROM INFORMATION_SCHEMA.COLUMNS 
//       WHERE TABLE_NAME = 'orders' 
//       AND TABLE_SCHEMA = DATABASE()
//     `);
    
//     const columnNames = columns.map(col => col.COLUMN_NAME);
//     const hasCategoryId = columnNames.includes('category_id');
//     const hasProductId = columnNames.includes('product_id');

//     console.log('Table columns:', columnNames);
//     console.log('Has category_id:', hasCategoryId);
//     console.log('Has product_id:', hasProductId);

//     let query, values;

//     if (hasCategoryId && hasProductId) {
//       // Table has the new columns
//       query = `
//         UPDATE orders 
//         SET category = ?, product = ?, quantity = ?, price = ?, total_price = ?, 
//             status = ?, category_id = ?, product_id = ?, updated_at = NOW()
//         WHERE id = ?
//       `;
//       values = [category, product, quantity, price, totalPrice, status || 'pending', category_id, product_id, id];
//     } else {
//       // Table doesn't have the new columns - use original structure
//       query = `
//         UPDATE orders 
//         SET category = ?, product = ?, quantity = ?, price = ?, total_price = ?, 
//             status = ?, updated_at = NOW()
//         WHERE id = ?
//       `;
//       values = [category, product, quantity, price, totalPrice, status || 'pending', id];
//     }

//     console.log('🚀 Executing update with values:', values);
    
//     const [result] = await connection.execute(query, values);

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ error: 'Order not found or no changes made' });
//     }

//     // Fetch the updated order
//     let selectQuery = `
//       SELECT id, category, product, quantity, price, total_price as totalPrice, 
//              status, order_date as date, user_id
//     `;
    
//     if (hasCategoryId) selectQuery += ', category_id';
//     if (hasProductId) selectQuery += ', product_id';
    
//     selectQuery += ' FROM orders WHERE id = ?';

//     const [updatedOrders] = await connection.execute(selectQuery, [id]);

//     if (updatedOrders.length === 0) {
//       return res.status(500).json({ error: 'Failed to retrieve updated order' });
//     }

//     const updatedOrder = {
//       ...updatedOrders[0],
//       price: parseFloat(updatedOrders[0].price),
//       totalPrice: parseFloat(updatedOrders[0].totalPrice)
//     };

//     console.log('✅ Order updated successfully:', updatedOrder);
//     res.json(updatedOrder);

//   } catch (error) {
//     console.error('❌ Database error:', error);
//     res.status(500).json({ 
//       error: 'Failed to update order',
//       details: error.message
//     });
//   } finally {
//     if (connection) {
//       connection.release();
//     }
//   }
// });


// PUT /api/orders/:id - Update an order with GST
// UPDATE /api/orders/:id - Update an order
router.put('/orders/:id', (req, res) => {
  const { id } = req.params;
  const { 
    category, 
    product, 
    quantity, 
    price, 
    totalPrice, 
    status, 
    category_id, 
    product_id,
    basePrice,
    gstAmount,
    gstRate,
    taxType
  } = req.body;

  console.log('📝 Updating order with GST:', id, req.body);

  // Validate required fields
  if (!category || !product || !quantity || !price) {
    return res.status(400).json({ 
      error: 'Missing required fields: category, product, quantity, price' 
    });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Database connection failed:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }

    // Step 1: Check if order exists
    connection.query('SELECT * FROM orders WHERE id = ?', [id], (err, existingOrders) => {
      if (err) {
        connection.release();
        console.error('❌ Error checking order existence:', err);
        return res.status(500).json({ error: 'Failed to check order existence' });
      }

      if (existingOrders.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Order not found' });
      }

      // Step 2: Check for optional columns
      const columnQuery = `
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'orders' 
        AND TABLE_SCHEMA = DATABASE()
      `;

      connection.query(columnQuery, (err, columns) => {
        if (err) {
          connection.release();
          console.error('❌ Failed to fetch table columns:', err);
          return res.status(500).json({ error: 'Failed to check table columns' });
        }

        const columnNames = columns.map(col => col.COLUMN_NAME);
        const hasCategoryId = columnNames.includes('category_id');
        const hasProductId = columnNames.includes('product_id');
        const hasBasePrice = columnNames.includes('base_price');
        const hasGstAmount = columnNames.includes('gst_amount');
        const hasGstRate = columnNames.includes('gst_rate');
        const hasTaxType = columnNames.includes('tax_type');

        console.log('📊 Table columns:', columnNames);

        // Step 3: Build update query dynamically
        let setClause = `
          SET category = ?, product = ?, quantity = ?, price = ?, total_price = ?, 
              status = ?, updated_at = NOW()
        `;
        let values = [category, product, quantity, price, totalPrice, status || 'pending'];

        if (hasCategoryId) {
          setClause += ', category_id = ?';
          values.push(category_id);
        }
        if (hasProductId) {
          setClause += ', product_id = ?';
          values.push(product_id);
        }
        if (hasBasePrice) {
          setClause += ', base_price = ?';
          values.push(basePrice || 0);
        }
        if (hasGstAmount) {
          setClause += ', gst_amount = ?';
          values.push(gstAmount || 0);
        }
        if (hasGstRate) {
          setClause += ', gst_rate = ?';
          values.push(gstRate || 0);
        }
        if (hasTaxType) {
          setClause += ', tax_type = ?';
          values.push(taxType || 'exclusive');
        }

        const query = `UPDATE orders ${setClause} WHERE id = ?`;
        values.push(id);

        console.log('🚀 Executing update with values:', values);

        // Step 4: Run the update
        connection.query(query, values, (err, result) => {
          if (err) {
            connection.release();
            console.error('❌ Update error:', err);
            return res.status(500).json({
              error: 'Failed to update order',
              details: err.message,
            });
          }

          if (result.affectedRows === 0) {
            connection.release();
            return res.status(404).json({ error: 'Order not found or no changes made' });
          }

          // Step 5: Fetch updated order
          let selectQuery = `
            SELECT id, category, product, quantity, price, total_price AS totalPrice, 
                   status, order_date AS date, user_id
          `;

          if (hasBasePrice) selectQuery += ', base_price AS basePrice';
          if (hasGstAmount) selectQuery += ', gst_amount AS gstAmount';
          if (hasGstRate) selectQuery += ', gst_rate AS gstRate';
          if (hasTaxType) selectQuery += ', tax_type AS taxType';
          if (hasCategoryId) selectQuery += ', category_id';
          if (hasProductId) selectQuery += ', product_id';

          selectQuery += ' FROM orders WHERE id = ?';

          connection.query(selectQuery, [id], (err, updatedOrders) => {
            connection.release();

            if (err) {
              console.error('❌ Fetch updated order error:', err);
              return res.status(500).json({ error: 'Failed to retrieve updated order' });
            }

            if (updatedOrders.length === 0) {
              return res.status(500).json({ error: 'Failed to retrieve updated order' });
            }

            const updatedOrder = updatedOrders[0];
            const parsedOrder = {
              ...updatedOrder,
              price: parseFloat(updatedOrder.price),
              totalPrice: parseFloat(updatedOrder.totalPrice),
            };

            if (hasBasePrice) parsedOrder.basePrice = parseFloat(updatedOrder.basePrice || 0);
            if (hasGstAmount) parsedOrder.gstAmount = parseFloat(updatedOrder.gstAmount || 0);
            if (hasGstRate) parsedOrder.gstRate = parseFloat(updatedOrder.gstRate || 0);

            console.log('✅ Order updated successfully:', parsedOrder);
            res.json(parsedOrder);
          });
        });
      });
    });
  });
});


// DELETE /api/orders/:id - Delete an order
router.delete('/orders/:id', (req, res) => {
  const { id } = req.params;

  db.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Database connection failed:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }

    const query = 'DELETE FROM orders WHERE id = ?';
    connection.query(query, [id], (err, result) => {
      connection.release();

      if (err) {
        console.error('❌ Delete error:', err);
        return res.status(500).json({ error: 'Failed to delete order' });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }

      console.log('🗑️ Order deleted successfully:', id);
      res.json({ message: 'Order deleted successfully' });
    });
  });
});


module.exports = router;