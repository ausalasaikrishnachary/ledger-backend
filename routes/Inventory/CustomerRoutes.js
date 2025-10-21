// routes/customer.js
const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET all customers
router.get('/customer', async (req, res) => {
  try {
    const [customers] = await db.execute('SELECT * FROM customers WHERE deleted_at IS NULL');
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET customer by ID
router.get('/customer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [customers] = await db.execute('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL', [id]);
    
    if (customers.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json(customers[0]);
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create new customer
router.post('/customer', async (req, res) => {
  try {
    const {
      customer_group, title, entity_type, name, mobile_number, email, gstin,
      gst_registered_name, business_name, additional_business_name,
      display_name, phone_number, fax, account_number, account_name,
      bank_name, account_type, branch_name, ifsc_code, pan, tan,
      tds_slab_rate, currency, terms_of_payment, reverse_charge,
      export_sez, shipping_address_line1, shipping_address_line2,
      shipping_city, shipping_pin_code, shipping_state, shipping_country,
      shipping_branch_name, shipping_gstin, billing_address_line1,
      billing_address_line2, billing_city, billing_pin_code,
      billing_state, billing_country, billing_branch_name, billing_gstin
    } = req.body;

    const query = `
      INSERT INTO customers (
        customer_group, title, entity_type, name, mobile_number, email, gstin,
        gst_registered_name, business_name, additional_business_name,
        display_name, phone_number, fax, account_number, account_name,
        bank_name, account_type, branch_name, ifsc_code, pan, tan,
        tds_slab_rate, currency, terms_of_payment, reverse_charge,
        export_sez, shipping_address_line1, shipping_address_line2,
        shipping_city, shipping_pin_code, shipping_state, shipping_country,
        shipping_branch_name, shipping_gstin, billing_address_line1,
        billing_address_line2, billing_city, billing_pin_code,
        billing_state, billing_country, billing_branch_name, billing_gstin,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    const values = [
      customer_group, title, entity_type, name, mobile_number, email, gstin,
      gst_registered_name, business_name, additional_business_name,
      display_name, phone_number, fax, account_number, account_name,
      bank_name, account_type, branch_name, ifsc_code, pan, tan,
      tds_slab_rate, currency, terms_of_payment, reverse_charge,
      export_sez, shipping_address_line1, shipping_address_line2,
      shipping_city, shipping_pin_code, shipping_state, shipping_country,
      shipping_branch_name, shipping_gstin, billing_address_line1,
      billing_address_line2, billing_city, billing_pin_code,
      billing_state, billing_country, billing_branch_name, billing_gstin
    ];

    const [result] = await db.execute(query, values);
    res.status(201).json({ 
      id: result.insertId, 
      message: 'Customer created successfully' 
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update customer
router.put('/customer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_group, title, entity_type, name, mobile_number, email, gstin,
      gst_registered_name, business_name, additional_business_name,
      display_name, phone_number, fax, account_number, account_name,
      bank_name, account_type, branch_name, ifsc_code, pan, tan,
      tds_slab_rate, currency, terms_of_payment, reverse_charge,
      export_sez, shipping_address_line1, shipping_address_line2,
      shipping_city, shipping_pin_code, shipping_state, shipping_country,
      shipping_branch_name, shipping_gstin, billing_address_line1,
      billing_address_line2, billing_city, billing_pin_code,
      billing_state, billing_country, billing_branch_name, billing_gstin
    } = req.body;

    const query = `
      UPDATE customers SET 
        customer_group = ?, title = ?, entity_type = ?, name = ?, mobile_number = ?, 
        email = ?, gstin = ?, gst_registered_name = ?, business_name = ?,
        additional_business_name = ?, display_name = ?, phone_number = ?,
        fax = ?, account_number = ?, account_name = ?, bank_name = ?,
        account_type = ?, branch_name = ?, ifsc_code = ?, pan = ?, tan = ?,
        tds_slab_rate = ?, currency = ?, terms_of_payment = ?, reverse_charge = ?,
        export_sez = ?, shipping_address_line1 = ?, shipping_address_line2 = ?,
        shipping_city = ?, shipping_pin_code = ?, shipping_state = ?,
        shipping_country = ?, shipping_branch_name = ?, shipping_gstin = ?,
        billing_address_line1 = ?, billing_address_line2 = ?, billing_city = ?,
        billing_pin_code = ?, billing_state = ?, billing_country = ?,
        billing_branch_name = ?, billing_gstin = ?, updated_at = NOW()
      WHERE id = ? AND deleted_at IS NULL
    `;

    const values = [
      customer_group, title, entity_type, name, mobile_number, email, gstin,
      gst_registered_name, business_name, additional_business_name,
      display_name, phone_number, fax, account_number, account_name,
      bank_name, account_type, branch_name, ifsc_code, pan, tan,
      tds_slab_rate, currency, terms_of_payment, reverse_charge,
      export_sez, shipping_address_line1, shipping_address_line2,
      shipping_city, shipping_pin_code, shipping_state, shipping_country,
      shipping_branch_name, shipping_gstin, billing_address_line1,
      billing_address_line2, billing_city, billing_pin_code,
      billing_state, billing_country, billing_branch_name, billing_gstin, id
    ];

    const [result] = await db.execute(query, values);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json({ message: 'Customer updated successfully' });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE customer (soft delete)
router.delete('/customer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [result] = await db.execute(
      'UPDATE customers SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;