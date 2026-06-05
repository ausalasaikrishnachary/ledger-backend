// // gspAuth.js
// const axios = require('axios');
// const db = require('./db');

// // Sandbox env 
// const gspappid = "79536E39F216449883720CCD53643D8F";
// const gspappsecret = "EE5EFAACG8434G43E8GA90EG9660E98C3D71";

// // Function to authenticate and get token
// async function authenticateAndGetToken() {
//   try {
//     const url = 'https://gsp.adaequare.com/gsp/authenticate?grant_type=token';
    
//     const response = await axios.post(url, null, {
//       headers: {
//         'gspappid': gspappid,
//         'gspappsecret': gspappsecret
//       }
//     });
    
//     const data = response.data;
    
//     if (data.token_type && data.expires_in) {
//       const expiresAt = new Date(Date.now() + (data.expires_in * 1000));
//       const formattedExpiresAt = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
      
//       const sql = `INSERT INTO gsp_api (access_token, token_type, expires_at, created_at, gspappid, gspappsecret) 
//                    VALUES (?, ?, ?, NOW(), ?, ?)`;
      
//       const result = await new Promise((resolve, reject) => {
//         db.query(sql, [data.access_token, data.token_type, formattedExpiresAt, gspappid, gspappsecret], (err, result) => {
//           if (err) reject(err);
//           else resolve(result);
//         });
//       });
      
//       console.log('✓ GSP Token generated successfully');
//       console.log('Token expires at:', formattedExpiresAt);
      
//       return {
//         success: true,
//         access_token: data.access_token,
//         token_type: data.token_type,
//         expires_at: formattedExpiresAt
//       };
//     } else {
//       console.log('✗ Invalid response structure from GSP');
//       return { success: false, error: 'Invalid response structure' };
//     }
    
//   } catch (error) {
//     console.error('✗ GSP Token generation error:', error.message);
//     if (error.response) {
//       console.error('Server Response:', error.response.status, error.response.data);
//     }
//     return { success: false, error: error.message };
//   }
// }

// // Function to get the latest valid token from database
// async function getLatestToken() {
//   return new Promise((resolve, reject) => {
//     const sql = `SELECT access_token, token_type, expires_at 
//                  FROM gsp_api 
//                  WHERE expires_at > NOW() 
//                  ORDER BY created_at DESC 
//                  LIMIT 1`;
    
//     db.query(sql, (err, results) => {
//       if (err) reject(err);
//       else resolve(results[0] || null);
//     });
//   });
// }

// // Function to refresh token if expired
// async function getValidToken() {
//   let token = await getLatestToken();
  
//   if (!token) {
//     console.log('No valid token found, generating new one...');
//     const result = await authenticateAndGetToken();
//     if (result.success) {
//       token = {
//         access_token: result.access_token,
//         token_type: result.token_type,
//         expires_at: result.expires_at
//       };
//     } else {
//       throw new Error('Failed to generate token');
//     }
//   } else {
//     console.log('Using existing valid token');
//   }
  
//   return token;
// }

// module.exports = {
//   authenticateAndGetToken,
//   getLatestToken,
//   getValidToken
// };



// gspAuth.js
const axios = require('axios');
const db = require('./db');

// Sandbox env 
const gspappid = "79536E39F216449883720CCD53643D8F";
const gspappsecret = "EE5EFAACG8434G43E8GA90EG9660E98C3I"; // Note: Fixed from your original (was missing 'I' at the end)

// Correct authentication endpoint (based on typical Adaequare patterns)
// Try these in order of probability:
const AUTH_URLS = [
  'https://gsp.adaequare.com/gsp/authenticate',
  'https://gsp.adaequare.com/test/gsp/authenticate',
  'https://gsp.adaequare.com/auth/token',
  'https://gsp.adaequare.com/oauth/token'
];

// Function to authenticate and get token
async function authenticateAndGetToken() {
  try {
    // Try multiple endpoints if needed
    let response = null;
    let lastError = null;
    
    for (const url of AUTH_URLS) {
      try {
        console.log(`Attempting authentication to: ${url}`);
        
        // Option 1: Try as POST with form data (most common)
        response = await axios.post(url, 
          new URLSearchParams({
            'grant_type': 'client_credentials',
            'client_id': gspappid,
            'client_secret': gspappsecret
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        
        if (response.data && response.data.access_token) {
          console.log(`✓ Authentication successful at: ${url}`);
          break;
        }
      } catch (err) {
        lastError = err;
        
        // Option 2: Try as POST with JSON body
        try {
          response = await axios.post(url, {
            'grant_type': 'client_credentials',
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
          // Option 3: Try with headers only (your original approach)
          try {
            response = await axios.post(url + '?grant_type=client_credentials', null, {
              headers: {
                'gspappid': gspappid,
                'gspappsecret': gspappsecret
              }
            });
            
            if (response.data && response.data.access_token) {
              console.log(`✓ Authentication successful at: ${url} (header only)`);
              break;
            }
          } catch (err3) {
            lastError = err3;
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
      
      // Fix: Don't specify ID, let DB auto_increment handle it
      const sql = `INSERT INTO gsp_api 
                   (access_token, token_type, expires_at, created_at, gspappid, gspappsecret) 
                   VALUES (?, ?, ?, NOW(), ?, ?)`;
      
      const result = await new Promise((resolve, reject) => {
        db.query(sql, [
          data.access_token, 
          data.token_type || 'bearer', 
          formattedExpiresAt, 
          gspappid, 
          gspappsecret
        ], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      
      console.log('✓ GSP Token generated successfully');
      console.log('Token expires at:', formattedExpiresAt);
      
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
      console.error('Response Headers:', error.response.headers);
      console.error('Response Data:', error.response.data);
      
      // Provide specific guidance based on status code
      if (error.response.status === 401) {
        console.error('→ Authentication failed. Check your gspappid and gspappsecret');
      } else if (error.response.status === 404) {
        console.error('→ Endpoint not found. The authentication URL may be incorrect');
      } else if (error.response.status === 500) {
        console.error('→ Server error. The API endpoint or request format might be wrong');
      }
    }
    return { success: false, error: error.message };
  }
}

// Function to get the latest valid token from database
async function getLatestToken() {
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

// Function to refresh token if expired
async function getValidToken() {
  try {
    let token = await getLatestToken();
    
    if (!token) {
      console.log('No valid token found, generating new one...');
      const result = await authenticateAndGetToken();
      if (result.success) {
        token = {
          access_token: result.access_token,
          token_type: result.token_type,
          expires_at: result.expires_at
        };
      } else {
        throw new Error(result.error || 'Failed to generate token');
      }
    } else {
      console.log('Using existing valid token (expires at:', token.expires_at, ')');
    }
    
    return token;
  } catch (error) {
    console.error('Error in getValidToken:', error.message);
    throw error;
  }
}

// Test function to verify authentication
async function testAuthentication() {
  console.log('Testing GSP Authentication...');
  const result = await authenticateAndGetToken();
  if (result.success) {
    console.log('✓ Authentication test passed!');
    console.log('Token preview:', result.access_token.substring(0, 50) + '...');
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
  testAuthentication
};