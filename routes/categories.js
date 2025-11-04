// // routes/categories.js
// const express = require('express');
// const router = express.Router();
// const db = require('../db'); // ✅ Changed from './db' to '../db'

// // Get all categories
// router.get('/categories', async (req, res) => {
//   try {
//     const [categories] = await db.execute('SELECT * FROM categories ORDER BY category_name');
//     res.json(categories);
//   } catch (error) {
//     console.error('Error fetching categories:', error);
//     res.status(500).json({ error: 'Failed to fetch categories' });
//   }
// });

// module.exports = router;






// routes/categories.js
// routes/categories.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all categories
router.get('/categories', (req, res) => {
  db.query('SELECT * FROM categories ORDER BY category_name', (err, results) => {
    if (err) {
      console.error('Error fetching categories:', err);
      return res.status(500).json({ error: 'Failed to fetch categories' });
    }
    res.json(results);
  });
});


// Get products by category ID with group_by = 'salescatalog'
// router.get('/categories/:categoryId/products', async (req, res) => {
//   try {
//     const { categoryId } = req.params;
    
//     const [products] = await db.execute(
//       `SELECT 
//          id, 
//          goods_name, 
//          price, 
//          unit, 
//          sku, 
//          balance_stock,
//          group_by,
//          category_id
//        FROM products 
//        WHERE category_id = ? 
//          AND group_by = 'Salescatalog'
        
//        ORDER BY goods_name`,
//       [categoryId]
//     );
    
//     res.json(products);
//   } catch (error) {
//     console.error('Error fetching products:', error);
//     res.status(500).json({ error: 'Failed to fetch products' });
//   }
// });



// Get products by category ID with group_by = 'salescatalog'
// Get products by category ID with group_by = 'salescatalog'
router.get('/categories/:categoryId/products', (req, res) => {
  const { categoryId } = req.params;

  db.query(
    `SELECT 
       id, 
       goods_name, 
       price, 
       unit, 
       sku, 
       balance_stock,
       group_by,
       category_id,
       inclusive_gst,
       gst_rate,
       non_taxable,
       net_price
     FROM products 
     WHERE category_id = ? 
       AND group_by = 'Salescatalog'
     ORDER BY goods_name`,
    [categoryId],
    (err, products) => {
      if (err) {
        console.error('Error fetching products:', err);
        return res.status(500).json({ error: 'Failed to fetch products' });
      }

      const productsWithGST = products.map((product) => {
        const price = parseFloat(product.price) || 0;
        const gstRate = parseFloat(product.gst_rate) || 0;
        const inclusive = Number(product.inclusive_gst) === 1;
        const nonTaxable = Number(product.non_taxable) === 1;

        let basePrice = price;
        let gstAmount = 0;
        let totalPrice = price;

        if (nonTaxable) {
          gstAmount = 0;
          basePrice = price;
          totalPrice = price;
        } else if (inclusive) {
          basePrice = price / (1 + gstRate / 100);
          gstAmount = price - basePrice;
          totalPrice = price;
        } else {
          gstAmount = price * (gstRate / 100);
          totalPrice = price + gstAmount;
        }

        return {
          ...product,
          base_price: parseFloat(basePrice.toFixed(2)),
          gst_amount: parseFloat(gstAmount.toFixed(2)),
          total_price: parseFloat(totalPrice.toFixed(2)),
          price_display: inclusive ? totalPrice : basePrice,
        };
      });

      res.json(productsWithGST);
    }
  );
});


module.exports = router;