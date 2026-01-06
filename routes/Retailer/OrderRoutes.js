const express = require("express");
const router = express.Router();
const db = require('./../../db');


// ===================================================
// 📌 GET ALL ORDERS
// ===================================================
router.get("/all-orders", (req, res) => {
  db.query("SELECT * FROM orders ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err });

    // Sync order status with invoice status
    const syncedOrders = rows.map(order => {
      let correctedStatus = order.order_status;

      if (order.invoice_status === 1 && order.order_status !== 'Cancelled') {
        correctedStatus = 'Invoice';
      } else if (order.invoice_status === 0 && order.order_status === 'Invoice') {
        correctedStatus = 'Pending';
      }

      return {
        ...order,
        order_status: correctedStatus,
        canGenerateInvoice: order.invoice_status === 0 || order.invoice_status === null
      };
    });

    res.json(syncedOrders);
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
            estimated_delivery_date, order_placed_by, ordered_by, staff_id , assigned_staff, staff_incentive , order_mode,approval_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?, NOW())
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
          order.ordered_by,
          order.staffid,
          order.assigned_staff,
          order.staff_incentive,
          order.order_mode,
          order.approval_status,
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

        // Step 3: Clear cart items for this customer and staff
        // Assuming the cart table is named 'cart_items' based on your data structure
        const clearCartQuery = `
          DELETE FROM cart_items 
          WHERE customer_id = ? AND staff_id = ?
        `;

        const clearCartValues = [
          order.customer_id,
          order.order_placed_by // staff_id is stored here
        ];

        console.log('🛒 Clearing cart for customer:', order.customer_id, 'and staff:', order.order_placed_by);

        const clearCartResult = await new Promise((resolve, reject) => {
          connection.query(clearCartQuery, clearCartValues, (err, result) => {
            if (err) reject(err);
            else {
              console.log('✅ Cart cleared, affected rows:', result.affectedRows);
              resolve(result);
            }
          });
        });

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
          cart_cleared: clearCartResult.affectedRows,
          message: 'Order created successfully and cart cleared'
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

      // Sync order status with invoice status
      const syncedOrders = rows.map(order => {
        // Auto-correct status based on invoice_status
        let correctedStatus = order.order_status;

        if (order.invoice_status === 1 && order.order_status !== 'Cancelled') {
          correctedStatus = 'Invoice';
          // Auto-update in database if needed
          if (order.order_status !== 'Invoice') {
            db.query(
              "UPDATE orders SET order_status = 'Invoice' WHERE order_number = ?",
              [order.order_number]
            );
          }
        } else if (order.invoice_status === 0 && order.order_status === 'Invoice') {
          correctedStatus = 'Pending';
        }

        return {
          ...order,
          order_status: correctedStatus
        };
      });

      res.json(syncedOrders);
    }
  );
});


router.put("/cancel/:order_number", (req, res) => {
  const { order_number } = req.params;

  // First, check if order exists and invoice_status is 0
  db.query(
    "SELECT invoice_status FROM orders WHERE order_number = ?",
    [order_number],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err });

      if (rows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const order = rows[0];

      // Check if invoice_status is 0 (invoice not generated)
      if (order.invoice_status !== 0) {
        return res.status(400).json({
          error: "Cannot cancel order. Invoice has already been generated."
        });
      }

      // Update order_status to 'Cancelled'
      db.query(
        "UPDATE orders SET order_status = 'Cancelled', updated_at = NOW() WHERE order_number = ?",
        [order_number],
        (err, result) => {
          if (err) return res.status(500).json({ error: err });

          if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Order not found" });
          }

          res.json({
            success: true,
            message: "Order cancelled successfully",
            order_number: order_number,
            order_status: "Cancelled"
          });
        }
      );
    }
  );
});


