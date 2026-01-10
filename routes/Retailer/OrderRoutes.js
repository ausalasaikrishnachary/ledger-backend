const express = require("express");
const router = express.Router();
const db = require('./../../db');
const { sendMail } = require("../../utils/mailer");
require("dotenv").config();
const axios = require("axios");



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



router.post("/create-complete-order", async (req, res) => {
  console.log("📦 Creating complete order:", req.body);

  const { order, orderItems } = req.body;

  if (!order || !orderItems || !Array.isArray(orderItems)) {
    return res.status(400).json({
      error: "Missing order or orderItems data",
    });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error("❌ DB Connection Error:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error("❌ Transaction Error:", err);
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
            order_mode, approval_status, retailer_mobile, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
          order.retailer_mobile,
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
            order_number, item_name, product_id, mrp, sale_price,
            edited_sale_price, credit_charge, customer_sale_price,
            final_amount, quantity, total_amount,
            discount_percentage, discount_amount, taxable_amount,
            tax_percentage, tax_amount, item_total,
            credit_period, credit_percentage,
            sgst_percentage, sgst_amount,
            cgst_percentage, cgst_amount,
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
          connection.query(orderItemQuery, [orderItemValues], (err) => {
            if (err) reject(err);
            else resolve();
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
        try {
          const emailHTML = `
            <h2>Order Placed Successfully</h2>
            <p><strong>Order Number:</strong> ${order.order_number}</p>
            <p><strong>Customer:</strong> ${order.customer_name}</p>
            <p><strong>Net Amount:</strong> ₹${order.net_payable}</p>
            <p><strong>Placed By:</strong> ${order.ordered_by}</p>
          `;

          await Promise.all([
            sendMail({
              to: process.env.ADMIN_EMAIL,
              subject: `New Order - ${order.order_number}`,
              html: emailHTML,
            }),
            sendMail({
              to: order.staff_email,
              subject: `Order Placed - ${order.order_number}`,
              html: emailHTML,
            }),
            sendMail({
              to: order.retailer_email,
              subject: `Your Order ${order.order_number}`,
              html: emailHTML,
            }),
          ]);

          console.log("📧 Emails sent");
        } catch (mailErr) {
          console.error("❌ Email failed:", mailErr.message);
        }

        // ---------------------------------------------------
        // 6. SEND SMS TO RETAILER (SMSJUST)
        // ---------------------------------------------------
        try {
          if (order.retailer_mobile) {
            const productSummary = orderItems
              .map((item) => item.item_name)
              .join(", ");

            const smsText = `Dear Customer, Your Order No. ${order.order_number} for ${productSummary} has been successfully placed. Thank you for choosing - SHREE SHASHWATRAJ AGRO PRIVATE LIMITED`;

            const smsUrl =
              "https://www.smsjust.com/blank/sms/user/urlsms.php";

            const smsParams = {
              username: process.env.SMS_USERNAME,
              pass: process.env.SMS_PASSWORD,
              senderid: process.env.SMS_SENDERID,
              dest_mobileno: order.retailer_mobile,
              message: smsText,
              dltentityid: process.env.SMS_ENTITYID,
              dlttempid: process.env.SMS_ORDERTEMPLATEID,
              response: "y",
            };

            const smsResponse = await axios.get(smsUrl, {
              params: smsParams,
            });

            console.log("📩 SMS sent:", smsResponse.data);
          }
        } catch (smsErr) {
          console.error("❌ SMS failed:", smsErr.message);
        }

        // ---------------------------------------------------
        // 7. RESPONSE
        // ---------------------------------------------------
        res.status(201).json({
          success: true,
          order_id: orderResult.insertId,
          order_number: order.order_number,
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


router.put("/items/:item_id/update-price", async (req, res) => {
  const { item_id } = req.params;
  const {
    order_number,
    edited_sale_price,
    customer_sale_price,
    discount_amount,
    taxable_amount,
    tax_amount,
    final_amount,
    item_total,
    credit_charge,
    total_amount
  } = req.body;

  console.log(`📝 Updating item price: ${item_id}`, req.body);

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

    const currentItem = itemRows[0];
    
    // Start building update query
    let updateFields = [];
    let updateValues = [];
    
    // Add fields to update
    if (edited_sale_price !== undefined) {
      updateFields.push("edited_sale_price = ?");
      updateValues.push(edited_sale_price);
    }
    
    if (customer_sale_price !== undefined) {
      updateFields.push("customer_sale_price = ?");
      updateValues.push(customer_sale_price);
    }
    
    if (discount_amount !== undefined) {
      updateFields.push("discount_amount = ?");
      updateValues.push(discount_amount);
    }
    
    if (taxable_amount !== undefined) {
      updateFields.push("taxable_amount = ?");
      updateValues.push(taxable_amount);
    }
    
    if (tax_amount !== undefined) {
      updateFields.push("tax_amount = ?");
      updateValues.push(tax_amount);
    }
    
    if (final_amount !== undefined) {
      updateFields.push("final_amount = ?");
      updateValues.push(final_amount);
    }
    
    if (item_total !== undefined) {
      updateFields.push("item_total = ?");
      updateValues.push(item_total);
    }
    
    if (credit_charge !== undefined) {
      updateFields.push("credit_charge = ?");
      updateValues.push(credit_charge);
    }
    
    if (total_amount !== undefined) {
      updateFields.push("total_amount = ?");
      updateValues.push(total_amount);
    }
    
    // Always update the updated_at timestamp
    updateFields.push("updated_at = NOW()");
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        error: "No fields to update",
      });
    }
    
    // Add item_id to update values
    updateValues.push(item_id);
    
    // Build and execute update query
    const updateQuery = `
      UPDATE order_items 
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `;
    
    const [result] = await db.promise().query(updateQuery, updateValues);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Item not found or no changes made",
      });
    }
    
    console.log(`✅ Item price updated for item ID: ${item_id}`);
    
    // Recalculate order totals if order_number is provided
    if (order_number) {
      await recalculateOrderTotals(order_number);
    }
    
    // Get updated item
    const [updatedItemRows] = await db.promise().query(
      "SELECT * FROM order_items WHERE id = ?",
      [item_id]
    );
    
    res.json({
      success: true,
      message: "Item price updated successfully",
      data: {
        item_id,
        updated_item: updatedItemRows[0]
      }
    });
    
  } catch (err) {
    console.error("❌ Error updating item price:", err);
    
    res.status(500).json({
      error: "Failed to update item price",
      details: err.message,
    });
  }
});

// Helper function to recalculate order totals
async function recalculateOrderTotals(order_number) {
  try {
    // Get all items for the order
    const [items] = await db.promise().query(
      "SELECT * FROM order_items WHERE order_number = ?",
      [order_number]
    );
    
    if (items.length === 0) return;
    
    // Calculate totals
    let order_total = 0;
    let discount_amount = 0;
    let taxable_amount = 0;
    let tax_amount = 0;
    let net_payable = 0;
    
    items.forEach(item => {
      order_total += parseFloat(item.total_amount) || 0;
      discount_amount += parseFloat(item.discount_amount) || 0;
      taxable_amount += parseFloat(item.taxable_amount) || 0;
      tax_amount += parseFloat(item.tax_amount) || 0;
      net_payable += parseFloat(item.item_total) || 0;
    });
    
    // Update order totals
    const updateOrderQuery = `
      UPDATE orders 
      SET 
        order_total = ?,
        discount_amount = ?,
        taxable_amount = ?,
        tax_amount = ?,
        net_payable = ?,
        updated_at = NOW()
      WHERE order_number = ?
    `;
    
    await db.promise().query(updateOrderQuery, [
      order_total,
      discount_amount,
      taxable_amount,
      tax_amount,
      net_payable,
      order_number
    ]);
    
    console.log(`📊 Order totals recalculated for: ${order_number}`);
    
  } catch (error) {
    console.error("❌ Error recalculating order totals:", error);
  }
}



module.exports = router;
