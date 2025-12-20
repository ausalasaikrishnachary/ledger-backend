const express = require("express");
const router = express.Router();
const db = require('./../../db');
const { sendMail } = require("../../utils/mailer");
require("dotenv").config();


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


router.post("/create-complete-order", (req, res) => {
  console.log("📦 Creating complete order:", req.body);

  const { order, orderItems } = req.body;

  if (!order || !orderItems) {
    return res.status(400).json({
      error: "Missing order or orderItems data",
    });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error("❌ Database connection error:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error("❌ Transaction start error:", err);
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        // ---------------------------------------------------
        // 1. INSERT ORDER
        // ---------------------------------------------------
        const orderQuery = `
          INSERT INTO orders (
            order_number, customer_id, customer_name, order_total, discount_amount,
            taxable_amount, tax_amount, net_payable, credit_period,
            estimated_delivery_date, order_placed_by, ordered_by,
            staff_id, assigned_staff, staff_incentive,
            order_mode, approval_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
          order.order_placed_by,
          order.ordered_by,
          order.staffid,
          order.assigned_staff,
          order.staff_incentive,
          order.order_mode,
          order.approval_status,
        ];

        const orderResult = await new Promise((resolve, reject) => {
          connection.query(orderQuery, orderValues, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log("✅ Order inserted:", orderResult.insertId);

        // ---------------------------------------------------
        // 2. INSERT ORDER ITEMS
        // ---------------------------------------------------
        const orderItemQuery = `
          INSERT INTO order_items (
            order_number, item_name, product_id, mrp, sale_price, edited_sale_price,credit_charge,customer_sale_price,final_amount,quantity,
            total_amount, discount_percentage, discount_amount, taxable_amount,
            tax_percentage, tax_amount, item_total, credit_period, credit_percentage,
            sgst_percentage, sgst_amount, cgst_percentage, cgst_amount,
            discount_applied_scheme
          ) VALUES ?
        `;

        const orderItemValues = orderItems.map((item) => [
          order.order_number,
          item.item_name,
          item.product_id,
          item.mrp,
          item.sale_price,
          item.edited_sale_price,
          item.credit_charge,
          item.customer_sale_price,
          item.final_amount,
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
          item.discount_applied_scheme,
        ]);

        await new Promise((resolve, reject) => {
          connection.query(orderItemQuery, [orderItemValues], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        console.log("✅ Order items inserted");

        // ---------------------------------------------------
        // 3. CLEAR CART
        // ---------------------------------------------------
        const clearCartQuery = `
          DELETE FROM cart_items
          WHERE customer_id = ? AND staff_id = ?
        `;

        const clearCartResult = await new Promise((resolve, reject) => {
          connection.query(
            clearCartQuery,
            [order.customer_id, order.order_placed_by],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });

        console.log("🛒 Cart cleared:", clearCartResult.affectedRows);

        // ---------------------------------------------------
        // 4. COMMIT TRANSACTION
        // ---------------------------------------------------
        await new Promise((resolve, reject) => {
          connection.commit((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        connection.release();
        console.log("✅ Transaction committed");

        // ---------------------------------------------------
        // 5. SEND EMAILS
        // ---------------------------------------------------
        const staffEmail = order.staff_email;
        const retailerEmail = order.retailer_email;
        const adminEmail = process.env.ADMIN_EMAIL;

        try {
          const emailHTML = `
            <h2>Order Placed Successfully</h2>
            <p><strong>Order Number:</strong> ${order.order_number}</p>
            <p><strong>Customer:</strong> ${order.customer_name}</p>
            <p><strong>Net Amount:</strong> ₹${order.net_payable}</p>
            <p><strong>Placed By:</strong> ${order.ordered_by}</p>
            <br/>
            <p>Thank you.</p>
          `;

          await Promise.all([
            sendMail({
              to: adminEmail,
              subject: `New Order Placed - ${order.order_number}`,
              html: emailHTML,
            }),
            sendMail({
              to: staffEmail,
              subject: `Order Placed Successfully - ${order.order_number}`,
              html: emailHTML,
            }),
            sendMail({
              to: retailerEmail,
              subject: `Your Order Has Been Placed - ${order.order_number}`,
              html: emailHTML,
            }),
          ]);

          console.log("📧 Emails sent successfully");
        } catch (mailErr) {
          console.error("❌ Email error:", mailErr);
        }

        // ---------------------------------------------------
        // 6. RESPONSE
        // ---------------------------------------------------
        res.status(201).json({
          success: true,
          order_number: order.order_number,
          order_id: orderResult.insertId,
          cart_cleared: clearCartResult.affectedRows,
          message: "Order created successfully",
        });
      } catch (error) {
        connection.rollback(() => {
          connection.release();
          console.error("❌ Transaction failed:", error);
          res.status(500).json({
            error: "Failed to create order",
            details: error.message,
          });
        });
      }
    });
  });
});

module.exports = router;



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



router.put("/items/:item_id/approve", async (req, res) => {
  const { item_id } = req.params;
  const { approval_status } = req.body;

  console.log(`📝 Updating item approval status: ${item_id} -> ${approval_status}`);

  // Validate approval_status
  if (!approval_status || !["approved", "rejected", "pending"].includes(approval_status)) {
    return res.status(400).json({
      error: "Invalid approval_status. Must be 'approved', 'rejected', or 'pending'",
    });
  }

  try {
    // First, check if item exists
    const [itemRows] = await db.promise().query(
      "SELECT * FROM order_items WHERE id = ?",
      [item_id]
    );

    if (itemRows.length === 0) {
      return res.status(404).json({
        error: "Order item not found",
      });
    }

    const item = itemRows[0];
    const order_number = item.order_number;

    // Update the item's approval status
    const updateQuery = `
      UPDATE order_items 
      SET approval_status = ?, updated_at = NOW()
      WHERE id = ?
    `;

    const [result] = await db.promise().query(updateQuery, [
      approval_status,
      item_id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Item not found or no changes made",
      });
    }

    console.log(`✅ Item approval status updated for item ID: ${item_id}`);

    // Get updated item details
    const [updatedItemRows] = await db.promise().query(
      "SELECT * FROM order_items WHERE id = ?",
      [item_id]
    );

    // Check if all items in the order have the same approval status
    const [allItems] = await db.promise().query(
      "SELECT approval_status FROM order_items WHERE order_number = ?",
      [order_number]
    );

    // Determine if we should update the parent order's approval status
    let orderApprovalStatus = null;
    
    if (allItems.length > 0) {
      const allApproved = allItems.every(item => item.approval_status === "approved");
      const allRejected = allItems.every(item => item.approval_status === "rejected");
      const anyPending = allItems.some(item => item.approval_status === "pending" || !item.approval_status);
      const mixedStatus = allItems.some(item => item.approval_status === "approved") && 
                         allItems.some(item => item.approval_status === "rejected");

      if (allApproved) {
        orderApprovalStatus = "approved";
      } else if (allRejected) {
        orderApprovalStatus = "rejected";
      } else if (mixedStatus) {
        orderApprovalStatus = "partially_approved";
      } else if (anyPending) {
        orderApprovalStatus = "pending";
      }
    }

    // Update parent order's approval status if needed
    if (orderApprovalStatus) {
      await db.promise().query(
        "UPDATE orders SET approval_status = ?, updated_at = NOW() WHERE order_number = ?",
        [orderApprovalStatus, order_number]
      );
      
      console.log(`📦 Parent order ${order_number} approval status updated to: ${orderApprovalStatus}`);
    }

    res.json({
      success: true,
      message: `Item ${approval_status} successfully`,
      data: {
        item_id,
        approval_status,
        order_number,
        updated_item: updatedItemRows[0],
        order_approval_status: orderApprovalStatus
      }
    });

  } catch (err) {
    console.error("❌ Error updating item approval status:", err);
    
    res.status(500).json({
      error: "Failed to update item approval status",
      details: err.message,
    });
  }
});



module.exports = router;
