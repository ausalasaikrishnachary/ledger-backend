const express = require('express');
const router = express.Router();
const db = require('../db');


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
// router.post('/orders', (req, res) => {
//   console.log('📦 Received order request:', req.body);

//   const { 
//     category, 
//     product, 
//     quantity, 
//     price, 
//     totalPrice, 
//     user_id, 
//     status, 
//     gst_rate, 
//     gst_amount, 
//     basePrice,
//     tax_type,
//     category_id, 
//     product_id 
//   } = req.body;

//   // Validate required fields
//   if (!category || !product || !quantity || !price || !totalPrice || !user_id || !category_id || !product_id) {
//     console.log('❌ Missing required fields:', { 
//       category, 
//       product, 
//       quantity, 
//       price, 
//       totalPrice, 
//       user_id, 
//       category_id, 
//       product_id 
//     });
//     return res.status(400).json({
//       error: 'Missing required fields: category, product, quantity, price, totalPrice, user_id, category_id, product_id',
//       received: { category, product, quantity, price, totalPrice, user_id, category_id, product_id }
//     });
//   }

//   db.getConnection((err, connection) => {
//     if (err) {
//       console.error('❌ Database connection error:', err);
//       return res.status(500).json({ error: 'Database connection failed' });
//     }
//     console.log('✅ Database connection established');

//     // Check if required columns exist
//     const columnQuery = `
//       SELECT COLUMN_NAME 
//       FROM INFORMATION_SCHEMA.COLUMNS 
//       WHERE TABLE_NAME = 'orders' 
//       AND TABLE_SCHEMA = DATABASE()
//     `;

//     connection.query(columnQuery, (err, columns) => {
//       if (err) {
//         connection.release();
//         console.error('❌ Failed to fetch table columns:', err);
//         return res.status(500).json({ error: 'Failed to check table columns' });
//       }

//       const columnNames = columns.map(col => col.COLUMN_NAME);
//       const hasGstRate = columnNames.includes('gst_rate');
//       const hasGstAmount = columnNames.includes('gst_amount');
//       const hasBasePrice = columnNames.includes('base_price');
//       const hasTaxType = columnNames.includes('tax_type');
//       const hasCategoryId = columnNames.includes('category_id');
//       const hasProductId = columnNames.includes('product_id');

//       let query, values;

//       // Build dynamic query based on available columns
//       if (hasCategoryId && hasProductId) {
//         query = `
//           INSERT INTO orders (
//             category, product, quantity, price, total_price, user_id, status, 
//             category_id, product_id
//             ${hasGstRate ? ', gst_rate' : ''}
//             ${hasGstAmount ? ', gst_amount' : ''}
//             ${hasBasePrice ? ', base_price' : ''}
//             ${hasTaxType ? ', tax_type' : ''}
//             , order_date
//           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?
//             ${hasGstRate ? ', ?' : ''}
//             ${hasGstAmount ? ', ?' : ''}
//             ${hasBasePrice ? ', ?' : ''}
//             ${hasTaxType ? ', ?' : ''}
//             , NOW())
//         `;
        
//         values = [
//           category, product, quantity, price, totalPrice, user_id, status || 'pending',
//           category_id, product_id
//         ];
        
//         if (hasGstRate) values.push(gst_rate || 0);
//         if (hasGstAmount) values.push(gst_amount || 0);
//         if (hasBasePrice) values.push(basePrice || 0);
//         if (hasTaxType) values.push(tax_type || 'exclusive');
//       } else {
//         // Fallback if new columns don't exist
//         query = `
//           INSERT INTO orders (category, product, quantity, price, total_price, user_id, status, order_date)
//           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
//         `;
//         values = [category, product, quantity, price, totalPrice, user_id, status || 'pending'];
//       }

//       console.log('🚀 Executing query with values:', values);

//       connection.query(query, values, (err, result) => {
//         if (err) {
//           console.error('❌ Insert error:', err);
//           connection.release();
//           return res.status(500).json({
//             error: 'Failed to create order',
//             details: err.message,
//             sqlMessage: err.sqlMessage
//           });
//         }

