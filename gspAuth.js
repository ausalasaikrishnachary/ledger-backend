// gspAuth.js
const axios = require('axios');
const db = require('./db');
const cron = require('node-cron');
const tokenManager = require('./tokenManager');
require('dotenv').config();


const gspappid = process.env.gspappid;
const gspappsecret = process.env.gspappsecret;


// Authentication endpoints
const AUTH_URLS = [
  'https://gsp.adaequare.com/gsp/authenticate?grant_type=token',
];


// Function to authenticate and get token
async function authenticateAndGetToken() {
  try {
    let response = null;

    for (const url of AUTH_URLS) {
      try {
        console.log(`Attempting authentication to: ${url}`);

        // Try form data
        response = await axios.post(
          "https://gsp.adaequare.com/gsp/authenticate?grant_type=token",
          null,
          {
            headers: {
              gspappid: gspappid,
              gspappsecret: gspappsecret
            }
          }
        );

        if (response.data && response.data.access_token) {
          console.log(`✓ Authentication successful at: ${url}`);
          break;
        }
      } catch (err) {
        // Try JSON format
        try {
          response = await axios.post(url, {
            'grant_type': 'token',
            'client_id': gspappid,
            'client_secret': gspappsecret
          }, {
            headers: {
              'Content-Type': 'application/json'
            }
          });

          if (response.data && response.data.access_token) {
            console.log(`✓ Authentication successful at: ${url} (JSON format)`);
            break;
          }
        } catch (err2) {
          console.error("Authentication failed");

          if (err2.response) {
            console.error("Status:", err2.response.status);
            console.error("Data:", err2.response.data);
          } else {
            console.error(err2.message);
          }
        }
      }
    }

    if (!response || !response.data) {
      throw new Error('All authentication attempts failed');
    }

    const data = response.data;

    if (data.access_token) {
      const expiresAt = data.expires_in
        ? new Date(Date.now() + (data.expires_in * 1000))
        : new Date(Date.now() + (6 * 60 * 60 * 1000)); // Default 6 hours

      const formattedExpiresAt = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

      const existingToken = await getLatestToken();

      if (existingToken) {
        const updateSql = `
    UPDATE gsp_api
    SET
      access_token = ?,
      token_type = ?,
      expires_at = ?,
      created_at = NOW(),
      gspappid = ?,
      gspappsecret = ?
    WHERE id = ?
  `;

        await new Promise((resolve, reject) => {
          db.query(
            updateSql,
            [
              data.access_token,
              data.token_type || "bearer",
              formattedExpiresAt,
              gspappid,
              gspappsecret,
              existingToken.id,
            ],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });
      } else {
        const insertSql = `
    INSERT INTO gsp_api
    (access_token, token_type, expires_at, created_at, gspappid, gspappsecret)
    VALUES (?, ?, ?, NOW(), ?, ?)
  `;

        await new Promise((resolve, reject) => {
          db.query(
            insertSql,
            [
              data.access_token,
              data.token_type || "bearer",
              formattedExpiresAt,
              gspappid,
              gspappsecret,
            ],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });
      }
      console.log('✓ GSP Token generated successfully');
      console.log('Token expires at:', formattedExpiresAt);
      console.log('✓ .env file updated with new token');

      return {
        success: true,
        access_token: data.access_token,
        token_type: data.token_type || 'bearer',
        expires_at: formattedExpiresAt
      };
    } else {
      console.log('✗ Invalid response structure from GSP:', data);
      return { success: false, error: 'Invalid response structure', details: data };
    }

  } catch (error) {
    console.error('✗ GSP Token generation error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
    return { success: false, error: error.message };
  }
}

// Function to get the latest valid token from database
async function getLatestToken() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT *
      FROM gsp_api
      ORDER BY created_at DESC
      LIMIT 1
    `;

    db.query(sql, (err, results) => {
      if (err) reject(err);
      else resolve(results[0] || null);
    });
  });
}

async function getValidToken() {
  const token = await getLatestToken();

  if (token) {
    const now = new Date();
    const expiry = new Date(token.expires_at);

    if (expiry > now) {
      console.log("Using existing valid token");
      return token;
    }

    console.log("Token expired. Generating new token...");
  } else {
    console.log("No token found. Generating new token...");
  }

  const result = await authenticateAndGetToken();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result;
}

// Function to check and refresh token if needed
async function checkAndRefreshToken() {
  const token = await getLatestToken();

  if (!token) {
    console.log("No token found. Generating...");
    await authenticateAndGetToken();
    return;
  }

  const now = new Date();
  const expiry = new Date(token.expires_at);

  if (expiry <= now) {
    console.log("Token expired. Generating new token...");
    await authenticateAndGetToken();
  } else {
    console.log("Token still valid.");
  }
}

// Setup CRON jobs
function setupCronJobs() {
  // Check token every 30 minutes
  const tokenCheckJob = cron.schedule('*/30 * * * *', async () => {
    console.log('🔄 Running scheduled token check...');
    try {
      await checkAndRefreshToken();
    } catch (error) {
      console.error('❌ Scheduled token check failed:', error.message);
    }
  });

  // Daily maintenance at 2:00 AM
  const dailyMaintenanceJob = cron.schedule('0 2 * * *', async () => {
    console.log('🔄 Running daily token maintenance...');
    try {
      // Clean up old tokens (keep last 30 days)
      const cleanupSql = `DELETE FROM gsp_api 
                         WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`;

      await new Promise((resolve, reject) => {
        db.query(cleanupSql, (err, result) => {
          if (err) reject(err);
          else {
            console.log(`🧹 Cleaned up ${result.affectedRows} old tokens`);
            resolve(result);
          }
        });
      });

      await checkAndRefreshToken();

    } catch (error) {
      console.error('❌ Daily maintenance failed:', error.message);
    }
  });

  // Initial token fetch on startup
  console.log('🚀 Fetching initial token on startup...');
  setTimeout(async () => {
    await getValidToken();
    console.log('✅ Token fetched and .env updated on startup');
  }, 3000);

  console.log('✅ Cron jobs scheduled successfully');
  console.log('📅 Token check: Every 30 minutes');
  console.log('📅 Daily maintenance: 2:00 AM');

  return { tokenCheckJob, dailyMaintenanceJob };
}

// Test function
async function testAuthentication() {
  console.log('Testing GSP Authentication...');
  const result = await authenticateAndGetToken();
  if (result.success) {
    console.log('✓ Authentication test passed!');
    console.log('Token preview:', result.access_token.substring(0, 10000) + '...');
  } else {
    console.log('✗ Authentication test failed!');
    console.log('Error:', result.error);
  }
  return result;
}

module.exports = {
  authenticateAndGetToken,
  getLatestToken,
  getValidToken,
  testAuthentication,
  checkAndRefreshToken,
  setupCronJobs
};