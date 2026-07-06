// tokenManager.js
const db = require('./db');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load existing .env variables
dotenv.config();

// Function to get the latest valid token from database
async function getLatestTokenFromDB() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT access_token, token_type, expires_at 
                 FROM gsp_api 
                 WHERE expires_at > NOW() 
                 ORDER BY expires_at DESC 
                 LIMIT 1`;
    
    db.query(sql, (err, results) => {
      if (err) reject(err);
      else resolve(results[0] || null);
    });
  });
}

// Function to update .env file with new token
async function updateEnvFile(token) {
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    // Read existing .env file if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Parse existing .env content
    const envLines = envContent.split('\n');
    let tokenFound = false;
    
    // Update or add ACCESS_TOKEN
    const updatedLines = envLines.map(line => {
      if (line.startsWith('ACCESS_TOKEN=')) {
        tokenFound = true;
        return `ACCESS_TOKEN=${token}`;
      }
      return line;
    });
    
    // If ACCESS_TOKEN doesn't exist, add it
    if (!tokenFound) {
      updatedLines.push(`ACCESS_TOKEN=${token}`);
    }
    
    // Write back to .env file
    fs.writeFileSync(envPath, updatedLines.join('\n'), 'utf8');
    
    // Also update process.env for current runtime
    process.env.ACCESS_TOKEN = token;
    
    console.log('✅ .env file updated with new ACCESS_TOKEN');
    return true;
  } catch (error) {
    console.error('❌ Error updating .env file:', error.message);
    return false;
  }
}

// Function to fetch and set the latest token
async function fetchAndSetToken() {
  try {
    const tokenData = await getLatestTokenFromDB();
    
    if (!tokenData) {
      console.log('⚠️ No valid token found in database');
      return null;
    }
    
    // Update .env file
    await updateEnvFile(tokenData.access_token);
    
    // Also store in memory for quick access
    global.GSP_TOKEN = {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_at: tokenData.expires_at
    };
    
    console.log('✅ Token fetched and set successfully');
    console.log(`📅 Token expires at: ${tokenData.expires_at}`);
    
    return tokenData.access_token;
  } catch (error) {
    console.error('❌ Error fetching token:', error.message);
    return null;
  }
}

// Function to get token from memory (faster than DB query)
function getTokenFromMemory() {
  if (global.GSP_TOKEN && global.GSP_TOKEN.access_token) {
    return global.GSP_TOKEN;
  }
  return null;
}

// Function to get token (first from memory, then from DB if not available)
async function getToken() {
  // Check memory first
  const memoryToken = getTokenFromMemory();
  if (memoryToken) {
    return memoryToken.access_token;
  }
  
  // If not in memory, fetch from DB
  const tokenData = await getLatestTokenFromDB();
  if (tokenData) {
    // Update memory and .env
    global.GSP_TOKEN = {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_at: tokenData.expires_at
    };
    await updateEnvFile(tokenData.access_token);
    return tokenData.access_token;
  }
  
  return null;
}

// Function to check if token is expired
async function isTokenExpired() {
  const tokenData = await getLatestTokenFromDB();
  if (!tokenData) return true;
  
  const expiresAt = new Date(tokenData.expires_at);
  const now = new Date();
  const timeUntilExpiry = expiresAt - now;
  
  // Consider expired if less than 5 minutes remaining
  return timeUntilExpiry < 5 * 60 * 1000;
}

// Function to refresh token in .env (call this when token is refreshed)
async function refreshTokenInEnv(newToken) {
  if (newToken) {
    await updateEnvFile(newToken);
    global.GSP_TOKEN = {
      access_token: newToken,
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
    };
    return true;
  }
  return false;
}

module.exports = {
  getLatestTokenFromDB,
  updateEnvFile,
  fetchAndSetToken,
  getTokenFromMemory,
  getToken,
  isTokenExpired,
  refreshTokenInEnv
};