//         console.log('✅ Order inserted with ID:', result.insertId);

//         // Fetch the newly created order
//         const selectQuery = 'SELECT * FROM orders WHERE id = ?';
//         connection.query(selectQuery, [result.insertId], (err, rows) => {
//           connection.release();

//           if (err) {
//             console.error('❌ Fetch error:', err);
//             return res.status(500).json({ error: 'Failed to retrieve created order' });
//           }

//           if (rows.length === 0) {
//             console.log('❌ No order found after insert');
//             return res.status(500).json({ error: 'Failed to retrieve created order' });
//           }

//           const order = rows[0];
//           const newOrder = {
//             id: order.id,
//             category: order.category,
//             product: order.product,
//             quantity: order.quantity,
//             price: parseFloat(order.price),
//             totalPrice: parseFloat(order.total_price),
//             status: order.status,
//             date: order.order_date.toISOString().split('T')[0],
//             user_id: order.user_id
//           };

//           // Add additional fields if they exist
//           if (hasGstRate) newOrder.gst_rate = parseFloat(order.gst_rate || 0);
//           if (hasGstAmount) newOrder.gst_amount = parseFloat(order.gst_amount || 0);
//           if (hasBasePrice) newOrder.basePrice = parseFloat(order.base_price || 0);
//           if (hasTaxType) newOrder.taxType = order.tax_type || 'exclusive';
//           if (hasCategoryId) newOrder.category_id = order.category_id;
//           if (hasProductId) newOrder.product_id = order.product_id;

//           console.log('✅ Order created successfully:', newOrder);
//           res.status(201).json(newOrder);
//         });
//       });
//     });
//   });
// });

