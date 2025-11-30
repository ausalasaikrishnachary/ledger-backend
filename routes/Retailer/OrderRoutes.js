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
router.post("/place-order", (req, res) => {
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
      customer_id, customer_name,
      order_total, discount_amount, taxable_amount, tax_amount, net_payable,
      credit_period,
      estimated_delivery_date,
      order_placed_by,
      order_mode,
      invoice_number, invoice_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    insertOrderQuery,
    [
      "TEMP", // placeholder
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
    ],
    (err, orderResult) => {
      if (err) return res.status(500).json({ error: "Order insert failed", details: err });

      const orderId = orderResult.insertId;
      const generatedOrderNumber = generateOrderNumber(orderId);

      // 2️⃣ Update the correct order_number now
      db.query(
        "UPDATE orders SET order_number = ? WHERE id = ?",
        [generatedOrderNumber, orderId]
      );

      // 3️⃣ Insert Items
      const insertItemQuery = `
        INSERT INTO order_items (
          order_number, item_name, product_id,
          mrp, sale_price, price, quantity, total_amount,
          discount_percentage, discount_amount,
          taxable_amount,
          tax_percentage, tax_amount,
          item_total,
          credit_period, credit_percentage,
          sgst_percentage, sgst_amount,
          cgst_percentage, cgst_amount,
          discount_applied_scheme
        ) VALUES ?
      `;

      const values = items.map(item => [
        generatedOrderNumber,
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

      db.query(insertItemQuery, [values], (err) => {
        if (err) return res.status(500).json({ error: "Order items insert failed", details: err });

        // 4️⃣ Delete cart items of customer
        db.query(
          "DELETE FROM cart_items WHERE customer_id = ?",
          [customer_id],
          (err) => {
            if (err) return res.status(500).json({ error: "Cart cleanup failed", details: err });

            return res.json({
              message: "Order placed successfully",
              order_number: generatedOrderNumber,
              order_id: orderId
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

module.exports = router;