// Update approval_status for an order
router.put('/update-approval-status/:order_number', async (req, res) => {
  const { order_number } = req.params;
  const { approval_status } = req.body;

  console.log("📝 Updating approval_status:", order_number, approval_status);

  if (!approval_status) {
    return res.status(400).json({
      error: "approval_status is required",
    });
  }

  try {
    const query = `
      UPDATE orders 
      SET approval_status = ?
      WHERE order_number = ?
    `;

    const [result] = await db.promise().query(query, [
      approval_status,
      order_number,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    console.log("✅ approval_status updated for:", order_number);

    res.json({
      success: true,
      message: "Approval status updated successfully",
      order_number,
      approval_status,
    });

  } catch (err) {
    console.error("❌ Error updating approval_status:", err);

    res.status(500).json({
      error: "Failed to update approval_status",
      details: err.message,
    });
  }
});


// ===================================================
// 📌 UPDATE ITEM APPROVAL STATUS
// ===================================================
router.put("/items/:itemId/approve", (req, res) => {
  const { itemId } = req.params;
  const { approval_status } = req.body;

  console.log(`📝 Updating approval status for item ${itemId} to: ${approval_status}`);

  // Validate input
  if (!approval_status) {
    return res.status(400).json({
      error: "approval_status is required",
    });
  }

  // Optional: Validate that approval_status is one of allowed values
  const allowedStatuses = ["pending", "approved", "rejected"];
  if (!allowedStatuses.includes(approval_status)) {
    return res.status(400).json({
      error: "Invalid approval_status. Allowed values: pending, approved, rejected",
    });
  }

  // First, check if the item exists
  db.query(
    "SELECT id, order_number FROM order_items WHERE id = ?",
    [itemId],
    (err, rows) => {
      if (err) {
        console.error("❌ Database error:", err);
        return res.status(500).json({ error: "Database error", details: err.message });
      }

      if (rows.length === 0) {
        return res.status(404).json({ error: "Item not found" });
      }

      const item = rows[0];
      
      // Update the approval_status
      db.query(
        "UPDATE order_items SET approval_status = ?, updated_at = NOW() WHERE id = ?",
        [approval_status, itemId],
        (err, result) => {
          if (err) {
            console.error("❌ Error updating approval status:", err);
            return res.status(500).json({ 
              error: "Failed to update approval status", 
              details: err.message 
            });
          }

          if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Item not found" });
          }

          console.log(`✅ Item ${itemId} approval status updated to: ${approval_status}`);

          // Optional: Update order status based on all items' approval status
          // You can add this logic if needed
          updateOrderApprovalStatus(item.order_number);

          res.json({
            success: true,
            message: "Item approval status updated successfully",
            item_id: itemId,
            approval_status: approval_status,
            order_number: item.order_number
          });
        }
      );
    }
  );
});

// Helper function to update order's overall approval status (optional)
function updateOrderApprovalStatus(orderNumber) {
  // Check if all items in the order are approved
  db.query(
    `SELECT 
      COUNT(*) as total_items,
      SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) as approved_items,
      SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END) as rejected_items,
      SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) as pending_items
    FROM order_items 
    WHERE order_number = ?`,
    [orderNumber],
    (err, rows) => {
      if (err) {
        console.error("❌ Error checking order approval status:", err);
        return;
      }

      if (rows.length > 0) {
        const stats = rows[0];
        let overallStatus = 'pending';

        if (stats.pending_items === 0) {
          if (stats.rejected_items > 0) {
            overallStatus = 'partially_rejected';
          } else if (stats.approved_items === stats.total_items) {
            overallStatus = 'fully_approved';
          } else if (stats.approved_items > 0) {
            overallStatus = 'partially_approved';
          }
        }

        // Update order's overall approval status
        db.query(
          "UPDATE orders SET overall_approval_status = ?, updated_at = NOW() WHERE order_number = ?",
          [overallStatus, orderNumber],
          (err, result) => {
            if (err) {
              console.error("❌ Error updating order approval status:", err);
            } else {
              console.log(`✅ Order ${orderNumber} overall approval status updated to: ${overallStatus}`);
            }
          }
        );
      }
    }
  );
}



module.exports = router;