router.post('/orders', (req, res) => {
  console.log('📦 Received order request:', req.body);

  const { 
    category, 
    product, 
    quantity, 
    price, 
    totalPrice, 
    user_id, 
    status, 
    gst_rate, 
    gst_amount, 
    basePrice,
    tax_type,
    category_id, 
    product_id 
  } = req.body;

  // Validate required fields
  if (!category || !product || !quantity || !price || !totalPrice || !user_id || !category_id || !product_id) {
    console.log('❌ Missing required fields:', { 
      category, product, quantity, price, totalPrice, user_id, category_id, product_id 
    });
    return res.status(400).json({
      error: 'Missing required fields',
      received: { category, product, quantity, price, totalPrice, user_id, category_id, product_id }
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
        // Step 1: Insert the order
        const columnQuery = `
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'orders' 
          AND TABLE_SCHEMA = DATABASE()
        `;

        const columns = await new Promise((resolve, reject) => {
          connection.query(columnQuery, (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });

        const columnNames = columns.map(col => col.COLUMN_NAME);
        const hasGstRate = columnNames.includes('gst_rate');
        const hasGstAmount = columnNames.includes('gst_amount');
        const hasBasePrice = columnNames.includes('base_price');
        const hasTaxType = columnNames.includes('tax_type');
        const hasCategoryId = columnNames.includes('category_id');
        const hasProductId = columnNames.includes('product_id');

        let orderQuery, orderValues;

        if (hasCategoryId && hasProductId) {
          orderQuery = `
            INSERT INTO orders (
              category, product, quantity, price, total_price, user_id, status, 
              category_id, product_id
              ${hasBasePrice ? ', base_price' : ''}
              ${hasGstRate ? ', gst_rate' : ''}
              ${hasGstAmount ? ', gst_amount' : ''}
              ${hasTaxType ? ', tax_type' : ''}
              , order_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?
              ${hasBasePrice ? ', ?' : ''}
              ${hasGstRate ? ', ?' : ''}
              ${hasGstAmount ? ', ?' : ''}
              ${hasTaxType ? ', ?' : ''}
              , NOW())
          `;
          
          orderValues = [
            category, product, quantity, price, totalPrice, user_id, status || 'pending',
            category_id, product_id
          ];
          
          if (hasBasePrice) orderValues.push(basePrice || 0);
          if (hasGstRate) orderValues.push(gst_rate || 0);
          if (hasGstAmount) orderValues.push(gst_amount || 0);
          if (hasTaxType) orderValues.push(tax_type || 'exclusive');
        } else {
          orderQuery = `
            INSERT INTO orders (category, product, quantity, price, total_price, user_id, status, order_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          `;
          orderValues = [category, product, quantity, price, totalPrice, user_id, status || 'pending'];
        }

        console.log('🚀 Inserting order with values:', orderValues);

        const orderResult = await new Promise((resolve, reject) => {
          connection.query(orderQuery, orderValues, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Order inserted with ID:', orderResult.insertId);

        // Step 2: Update stock table - directly store opening_stock from products
        const stockQuery = `
          INSERT INTO stock (product_id, price_per_unit, opening_stock, stock_out, balance_stock, date)
          VALUES (?, ?, ?, ?, ?, CURDATE())
        `;

        // Get opening_stock from products table
        const productResult = await new Promise((resolve, reject) => {
          connection.query(
            'SELECT opening_stock, balance_stock FROM products WHERE id = ?', 
            [product_id], 
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });

        let openingStock = 0;
        let currentBalanceStock = 0;
        
        if (productResult.length > 0) {
          openingStock = parseFloat(productResult[0].opening_stock) || 0;
          currentBalanceStock = parseFloat(productResult[0].balance_stock) || 0;
        }

        const stockOutValue = parseInt(quantity);
        const newBalanceStock = currentBalanceStock - stockOutValue;

        console.log('📊 Stock update:', {
          product_id,
          opening_stock: openingStock, // Direct from products table
          stockOut: stockOutValue,
          current_balance: currentBalanceStock,
          new_balance: newBalanceStock
        });

        const stockResult = await new Promise((resolve, reject) => {
          connection.query(stockQuery, [
            product_id,
            price,
            openingStock,      // Direct opening_stock value from products
            stockOutValue,     // stock_out
            newBalanceStock    // balance_stock (still calculated for stock table)
          ], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Stock record inserted with ID:', stockResult.insertId);

        // Step 3: Update products table balance_stock
        const updateProductQuery = `
          UPDATE products 
          SET balance_stock = ?, updated_at = NOW()
          WHERE id = ?
        `;

        const updateResult = await new Promise((resolve, reject) => {
          connection.query(updateProductQuery, [
            newBalanceStock,
            product_id
          ], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Product balance stock updated:', updateResult.affectedRows);

        // Commit transaction
        await new Promise((resolve, reject) => {
          connection.commit((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        console.log('✅ Transaction committed successfully');

        // Fetch the newly created order with proper field selection
        let selectQuery = `
          SELECT id, category, product, quantity, price, total_price AS totalPrice, 
                 status, order_date, user_id
        `;

        if (hasBasePrice) selectQuery += ', base_price AS basePrice';
        if (hasGstAmount) selectQuery += ', gst_amount AS gstAmount';
        if (hasGstRate) selectQuery += ', gst_rate AS gstRate';
        if (hasTaxType) selectQuery += ', tax_type AS taxType';
        if (hasCategoryId) selectQuery += ', category_id';
        if (hasProductId) selectQuery += ', product_id';

        selectQuery += ' FROM orders WHERE id = ?';

        const updatedOrders = await new Promise((resolve, reject) => {
          connection.query(selectQuery, [orderResult.insertId], (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });

        connection.release();

        if (updatedOrders.length === 0) {
          return res.status(500).json({ error: 'Failed to retrieve created order' });
        }

        const order = updatedOrders[0];
        
        // Safely handle date formatting
        let orderDate;
        if (order.order_date) {
          if (order.order_date instanceof Date) {
            orderDate = order.order_date.toISOString().split('T')[0];
          } else if (typeof order.order_date === 'string') {
            orderDate = order.order_date.split('T')[0];
          } else {
            orderDate = new Date().toISOString().split('T')[0];
          }
        } else {
          orderDate = new Date().toISOString().split('T')[0];
        }

        const newOrder = {
          id: order.id,
          category: order.category,
          product: order.product,
          quantity: order.quantity,
          price: parseFloat(order.price),
          totalPrice: parseFloat(order.totalPrice),
          status: order.status,
          date: orderDate,
          user_id: order.user_id
        };

        // Add optional fields if they exist
        if (hasBasePrice) newOrder.basePrice = parseFloat(order.basePrice || 0);
        if (hasGstAmount) newOrder.gstAmount = parseFloat(order.gstAmount || 0);
        if (hasGstRate) newOrder.gstRate = parseFloat(order.gstRate || 0);
        if (hasTaxType) newOrder.taxType = order.taxType || 'exclusive';
        if (hasCategoryId) newOrder.category_id = order.category_id;
        if (hasProductId) newOrder.product_id = order.product_id;

        console.log('✅ Order created successfully:', newOrder);
        res.status(201).json(newOrder);

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
// router.put('/orders/:id', (req, res) => {
//   const { id } = req.params;
//   const { 
//     category, 
//     product, 
//     quantity, 
//     price, 
//     totalPrice, 
//     status, 
//     category_id, 
//     product_id,
//     basePrice,
//     gstAmount,
//     gstRate,
//     taxType  // Make sure this matches frontend
//   } = req.body;

//   console.log('📝 Updating order with GST:', id, req.body);

//   // Validate required fields
//   if (!category || !product || !quantity || !price || !totalPrice) {
//     return res.status(400).json({ 
//       error: 'Missing required fields: category, product, quantity, price, totalPrice' 
//     });
//   }

//   db.getConnection((err, connection) => {
//     if (err) {
//       console.error('❌ Database connection failed:', err);
//       return res.status(500).json({ error: 'Database connection failed' });
//     }

//     // Step 1: Check if order exists
//     connection.query('SELECT * FROM orders WHERE id = ?', [id], (err, existingOrders) => {
//       if (err) {
//         connection.release();
//         console.error('❌ Error checking order existence:', err);
//         return res.status(500).json({ error: 'Failed to check order existence' });
//       }

//       if (existingOrders.length === 0) {
//         connection.release();
//         return res.status(404).json({ error: 'Order not found' });
//       }

//       // Step 2: Check for optional columns
//       const columnQuery = `
//         SELECT COLUMN_NAME 
//         FROM INFORMATION_SCHEMA.COLUMNS 
//         WHERE TABLE_NAME = 'orders' 
//         AND TABLE_SCHEMA = DATABASE()
//       `;

//       connection.query(columnQuery, (err, columns) => {
//         if (err) {
//           connection.release();
//           console.error('❌ Failed to fetch table columns:', err);
//           return res.status(500).json({ error: 'Failed to check table columns' });
//         }

//         const columnNames = columns.map(col => col.COLUMN_NAME);
//         const hasCategoryId = columnNames.includes('category_id');
//         const hasProductId = columnNames.includes('product_id');
//         const hasBasePrice = columnNames.includes('base_price');
//         const hasGstAmount = columnNames.includes('gst_amount');
//         const hasGstRate = columnNames.includes('gst_rate');
//         const hasTaxType = columnNames.includes('tax_type');

//         console.log('📊 Table columns:', columnNames);
//         console.log('📦 Received data for update:', {
//           category_id, product_id, basePrice, gstAmount, gstRate, taxType
//         });

//         // Step 3: Build update query dynamically
//         let setClause = `
//           SET category = ?, product = ?, quantity = ?, price = ?, total_price = ?, 
//               status = ?, updated_at = NOW()
//         `;
//         let values = [category, product, quantity, price, totalPrice, status || 'pending'];

//         // Add optional fields if they exist in the table
//         if (hasCategoryId) {
//           setClause += ', category_id = ?';
//           values.push(category_id || null);
//         }
//         if (hasProductId) {
//           setClause += ', product_id = ?';
//           values.push(product_id || null);
//         }
//         if (hasBasePrice) {
//           setClause += ', base_price = ?';
//           values.push(basePrice || 0);
//         }
//         if (hasGstAmount) {
//           setClause += ', gst_amount = ?';
//           values.push(gstAmount || 0);
//         }
//         if (hasGstRate) {
//           setClause += ', gst_rate = ?';
//           values.push(gstRate || 0);
//         }
//         if (hasTaxType) {
//           setClause += ', tax_type = ?';
//           values.push(taxType || 'exclusive');
//         }

//         const query = `UPDATE orders ${setClause} WHERE id = ?`;
//         values.push(id);

//         console.log('🚀 Executing update query:', query);
//         console.log('📋 With values:', values);

//         // Step 4: Run the update
//         connection.query(query, values, (err, result) => {
//           if (err) {
//             connection.release();
//             console.error('❌ Update error:', err);
//             return res.status(500).json({
//               error: 'Failed to update order',
//               details: err.message,
//               sqlMessage: err.sqlMessage
//             });
//           }

//           if (result.affectedRows === 0) {
//             connection.release();
//             return res.status(404).json({ error: 'Order not found or no changes made' });
//           }

//           console.log('✅ Order updated, affected rows:', result.affectedRows);

//           // Step 5: Fetch updated order
//           let selectQuery = `
//             SELECT id, category, product, quantity, price, total_price AS totalPrice, 
//                    status, order_date AS date, user_id
//           `;

//           // Add all the GST and ID fields for the response
//           if (hasBasePrice) selectQuery += ', base_price AS basePrice';
//           if (hasGstAmount) selectQuery += ', gst_amount AS gstAmount';
//           if (hasGstRate) selectQuery += ', gst_rate AS gstRate';
//           if (hasTaxType) selectQuery += ', tax_type AS taxType';
//           if (hasCategoryId) selectQuery += ', category_id';
//           if (hasProductId) selectQuery += ', product_id';

//           selectQuery += ' FROM orders WHERE id = ?';

//           console.log('🔍 Fetching updated order with query:', selectQuery);

//           connection.query(selectQuery, [id], (err, updatedOrders) => {
//             connection.release();

//             if (err) {
//               console.error('❌ Fetch updated order error:', err);
//               return res.status(500).json({ error: 'Failed to retrieve updated order' });
//             }

//             if (updatedOrders.length === 0) {
//               return res.status(500).json({ error: 'Failed to retrieve updated order' });
//             }

//             const updatedOrder = updatedOrders[0];
            
//             // Parse all numeric fields
//             const parsedOrder = {
//               id: updatedOrder.id,
//               category: updatedOrder.category,
//               product: updatedOrder.product,
//               quantity: updatedOrder.quantity,
//               price: parseFloat(updatedOrder.price),
//               totalPrice: parseFloat(updatedOrder.totalPrice),
//               status: updatedOrder.status,
//               date: updatedOrder.order_date ? updatedOrder.order_date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
//               user_id: updatedOrder.user_id
//             };

//             // Add optional fields if they exist
//             if (hasBasePrice) parsedOrder.basePrice = parseFloat(updatedOrder.basePrice || 0);
//             if (hasGstAmount) parsedOrder.gstAmount = parseFloat(updatedOrder.gstAmount || 0);
//             if (hasGstRate) parsedOrder.gstRate = parseFloat(updatedOrder.gstRate || 0);
//             if (hasTaxType) parsedOrder.taxType = updatedOrder.taxType || 'exclusive';
//             if (hasCategoryId) parsedOrder.category_id = updatedOrder.category_id;
//             if (hasProductId) parsedOrder.product_id = updatedOrder.product_id;

//             console.log('✅ Order updated successfully:', parsedOrder);
//             res.json(parsedOrder);
//           });
//         });
//       });
//     });
//   });
// });

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

  console.log('📝 Updating order:', id, req.body);

  if (!category || !product || !quantity || !price || !totalPrice) {
    return res.status(400).json({ 
      error: 'Missing required fields: category, product, quantity, price, totalPrice' 
    });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Database connection failed:', err);
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
        // Step 1: Get old order data to revert stock
        const oldOrderResult = await new Promise((resolve, reject) => {
          connection.query(
            'SELECT quantity, product_id FROM orders WHERE id = ?', 
            [id], 
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });

        if (oldOrderResult.length === 0) {
          connection.rollback(() => {
            connection.release();
            return res.status(404).json({ error: 'Order not found' });
          });
          return;
        }

        const oldOrder = oldOrderResult[0];
        const oldQuantity = parseInt(oldOrder.quantity);
        const newQuantity = parseInt(quantity);
        const quantityDifference = newQuantity - oldQuantity;

        console.log('📊 Stock difference calculation:', {
          oldQuantity,
          newQuantity,
          quantityDifference,
          product_id: oldOrder.product_id
        });

        // Step 2: Update the order
        const columnQuery = `
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'orders' 
          AND TABLE_SCHEMA = DATABASE()
        `;

        const columns = await new Promise((resolve, reject) => {
          connection.query(columnQuery, (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });

        const columnNames = columns.map(col => col.COLUMN_NAME);
        const hasCategoryId = columnNames.includes('category_id');
        const hasProductId = columnNames.includes('product_id');
        const hasBasePrice = columnNames.includes('base_price');
        const hasGstAmount = columnNames.includes('gst_amount');
        const hasGstRate = columnNames.includes('gst_rate');
        const hasTaxType = columnNames.includes('tax_type');

        let setClause = `
          SET category = ?, product = ?, quantity = ?, price = ?, total_price = ?, 
              status = ?, updated_at = NOW()
        `;
        let values = [category, product, quantity, price, totalPrice, status || 'pending'];

        if (hasCategoryId) {
          setClause += ', category_id = ?';
          values.push(category_id || null);
        }
        if (hasProductId) {
          setClause += ', product_id = ?';
          values.push(product_id || null);
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

        console.log('🚀 Updating order with values:', values);

        const updateResult = await new Promise((resolve, reject) => {
          connection.query(query, values, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        if (updateResult.affectedRows === 0) {
          connection.rollback(() => {
            connection.release();
            return res.status(404).json({ error: 'Order not found or no changes made' });
          });
          return;
        }

        console.log('✅ Order updated, affected rows:', updateResult.affectedRows);

        // Step 3: Update stock - always update to reflect the change
        // Get current stock information from products table
        const productResult = await new Promise((resolve, reject) => {
          connection.query(
            'SELECT opening_stock, balance_stock FROM products WHERE id = ?', 
            [oldOrder.product_id], 
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });

        let openingStock = 0;
        let currentBalanceStock = 0;
        
        if (productResult.length > 0) {
          openingStock = parseFloat(productResult[0].opening_stock) || 0;
          currentBalanceStock = parseFloat(productResult[0].balance_stock) || 0;
        }

        // Calculate new balance stock: revert old quantity and apply new quantity
        // First add back the old quantity (revert), then subtract the new quantity
        const revertedStock = currentBalanceStock + oldQuantity;
        const newBalanceStock = revertedStock - newQuantity;

        console.log('📊 Stock adjustment:', {
          product_id: oldOrder.product_id,
          current_balance: currentBalanceStock,
          old_quantity_reverted: oldQuantity,
          reverted_stock: revertedStock,
          new_quantity_applied: newQuantity,
          new_balance: newBalanceStock,
          net_change: quantityDifference
        });

        // Insert stock record to track this adjustment
        const stockQuery = `
          INSERT INTO stock (product_id, price_per_unit, opening_stock, stock_out, balance_stock, date, notes)
          VALUES (?, ?, ?, ?, ?, CURDATE(), ?)
        `;

        const stockOutValue = newQuantity; // Show the new order quantity as stock_out
        const notes = `Order #${id} updated: ${oldQuantity} → ${newQuantity} units`;

        const stockResult = await new Promise((resolve, reject) => {
          connection.query(stockQuery, [
            oldOrder.product_id,
            price,
            openingStock,      // Direct opening_stock value from products
            stockOutValue,     // stock_out - the new order quantity
            newBalanceStock,   // balance_stock after adjustment
            notes             // Add notes to explain the adjustment
          ], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Stock adjustment record inserted with ID:', stockResult.insertId);

        // Update products table balance_stock
        const updateProductQuery = `
          UPDATE products 
          SET balance_stock = ?, updated_at = NOW()
          WHERE id = ?
        `;

        const updateProductResult = await new Promise((resolve, reject) => {
          connection.query(updateProductQuery, [
            newBalanceStock,
            oldOrder.product_id
          ], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log('✅ Product balance stock updated:', updateProductResult.affectedRows);

        // Commit transaction
        await new Promise((resolve, reject) => {
          connection.commit((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        console.log('✅ Transaction committed successfully');

        // Fetch updated order
        let selectQuery = `
          SELECT id, category, product, quantity, price, total_price AS totalPrice, 
                 status, order_date, user_id
        `;

        if (hasBasePrice) selectQuery += ', base_price AS basePrice';
        if (hasGstAmount) selectQuery += ', gst_amount AS gstAmount';
        if (hasGstRate) selectQuery += ', gst_rate AS gstRate';
        if (hasTaxType) selectQuery += ', tax_type AS taxType';
        if (hasCategoryId) selectQuery += ', category_id';
        if (hasProductId) selectQuery += ', product_id';

        selectQuery += ' FROM orders WHERE id = ?';

        const updatedOrders = await new Promise((resolve, reject) => {
          connection.query(selectQuery, [id], (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });

        connection.release();

        if (updatedOrders.length === 0) {
          return res.status(500).json({ error: 'Failed to retrieve updated order' });
        }

        const updatedOrder = updatedOrders[0];
        
        // Safely handle date formatting
        let orderDate;
        if (updatedOrder.order_date) {
          if (updatedOrder.order_date instanceof Date) {
            orderDate = updatedOrder.order_date.toISOString().split('T')[0];
          } else if (typeof updatedOrder.order_date === 'string') {
            orderDate = updatedOrder.order_date.split('T')[0];
          } else {
            orderDate = new Date().toISOString().split('T')[0];
          }
        } else {
          orderDate = new Date().toISOString().split('T')[0];
        }

        const parsedOrder = {
          id: updatedOrder.id,
          category: updatedOrder.category,
          product: updatedOrder.product,
          quantity: updatedOrder.quantity,
          price: parseFloat(updatedOrder.price),
          totalPrice: parseFloat(updatedOrder.totalPrice),
          status: updatedOrder.status,
          date: orderDate,
          user_id: updatedOrder.user_id
        };

        if (hasBasePrice) parsedOrder.basePrice = parseFloat(updatedOrder.basePrice || 0);
        if (hasGstAmount) parsedOrder.gstAmount = parseFloat(updatedOrder.gstAmount || 0);
        if (hasGstRate) parsedOrder.gstRate = parseFloat(updatedOrder.gstRate || 0);
        if (hasTaxType) parsedOrder.taxType = updatedOrder.taxType || 'exclusive';
        if (hasCategoryId) parsedOrder.category_id = updatedOrder.category_id;
        if (hasProductId) parsedOrder.product_id = updatedOrder.product_id;

        console.log('✅ Order updated successfully:', parsedOrder);
        res.json(parsedOrder);

      } catch (error) {
        // Rollback transaction on error
        connection.rollback(() => {
          connection.release();
          console.error('❌ Transaction error, rolled back:', error);
          res.status(500).json({
            error: 'Failed to update order',
            details: error.message,
            sqlMessage: error.sqlMessage
          });
        });
      }
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