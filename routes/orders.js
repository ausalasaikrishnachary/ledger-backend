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
router.post('/orders', async (req, res) => {
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

  let connection;
  try {
    connection = await db.getConnection();
    console.log('✅ Database connection established');

    // Check if GST columns exist
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND TABLE_SCHEMA = DATABASE()
    `);
    
    const columnNames = columns.map(col => col.COLUMN_NAME);
    const hasGstRate = columnNames.includes('gst_rate');
    const hasGstAmount = columnNames.includes('gst_amount');

    let query, values;

    if (hasGstRate && hasGstAmount) {
      // Table has GST columns
      query = `
        INSERT INTO orders (category, product, quantity, price, total_price, user_id, status, gst_rate, gst_amount, order_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      values = [category, product, quantity, price, totalPrice, user_id, status || 'pending', gst_rate || 0, gst_amount || 0];
    } else {
      // Table doesn't have GST columns
      query = `
        INSERT INTO orders (category, product, quantity, price, total_price, user_id, status, order_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      values = [category, product, quantity, price, totalPrice, user_id, status || 'pending'];
    }
    
    console.log('🚀 Executing query with values:', values);
    
    const [result] = await connection.execute(query, values);
    console.log('✅ Order inserted with ID:', result.insertId);

    // Fetch the newly created order
    let selectQuery = 'SELECT * FROM orders WHERE id = ?';
    const [orders] = await connection.execute(selectQuery, [result.insertId]);

    if (orders.length === 0) {
      console.log('❌ Failed to retrieve created order');
      return res.status(500).json({ error: 'Failed to retrieve created order' });
    }

    const newOrder = {
      id: orders[0].id,
      category: orders[0].category,
      product: orders[0].product,
      quantity: orders[0].quantity,
      price: parseFloat(orders[0].price),
      totalPrice: parseFloat(orders[0].total_price),
      status: orders[0].status,
      date: orders[0].order_date.toISOString().split('T')[0],
      user_id: orders[0].user_id
    };

    // Add GST fields if they exist
    if (hasGstRate) newOrder.gst_rate = parseFloat(orders[0].gst_rate || 0);
    if (hasGstAmount) newOrder.gst_amount = parseFloat(orders[0].gst_amount || 0);

    console.log('✅ Order created successfully:', newOrder);
    res.status(201).json(newOrder);

  } catch (error) {
    console.error('❌ Database error:', error);
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


// GET /api/orders - Get all orders
router.get('/orders', async (req, res) => {
  try {
    const connection = await db.getConnection();
    const [rows] = await connection.execute(`
      SELECT id, category, product, quantity, price, total_price as totalPrice, 
             status, order_date as date, user_id 
      FROM orders 
      ORDER BY order_date DESC
    `);
    connection.release();

    const orders = rows.map(order => ({
      ...order,
      price: parseFloat(order.price),
      totalPrice: parseFloat(order.totalPrice)
    }));

    res.json(orders);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/user/:userId - Get orders by user ID
router.get('/orders/user/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const connection = await db.getConnection();
    const [rows] = await connection.execute(
      `SELECT id, category, product, quantity, price, total_price as totalPrice, 
              status, order_date as date, user_id 
       FROM orders 
       WHERE user_id = ? 
       ORDER BY order_date DESC`,
      [userId]
    );
    connection.release();

    const orders = rows.map(order => ({
      ...order,
      price: parseFloat(order.price),
      totalPrice: parseFloat(order.totalPrice)
    }));

    res.json(orders);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to fetch user orders' });
  }
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
router.put('/orders/:id', async (req, res) => {
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

  let connection;
  try {
    connection = await db.getConnection();

    // First check if order exists
    const [existingOrders] = await connection.execute(
      'SELECT * FROM orders WHERE id = ?',
      [id]
    );

    if (existingOrders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if the table has the GST columns
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND TABLE_SCHEMA = DATABASE()
    `);
    
    const columnNames = columns.map(col => col.COLUMN_NAME);
    const hasCategoryId = columnNames.includes('category_id');
    const hasProductId = columnNames.includes('product_id');
    const hasBasePrice = columnNames.includes('base_price');
    const hasGstAmount = columnNames.includes('gst_amount');
    const hasGstRate = columnNames.includes('gst_rate');
    const hasTaxType = columnNames.includes('tax_type');

    console.log('Table columns:', columnNames);

    let query, values;

    // Build query based on available columns
    let setClause = `
      SET category = ?, product = ?, quantity = ?, price = ?, total_price = ?, 
          status = ?, updated_at = NOW()
    `;
    values = [category, product, quantity, price, totalPrice, status || 'pending'];

    // Add optional columns if they exist
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

    query = `UPDATE orders ${setClause} WHERE id = ?`;
    values.push(id);

    console.log('🚀 Executing update with values:', values);
    
    const [result] = await connection.execute(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Order not found or no changes made' });
    }

    // Fetch the updated order
    let selectQuery = `
      SELECT id, category, product, quantity, price, total_price as totalPrice, 
             status, order_date as date, user_id
    `;
    
    // Add GST fields to select if they exist
    if (hasBasePrice) selectQuery += ', base_price as basePrice';
    if (hasGstAmount) selectQuery += ', gst_amount as gstAmount';
    if (hasGstRate) selectQuery += ', gst_rate as gstRate';
    if (hasTaxType) selectQuery += ', tax_type as taxType';
    if (hasCategoryId) selectQuery += ', category_id';
    if (hasProductId) selectQuery += ', product_id';
    
    selectQuery += ' FROM orders WHERE id = ?';

    const [updatedOrders] = await connection.execute(selectQuery, [id]);

    if (updatedOrders.length === 0) {
      return res.status(500).json({ error: 'Failed to retrieve updated order' });
    }

    const updatedOrder = {
      ...updatedOrders[0],
      price: parseFloat(updatedOrders[0].price),
      totalPrice: parseFloat(updatedOrders[0].totalPrice)
    };

    // Parse GST fields if they exist
    if (hasBasePrice) updatedOrder.basePrice = parseFloat(updatedOrders[0].basePrice || 0);
    if (hasGstAmount) updatedOrder.gstAmount = parseFloat(updatedOrders[0].gstAmount || 0);
    if (hasGstRate) updatedOrder.gstRate = parseFloat(updatedOrders[0].gstRate || 0);

    console.log('✅ Order updated successfully:', updatedOrder);
    res.json(updatedOrder);

  } catch (error) {
    console.error('❌ Database error:', error);
    res.status(500).json({ 
      error: 'Failed to update order',
      details: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// DELETE /api/orders/:id - Delete an order
router.delete('/orders/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const connection = await db.getConnection();
    const [result] = await connection.execute(
      'DELETE FROM orders WHERE id = ?',
      [id]
    );
    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: 'Order deleted successfully' });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

module.exports = router;