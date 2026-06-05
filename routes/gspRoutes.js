// routes/gspRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateAndGetToken, getLatestToken, getValidToken } = require('../gspAuth');

// Generate new token
router.post('/gsp/generate-token', async (req, res) => {
  try {
    const result = await authenticateAndGetToken();
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Token generated successfully',
        data: {
          token_type: result.token_type,
          expires_at: result.expires_at
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to generate token',
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Get latest valid token
router.get('/gsp/get-token', async (req, res) => {
  try {
    const token = await getLatestToken();
    
    if (token) {
      res.json({
        success: true,
        data: {
          access_token: token.access_token,
          token_type: token.token_type,
          expires_at: token.expires_at
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No valid token found'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Get or refresh valid token
router.get('/gsp/valid-token', async (req, res) => {
  try {
    const token = await getValidToken();
    
    res.json({
      success: true,
      data: {
        access_token: token.access_token,
        token_type: token.token_type,
        expires_at: token.expires_at
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get valid token',
      error: error.message
    });
  }
});

// Manual token refresh (force new token)
router.post('/gsp/refresh-token', async (req, res) => {
  try {
    const result = await authenticateAndGetToken();
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          token_type: result.token_type,
          expires_at: result.expires_at
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to refresh token',
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;