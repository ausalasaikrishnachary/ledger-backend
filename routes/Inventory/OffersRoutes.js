const express = require('express');
const router = express.Router();
const db = require('../../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = './uploads/offers';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'offer-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
  } else if (error) {
    return res.status(400).json({ error: error.message });
  }
  next();
};

// GET all offers with filtering and pagination
router.get('/offers', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      offer_type = '',
      status = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = `
      SELECT * FROM offers 
      WHERE 1=1
    `;
    let countQuery = `SELECT COUNT(*) as total FROM offers WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (search) {
      query += ` AND (title LIKE ? OR description LIKE ?)`;
      countQuery += ` AND (title LIKE ? OR description LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm);
    }

    if (offer_type && offer_type !== 'All') {
      query += ` AND offer_type = ?`;
      countQuery += ` AND offer_type = ?`;
      params.push(offer_type);
      countParams.push(offer_type);
    }

    if (status) {
      query += ` AND status = ?`;
      countQuery += ` AND status = ?`;
      params.push(status);
      countParams.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    // Use promise-based query execution
    const offers = await new Promise((resolve, reject) => {
      db.query(query, params, (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    const countResult = await new Promise((resolve, reject) => {
      db.query(countQuery, countParams, (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      offers,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single offer by ID
router.get('/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const offers = await new Promise((resolve, reject) => {
      db.query('SELECT * FROM offers WHERE id = ?', [id], (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    if (offers.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json(offers[0]);
  } catch (error) {
    console.error('Error fetching offer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CREATE new offer
router.post('/offers', upload.single('image'), handleMulterError, async (req, res) => {
  try {
    const {
      title,
      description,
      discountPercentage,
      minimumAmount,
      validFrom,
      validUntil,
      offerType,
      category,
      productName,
      status = 'active'
    } = req.body;

    // Validate required fields
    if (!title || !description || !discountPercentage || !validFrom || !validUntil || !offerType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate category for category-specific offers
    if (offerType === 'category' && !category) {
      return res.status(400).json({ error: 'Category is required for category-specific offers' });
    }

    const image_url = req.file ? `/uploads/offers/${req.file.filename}` : null;

    const query = `
      INSERT INTO offers (
        title, description, discount_percentage, minimum_amount,
        valid_from, valid_until, image_url, offer_type, category_name,
        product_name, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await new Promise((resolve, reject) => {
      db.query(query, [
        title,
        description,
        parseFloat(discountPercentage),
        minimumAmount ? parseFloat(minimumAmount) : 0,
        validFrom,
        validUntil,
        image_url,
        offerType,
        offerType === 'category' ? category : null,
        productName || null,
        status
      ], (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    res.status(201).json({
      message: 'Offer created successfully',
      offerId: result.insertId
    });
  } catch (error) {
    console.error('Error creating offer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// UPDATE offer
router.put('/offers/:id', upload.single('image'), handleMulterError, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      discountPercentage,
      minimumAmount,
      validFrom,
      validUntil,
      offerType,
      category,
      productName,
      status
    } = req.body;

    // Check if offer exists
    const existingOffers = await new Promise((resolve, reject) => {
      db.query('SELECT * FROM offers WHERE id = ?', [id], (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    if (existingOffers.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Validate category for category-specific offers
    if (offerType === 'category' && !category) {
      return res.status(400).json({ error: 'Category is required for category-specific offers' });
    }

    let image_url = existingOffers[0].image_url;
    if (req.file) {
      // Delete old image if exists
      if (image_url) {
        const oldImagePath = path.join(__dirname, '../..', image_url);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      image_url = `/uploads/offers/${req.file.filename}`;
    }

    const query = `
      UPDATE offers SET
        title = ?, description = ?, discount_percentage = ?, minimum_amount = ?,
        valid_from = ?, valid_until = ?, image_url = ?, offer_type = ?, category_name = ?,
        product_name = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await new Promise((resolve, reject) => {
      db.query(query, [
        title,
        description,
        parseFloat(discountPercentage),
        minimumAmount ? parseFloat(minimumAmount) : 0,
        validFrom,
        validUntil,
        image_url,
        offerType,
        offerType === 'category' ? category : null,
        productName || null,
        status,
        id
      ], (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    res.json({ message: 'Offer updated successfully' });
  } catch (error) {
    console.error('Error updating offer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE offer
router.delete('/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if offer exists and get image path
    const offers = await new Promise((resolve, reject) => {
      db.query('SELECT image_url FROM offers WHERE id = ?', [id], (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    if (offers.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Delete associated image
    if (offers[0].image_url) {
      const imagePath = path.join(__dirname, '../..', offers[0].image_url);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    await new Promise((resolve, reject) => {
      db.query('DELETE FROM offers WHERE id = ?', [id], (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    res.json({ message: 'Offer deleted successfully' });
  } catch (error) {
    console.error('Error deleting offer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// TOGGLE offer status
router.patch('/offers/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await new Promise((resolve, reject) => {
      db.query('UPDATE offers SET status = ? WHERE id = ?', [status, id], (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json({ message: `Offer ${status === 'active' ? 'activated' : 'deactivated'} successfully` });
  } catch (error) {
    console.error('Error updating offer status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;