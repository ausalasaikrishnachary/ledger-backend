const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET all credit periods
router.get('/credit', (req, res) => {
  
  
  db.query(
    'SELECT * FROM credit_periods ORDER BY created_at DESC',
    (error, results) => {
      if (error) {
        console.error('Error fetching credit periods:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      }
      

      res.json({
        success: true,
        data: results,
        message: 'Credit periods fetched successfully'
      });
    }
  );
});

// GET single credit period by ID
router.get('/credit/:id', (req, res) => {
  const { id } = req.params;
  
  db.query(
    'SELECT * FROM credit_periods WHERE id = ?',
    [id],
    (error, results) => {
      if (error) {
        console.error('Error fetching credit period:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      }
      
      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Credit period not found'
        });
      }
      
      res.json({
        success: true,
        data: results[0],
        message: 'Credit period fetched successfully'
      });
    }
  );
});

// POST create new credit period
router.post('/add', (req, res) => {
  const { creditPeriod, creditPercentage } = req.body;
  
  // Simple validation
  if (!creditPeriod || creditPeriod.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Credit period is required'
    });
  }
  
  if (!creditPercentage || creditPercentage.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Credit percentage is required'
    });
  }
  
  // First check if credit period already exists
  db.query(
    'SELECT id FROM credit_periods WHERE credit_period = ?',
    [creditPeriod],
    (error, existingResults) => {
      if (error) {
        console.error('Error checking existing credit period:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      }
      
      if (existingResults.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Credit period already exists'
        });
      }
      
      // Create new credit period
      db.query(
        'INSERT INTO credit_periods (credit_period, credit_percentage) VALUES (?, ?)',
        [creditPeriod, creditPercentage],
        (error, insertResults) => {
          if (error) {
            console.error('Error creating credit period:', error);
            return res.status(500).json({
              success: false,
              message: 'Internal server error',
              error: error.message
            });
          }
          
          res.status(201).json({
            success: true,
            data: {
              id: insertResults.insertId,
              credit_period: creditPeriod,
              credit_percentage: creditPercentage
            },
            message: 'Credit period created successfully'
          });
        }
      );
    }
  );
});

// PUT update credit period
router.put('/edit/:id', (req, res) => {
  const { id } = req.params;
  const { creditPeriod, creditPercentage } = req.body;
  
  // Simple validation
  if (!creditPeriod || creditPeriod.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Credit period is required'
    });
  }
  
  if (!creditPercentage || creditPercentage.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Credit percentage is required'
    });
  }
  
  // First check if credit period exists
  db.query(
    'SELECT id FROM credit_periods WHERE id = ?',
    [id],
    (error, existingResults) => {
      if (error) {
        console.error('Error checking credit period:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      }
      
      if (existingResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Credit period not found'
        });
      }
      
      // Check if credit period name already exists (excluding current record)
      db.query(
        'SELECT id FROM credit_periods WHERE credit_period = ? AND id != ?',
        [creditPeriod, id],
        (error, duplicateResults) => {
          if (error) {
            console.error('Error checking duplicate credit period:', error);
            return res.status(500).json({
              success: false,
              message: 'Internal server error',
              error: error.message
            });
          }
          
          if (duplicateResults.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Credit period already exists'
            });
          }
          
          // Update credit period
          db.query(
            'UPDATE credit_periods SET credit_period = ?, credit_percentage = ? WHERE id = ?',
            [creditPeriod, creditPercentage, id],
            (error, updateResults) => {
              if (error) {
                console.error('Error updating credit period:', error);
                return res.status(500).json({
                  success: false,
                  message: 'Internal server error',
                  error: error.message
                });
              }
              
              res.json({
                success: true,
                data: {
                  id: parseInt(id),
                  credit_period: creditPeriod,
                  credit_percentage: creditPercentage
                },
                message: 'Credit period updated successfully'
              });
            }
          );
        }
      );
    }
  );
});

// DELETE credit period
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  // First check if credit period exists
  db.query(
    'SELECT id FROM credit_periods WHERE id = ?',
    [id],
    (error, existingResults) => {
      if (error) {
        console.error('Error checking credit period:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      }
      
      if (existingResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Credit period not found'
        });
      }
      
      // Delete credit period
      db.query(
        'DELETE FROM credit_periods WHERE id = ?',
        [id],
        (error, deleteResults) => {
          if (error) {
            console.error('Error deleting credit period:', error);
            return res.status(500).json({
              success: false,
              message: 'Internal server error',
              error: error.message
            });
          }
          
          res.json({
            success: true,
            message: 'Credit period deleted successfully'
          });
        }
      );
    }
  );
});

module.exports = router;