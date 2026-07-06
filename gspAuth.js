// // gspAuth.js
// const axios = require('axios');
// const db = require('./db');

// // Sandbox env 
// const gspappid = "79536E39F216449883720CCD53643D8F";
// const gspappsecret = "EE5EFAACG8434G43E8GA90EG9660E98C3D71";

// // Correct authentication endpoint (based on typical Adaequare patterns)
// // Try these in order of probability:
// const AUTH_URLS = [
//   'https://gsp.adaequare.com/gsp/authenticate?grant_type=token',
//   'https://gsp.adaequare.com/gsp/authenticate',
//   'https://gsp.adaequare.com/test/gsp/authenticate',
//   'https://gsp.adaequare.com/auth/token',
//   'https://gsp.adaequare.com/oauth/token'
// ];

// // Function to authenticate and get token
// async function authenticateAndGetToken() {
//   try {
//     // Try multiple endpoints if needed
//     let response = null;
//     let lastError = null;
    
//     for (const url of AUTH_URLS) {
//       try {
//         console.log(`Attempting authentication to: ${url}`);
        
//         // Option 1: Try as POST with form data (most common)
//         response = await axios.post(url, 
//           new URLSearchParams({
//             'grant_type': 'client_credentials',
//             'client_id': gspappid,
//             'client_secret': gspappsecret
//           }).toString(),
//           {
//             headers: {
//               'Content-Type': 'application/x-www-form-urlencoded'
//             }
//           }
//         );
        
//         if (response.data && response.data.access_token) {
//           console.log(`✓ Authentication successful at: ${url}`);
//           break;
//         }
//       } catch (err) {
//         lastError = err;
        
//         // Option 2: Try as POST with JSON body
//         try {
//           response = await axios.post(url, {
//             'grant_type': 'client_credentials',
//             'client_id': gspappid,
//             'client_secret': gspappsecret
//           }, {
//             headers: {
//               'Content-Type': 'application/json'
//             }
//           });
          
//           if (response.data && response.data.access_token) {
//             console.log(`✓ Authentication successful at: ${url} (JSON format)`);
//             break;
//           }
//         } catch (err2) {
//           // Option 3: Try with headers only (your original approach)
//           try {
//             response = await axios.post(url + '?grant_type=client_credentials', null, {
//               headers: {
//                 'gspappid': gspappid,
//                 'gspappsecret': gspappsecret
//               }
//             });
            
//             if (response.data && response.data.access_token) {
//               console.log(`✓ Authentication successful at: ${url} (header only)`);
//               break;
//             }
//           } catch (err3) {
//             lastError = err3;
//           }
//         }
//       }
//     }
    
//     if (!response || !response.data) {
//       throw new Error('All authentication attempts failed');
//     }
    
//     const data = response.data;
    
//     if (data.access_token) {
//       const expiresAt = data.expires_in 
//         ? new Date(Date.now() + (data.expires_in * 1000))
//         : new Date(Date.now() + (6 * 60 * 60 * 1000)); // Default 6 hours
      
//       const formattedExpiresAt = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
      
//       // Fix: Don't specify ID, let DB auto_increment handle it
//       const sql = `INSERT INTO gsp_api 
//                    (access_token, token_type, expires_at, created_at, gspappid, gspappsecret) 
//                    VALUES (?, ?, ?, NOW(), ?, ?)`;
      
//       const result = await new Promise((resolve, reject) => {
//         db.query(sql, [
//           data.access_token, 
//           data.token_type || 'bearer', 
//           formattedExpiresAt, 
//           gspappid, 
//           gspappsecret
//         ], (err, result) => {
//           if (err) reject(err);
//           else resolve(result);
//         });
//       });
      
//       console.log('✓ GSP Token generated successfully');
//       console.log('Token expires at:', formattedExpiresAt);
      
//       return {
//         success: true,
//         access_token: data.access_token,
//         token_type: data.token_type || 'bearer',
//         expires_at: formattedExpiresAt
//       };
//     } else {
//       console.log('✗ Invalid response structure from GSP:', data);
//       return { success: false, error: 'Invalid response structure', details: data };
//     }
    
//   } catch (error) {
//     console.error('✗ GSP Token generation error:', error.message);
//     if (error.response) {
//       console.error('Status:', error.response.status);
//       console.error('Response Headers:', error.response.headers);
//       console.error('Response Data:', error.response.data);
      
//       // Provide specific guidance based on status code
//       if (error.response.status === 401) {
//         console.error('→ Authentication failed. Check your gspappid and gspappsecret');
//       } else if (error.response.status === 404) {
//         console.error('→ Endpoint not found. The authentication URL may be incorrect');
//       } else if (error.response.status === 500) {
//         console.error('→ Server error. The API endpoint or request format might be wrong');
//       }
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
//                  ORDER BY expires_at DESC 
//                  LIMIT 1`;
    
//     db.query(sql, (err, results) => {
//       if (err) reject(err);
//       else resolve(results[0] || null);
//     });
//   });
// }

// // Function to refresh token if expired
// async function getValidToken() {
//   try {
//     let token = await getLatestToken();
    
//     if (!token) {
//       console.log('No valid token found, generating new one...');
//       const result = await authenticateAndGetToken();
//       if (result.success) {
//         token = {
//           access_token: result.access_token,
//           token_type: result.token_type,
//           expires_at: result.expires_at
//         };
//       } else {
//         throw new Error(result.error || 'Failed to generate token');
//       }
//     } else {
//       console.log('Using existing valid token (expires at:', token.expires_at, ')');
//     }
    
//     return token;
//   } catch (error) {
//     console.error('Error in getValidToken:', error.message);
//     throw error;
//   }
// }

// // Test function to verify authentication
// async function testAuthentication() {
//   console.log('Testing GSP Authentication...');
//   const result = await authenticateAndGetToken();
//   if (result.success) {
//     console.log('✓ Authentication test passed!');
//     console.log('Token preview:', result.access_token.substring(0, 50) + '...');
//   } else {
//     console.log('✗ Authentication test failed!');
//     console.log('Error:', result.error);
//   }
//   return result;
// }

// module.exports = {
//   authenticateAndGetToken,
//   getLatestToken,
//   getValidToken,
//   testAuthentication
// };




// const axios = require('axios');
// const db = require('./db');
// const cron = require('node-cron');

// // Sandbox env 
// const gspappid = "79536E39F216449883720CCD53643D8F";
// const gspappsecret = "EE5EFAACG8434G43E8GA90EG9660E98C3D71";

// // Correct authentication endpoint (based on typical Adaequare patterns)
// const AUTH_URLS = [
//   'https://gsp.adaequare.com/gsp/authenticate?grant_type=token',
//   'https://gsp.adaequare.com/gsp/authenticate',
//   'https://gsp.adaequare.com/test/gsp/authenticate',
//   'https://gsp.adaequare.com/auth/token',
//   'https://gsp.adaequare.com/oauth/token'
// ];

// // Function to authenticate and get token
// async function authenticateAndGetToken() {
//   try {
//     let response = null;
//     let lastError = null;
    
//     for (const url of AUTH_URLS) {
//       try {
//         console.log(`Attempting authentication to: ${url}`);
        
//         // Option 1: POST with form data
//         response = await axios.post(url, 
//           new URLSearchParams({
//             'grant_type': 'client_credentials',
//             'client_id': gspappid,
//             'client_secret': gspappsecret
//           }).toString(),
//           {
//             headers: {
//               'Content-Type': 'application/x-www-form-urlencoded'
//             }
//           }
//         );
        
//         if (response.data && response.data.access_token) {
//           console.log(`✓ Authentication successful at: ${url}`);
//           break;
//         }
//       } catch (err) {
//         lastError = err;
        
//         // Option 2: POST with JSON body
//         try {
//           response = await axios.post(url, {
//             'grant_type': 'client_credentials',
//             'client_id': gspappid,
//             'client_secret': gspappsecret
//           }, {
//             headers: {
//               'Content-Type': 'application/json'
//             }
//           });
          
//           if (response.data && response.data.access_token) {
//             console.log(`✓ Authentication successful at: ${url} (JSON format)`);
//             break;
//           }
//         } catch (err2) {
//           // Option 3: Headers only
//           try {
//             response = await axios.post(url + '?grant_type=client_credentials', null, {
//               headers: {
//                 'gspappid': gspappid,
//                 'gspappsecret': gspappsecret
//               }
//             });
            
//             if (response.data && response.data.access_token) {
//               console.log(`✓ Authentication successful at: ${url} (header only)`);
//               break;
//             }
//           } catch (err3) {
//             lastError = err3;
//           }
//         }
//       }
//     }
    
//     if (!response || !response.data) {
//       throw new Error('All authentication attempts failed');
//     }
    
//     const data = response.data;
    
//     if (data.access_token) {
//       const expiresAt = data.expires_in 
//         ? new Date(Date.now() + (data.expires_in * 1000))
//         : new Date(Date.now() + (6 * 60 * 60 * 1000)); // Default 6 hours
      
//       const formattedExpiresAt = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
      
//       // Insert new token
//       const sql = `INSERT INTO gsp_api 
//                    (access_token, token_type, expires_at, created_at, gspappid, gspappsecret) 
//                    VALUES (?, ?, ?, NOW(), ?, ?)`;
      
//       const result = await new Promise((resolve, reject) => {
//         db.query(sql, [
//           data.access_token, 
//           data.token_type || 'bearer', 
//           formattedExpiresAt, 
//           gspappid, 
//           gspappsecret
//         ], (err, result) => {
//           if (err) reject(err);
//           else resolve(result);
//         });
//       });
      
//       console.log('✓ GSP Token generated successfully');
//       console.log('Token expires at:', formattedExpiresAt);
      
//       return {
//         success: true,
//         access_token: data.access_token,
//         token_type: data.token_type || 'bearer',
//         expires_at: formattedExpiresAt
//       };
//     } else {
//       console.log('✗ Invalid response structure from GSP:', data);
//       return { success: false, error: 'Invalid response structure', details: data };
//     }
    
//   } catch (error) {
//     console.error('✗ GSP Token generation error:', error.message);
//     if (error.response) {
//       console.error('Status:', error.response.status);
//       console.error('Response Data:', error.response.data);
      
//       if (error.response.status === 401) {
//         console.error('→ Authentication failed. Check your gspappid and gspappsecret');
//       } else if (error.response.status === 404) {
//         console.error('→ Endpoint not found. The authentication URL may be incorrect');
//       }
//     }
//     return { success: false, error: error.message };
//   }
// }

// // Function to get the latest valid token from database
// async function getLatestToken() {
//   return new Promise((resolve, reject) => {
//     const sql = `SELECT * FROM gsp_api 
//                  WHERE expires_at > NOW() 
//                  ORDER BY expires_at DESC 
//                  LIMIT 1`;
    
//     db.query(sql, (err, results) => {
//       if (err) reject(err);
//       else resolve(results[0] || null);
//     });
//   });
// }

// // Function to refresh token if expired
// async function getValidToken() {
//   try {
//     let token = await getLatestToken();
    
//     if (!token) {
//       console.log('No valid token found, generating new one...');
//       const result = await authenticateAndGetToken();
//       if (result.success) {
//         token = {
//           access_token: result.access_token,
//           token_type: result.token_type,
//           expires_at: result.expires_at
//         };
//       } else {
//         throw new Error(result.error || 'Failed to generate token');
//       }
//     } else {
//       console.log('Using existing valid token (expires at:', token.expires_at, ')');
//     }
    
//     return token;
//   } catch (error) {
//     console.error('Error in getValidToken:', error.message);
//     throw error;
//   }
// }

// // Function to get the token expiration time
// async function getTokenExpiration() {
//   return new Promise((resolve, reject) => {
//     const sql = `SELECT expires_at FROM gsp_api ORDER BY expires_at DESC LIMIT 1`;
    
//     db.query(sql, (err, results) => {
//       if (err) reject(err);
//       else resolve(results[0] || null);
//     });
//   });
// }

// // Function to check and refresh token if needed
// async function checkAndRefreshToken() {
//   try {
//     const tokenInfo = await getTokenExpiration();
    
//     if (!tokenInfo) {
//       console.log('No token found in database. Generating new token...');
//       const result = await authenticateAndGetToken();
//       return result.success;
//     }
    
//     const expiresAt = new Date(tokenInfo.expires_at);
//     const now = new Date();
//     const timeUntilExpiry = expiresAt - now;
//     const minutesUntilExpiry = timeUntilExpiry / (1000 * 60);
    
//     console.log(`Token expires in ${minutesUntilExpiry.toFixed(2)} minutes`);
    
//     // Refresh if token expires in less than 30 minutes
//     if (minutesUntilExpiry < 30) {
//       console.log('Token is about to expire. Generating new token...');
//       const result = await authenticateAndGetToken();
//       return result.success;
//     }
    
//     console.log('Token is still valid. No refresh needed.');
//     return true;
    
//   } catch (error) {
//     console.error('Error checking token expiration:', error.message);
//     return false;
//   }
// }

// // CRON JOB SETUP
// function setupCronJobs() {
//   // Run every 30 minutes to check token validity
//   const tokenCheckJob = cron.schedule('*/30 * * * *', async () => {
//     console.log('🔄 Running scheduled token check...');
//     try {
//       await checkAndRefreshToken();
//     } catch (error) {
//       console.error('❌ Scheduled token check failed:', error.message);
//     }
//   });
  
//   // Run daily at 2:00 AM for maintenance
//   const dailyMaintenanceJob = cron.schedule('0 2 * * *', async () => {
//     console.log('🔄 Running daily token maintenance...');
//     try {
//       // Clean up old tokens (keep only last 30 days)
//       const cleanupSql = `DELETE FROM gsp_api 
//                          WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`;
      
//       await new Promise((resolve, reject) => {
//         db.query(cleanupSql, (err, result) => {
//           if (err) reject(err);
//           else {
//             console.log(`🧹 Cleaned up ${result.affectedRows} old tokens`);
//             resolve(result);
//           }
//         });
//       });
      
//       // Ensure token is valid
//       await checkAndRefreshToken();
      
//     } catch (error) {
//       console.error('❌ Daily maintenance failed:', error.message);
//     }
//   });
  
//   // Run on startup
//   console.log('🚀 Initial token check on startup...');
//   setTimeout(async () => {
//     await checkAndRefreshToken();
//   }, 5000);
  
//   console.log('✅ Cron jobs scheduled successfully');
//   console.log('📅 Token check: Every 30 minutes');
//   console.log('📅 Daily maintenance: 2:00 AM');
  
//   return { tokenCheckJob, dailyMaintenanceJob };
// }

// // Test function to verify authentication
// async function testAuthentication() {
//   console.log('Testing GSP Authentication...');
//   const result = await authenticateAndGetToken();
//   if (result.success) {
//     console.log('✓ Authentication test passed!');
//     console.log('Token preview:', result.access_token.substring(0, 50) + '...');
//   } else {
//     console.log('✗ Authentication test failed!');
//     console.log('Error:', result.error);
//   }
//   return result;
// }

// module.exports = {
//   authenticateAndGetToken,
//   getLatestToken,
//   getValidToken,
//   testAuthentication,
//   getTokenExpiration,
//   checkAndRefreshToken,
//   setupCronJobs
// };


// gspAuth.js (updated version)
// const axios = require('axios');
// const db = require('./db');
// const cron = require('node-cron');
// const tokenManager = require('./tokenManager');

// // Sandbox env 
// const gspappid = "79536E39F216449883720CCD53643D8F";
// const gspappsecret = "EE5EFAACG8434G43E8GA90EG9660E98C3D71";

// // Correct authentication endpoint
// const AUTH_URLS = [
//   'https://gsp.adaequare.com/gsp/authenticate?grant_type=token',
//   'https://gsp.adaequare.com/gsp/authenticate',
//   'https://gsp.adaequare.com/test/gsp/authenticate',
//   'https://gsp.adaequare.com/auth/token',
//   'https://gsp.adaequare.com/oauth/token'
// ];

// // Function to authenticate and get token
// async function authenticateAndGetToken() {
//   try {
//     let response = null;
    
//     for (const url of AUTH_URLS) {
//       try {
//         console.log(`Attempting authentication to: ${url}`);
        
//         response = await axios.post(url, 
//           new URLSearchParams({
//             'grant_type': 'client_credentials',
//             'client_id': gspappid,
//             'client_secret': gspappsecret
//           }).toString(),
//           {
//             headers: {
//               'Content-Type': 'application/x-www-form-urlencoded'
//             }
//           }
//         );
        
//         if (response.data && response.data.access_token) {
//           console.log(`✓ Authentication successful at: ${url}`);
//           break;
//         }
//       } catch (err) {
//         // Try JSON format
//         try {
//           response = await axios.post(url, {
//             'grant_type': 'client_credentials',
//             'client_id': gspappid,
//             'client_secret': gspappsecret
//           }, {
//             headers: {
//               'Content-Type': 'application/json'
//             }
//           });
          
//           if (response.data && response.data.access_token) {
//             console.log(`✓ Authentication successful at: ${url} (JSON format)`);
//             break;
//           }
//         } catch (err2) {
//           // Try headers only
//           try {
//             response = await axios.post(url + '?grant_type=client_credentials', null, {
//               headers: {
//                 'gspappid': gspappid,
//                 'gspappsecret': gspappsecret
//               }
//             });
            
//             if (response.data && response.data.access_token) {
//               console.log(`✓ Authentication successful at: ${url} (header only)`);
//               break;
//             }
//           } catch (err3) {
//             // Continue to next URL
//           }
//         }
//       }
//     }
    
//     if (!response || !response.data) {
//       throw new Error('All authentication attempts failed');
//     }
    
//     const data = response.data;
    
//     if (data.access_token) {
//       const expiresAt = data.expires_in 
//         ? new Date(Date.now() + (data.expires_in * 1000))
//         : new Date(Date.now() + (6 * 60 * 60 * 1000));
      
//       const formattedExpiresAt = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
      
//       // Insert new token
//       const sql = `INSERT INTO gsp_api 
//                    (access_token, token_type, expires_at, created_at, gspappid, gspappsecret) 
//                    VALUES (?, ?, ?, NOW(), ?, ?)`;
      
//       await new Promise((resolve, reject) => {
//         db.query(sql, [
//           data.access_token, 
//           data.token_type || 'bearer', 
//           formattedExpiresAt, 
//           gspappid, 
//           gspappsecret
//         ], (err, result) => {
//           if (err) reject(err);
//           else resolve(result);
//         });
//       });
      
//       // Update .env file with new token
//       await tokenManager.updateEnvFile(data.access_token);
      
//       // Update memory
//       global.GSP_TOKEN = {
//         access_token: data.access_token,
//         token_type: data.token_type || 'bearer',
//         expires_at: formattedExpiresAt
//       };
      
//       console.log('✓ GSP Token generated successfully');
//       console.log('Token expires at:', formattedExpiresAt);
//       console.log('✓ .env file updated with new token');
      
//       return {
//         success: true,
//         access_token: data.access_token,
//         token_type: data.token_type || 'bearer',
//         expires_at: formattedExpiresAt
//       };
//     } else {
//       console.log('✗ Invalid response structure from GSP:', data);
//       return { success: false, error: 'Invalid response structure', details: data };
//     }
    
//   } catch (error) {
//     console.error('✗ GSP Token generation error:', error.message);
//     if (error.response) {
//       console.error('Status:', error.response.status);
//       console.error('Response Data:', error.response.data);
//     }
//     return { success: false, error: error.message };
//   }
// }

// // Function to get the latest valid token
// async function getLatestToken() {
//   return new Promise((resolve, reject) => {
//     const sql = `SELECT * FROM gsp_api 
//                  WHERE expires_at > NOW() 
//                  ORDER BY expires_at DESC 
//                  LIMIT 1`;
    
//     db.query(sql, (err, results) => {
//       if (err) reject(err);
//       else resolve(results[0] || null);
//     });
//   });
// }

// // Function to get valid token with .env update
// async function getValidToken() {
//   try {
//     // First try to get from memory
//     if (global.GSP_TOKEN && global.GSP_TOKEN.access_token) {
//       const expiresAt = new Date(global.GSP_TOKEN.expires_at);
//       const now = new Date();
//       const timeUntilExpiry = expiresAt - now;
      
//       if (timeUntilExpiry > 5 * 60 * 1000) { // More than 5 minutes remaining
//         console.log('Using token from memory');
//         return global.GSP_TOKEN;
//       }
//     }
    
//     // Then try from database
//     let token = await getLatestToken();
    
//     if (!token) {
//       console.log('No valid token found, generating new one...');
//       const result = await authenticateAndGetToken();
//       if (result.success) {
//         token = {
//           access_token: result.access_token,
//           token_type: result.token_type,
//           expires_at: result.expires_at
//         };
//       } else {
//         throw new Error(result.error || 'Failed to generate token');
//       }
//     } else {
//       // Update .env with existing valid token
//       await tokenManager.updateEnvFile(token.access_token);
      
//       // Update memory
//       global.GSP_TOKEN = {
//         access_token: token.access_token,
//         token_type: token.token_type,
//         expires_at: token.expires_at
//       };
      
//       console.log('Using existing valid token (expires at:', token.expires_at, ')');
//     }
    
//     return token;
//   } catch (error) {
//     console.error('Error in getValidToken:', error.message);
//     throw error;
//   }
// }

// // Function to check and refresh token if needed
// async function checkAndRefreshToken() {
//   try {
//     // Use token manager to check if token is expired
//     const expired = await tokenManager.isTokenExpired();
    
//     if (expired) {
//       console.log('Token is expired or about to expire. Generating new token...');
//       const result = await authenticateAndGetToken();
//       return result.success;
//     }
    
//     console.log('Token is still valid. No refresh needed.');
//     return true;
    
//   } catch (error) {
//     console.error('Error checking token expiration:', error.message);
//     return false;
//   }
// }

// // CRON JOB SETUP
// function setupCronJobs() {
//   // Run every 30 minutes to check token validity
//   const tokenCheckJob = cron.schedule('*/30 * * * *', async () => {
//     console.log('🔄 Running scheduled token check...');
//     try {
//       await checkAndRefreshToken();
//     } catch (error) {
//       console.error('❌ Scheduled token check failed:', error.message);
//     }
//   });
  
//   // Run daily at 2:00 AM for maintenance
//   const dailyMaintenanceJob = cron.schedule('0 2 * * *', async () => {
//     console.log('🔄 Running daily token maintenance...');
//     try {
//       // Clean up old tokens
//       const cleanupSql = `DELETE FROM gsp_api 
//                          WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`;
      
//       await new Promise((resolve, reject) => {
//         db.query(cleanupSql, (err, result) => {
//           if (err) reject(err);
//           else {
//             console.log(`🧹 Cleaned up ${result.affectedRows} old tokens`);
//             resolve(result);
//           }
//         });
//       });
      
//       await checkAndRefreshToken();
      
//     } catch (error) {
//       console.error('❌ Daily maintenance failed:', error.message);
//     }
//   });
  
//   // Initial token fetch and .env update on startup
//   console.log('🚀 Fetching initial token on startup...');
//   setTimeout(async () => {
//     await getValidToken();
//     console.log('✅ Token fetched and .env updated on startup');
//   }, 5000);
  
//   console.log('✅ Cron jobs scheduled successfully');
//   console.log('📅 Token check: Every 30 minutes');
//   console.log('📅 Daily maintenance: 2:00 AM');
  
//   return { tokenCheckJob, dailyMaintenanceJob };
// }

// // Test function
// async function testAuthentication() {
//   console.log('Testing GSP Authentication...');
//   const result = await authenticateAndGetToken();
//   if (result.success) {
//     console.log('✓ Authentication test passed!');
//     console.log('Token preview:', result.access_token.substring(0, 50) + '...');
//   } else {
//     console.log('✗ Authentication test failed!');
//     console.log('Error:', result.error);
//   }
//   return result;
// }

// module.exports = {
//   authenticateAndGetToken,
//   getLatestToken,
//   getValidToken,
//   testAuthentication,
//   checkAndRefreshToken,
//   setupCronJobs
// };

// gspAuth.js
const axios = require('axios');
const db = require('./db');
const cron = require('node-cron');
const tokenManager = require('./tokenManager');

// Sandbox env 
const gspappid = "79536E39F216449883720CCD53643D8F";
const gspappsecret = "EE5EFAACG8434G43E8GA90EG9660E98C3D71";

// Authentication endpoints
const AUTH_URLS = [
  'https://gsp.adaequare.com/gsp/authenticate?grant_type=token',
  'https://gsp.adaequare.com/gsp/authenticate',
  'https://gsp.adaequare.com/test/gsp/authenticate',
  'https://gsp.adaequare.com/auth/token',
  'https://gsp.adaequare.com/oauth/token'
];

// Function to authenticate and get token
async function authenticateAndGetToken() {
  try {
    let response = null;
    
    for (const url of AUTH_URLS) {
      try {
        console.log(`Attempting authentication to: ${url}`);
        
        // Try form data
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
        // Try JSON format
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
          // Continue to next URL
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
      
      // Insert new token into database
      const sql = `INSERT INTO gsp_api 
                   (access_token, token_type, expires_at, created_at, gspappid, gspappsecret) 
                   VALUES (?, ?, ?, NOW(), ?, ?)`;
      
      await new Promise((resolve, reject) => {
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
      
      // Update .env file with new token
      await tokenManager.updateEnvFile(data.access_token);
      
      // Update global memory
      global.GSP_TOKEN = data.access_token;
      
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
    const sql = `SELECT * FROM gsp_api 
                 WHERE expires_at > NOW() 
                 ORDER BY expires_at DESC 
                 LIMIT 1`;
    
    db.query(sql, (err, results) => {
      if (err) reject(err);
      else resolve(results[0] || null);
    });
  });
}

// Function to get valid token (from memory, env, or DB)
async function getValidToken() {
  try {
    // First try from memory
    if (global.GSP_TOKEN) {
      console.log('Using token from memory');
      return {
        access_token: global.GSP_TOKEN,
        token_type: 'bearer',
        expires_at: 'from_memory'
      };
    }
    
    // Then try from process.env
    if (process.env.ACCESS_TOKEN) {
      console.log('Using token from process.env');
      global.GSP_TOKEN = process.env.ACCESS_TOKEN;
      return {
        access_token: process.env.ACCESS_TOKEN,
        token_type: 'bearer',
        expires_at: 'from_env'
      };
    }
    
    // Finally from database
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
      // Update .env and memory with existing valid token
      await tokenManager.updateEnvFile(token.access_token);
      global.GSP_TOKEN = token.access_token;
      console.log('Using existing valid token (expires at:', token.expires_at, ')');
    }
    
    return token;
  } catch (error) {
    console.error('Error in getValidToken:', error.message);
    throw error;
  }
}

// Function to check and refresh token if needed
async function checkAndRefreshToken() {
  try {
    const tokenData = await getLatestToken();
    
    if (!tokenData) {
      console.log('No token found. Generating new token...');
      const result = await authenticateAndGetToken();
      return result.success;
    }
    
    const expiresAt = new Date(tokenData.expires_at);
    const now = new Date();
    const timeUntilExpiry = expiresAt - now;
    const minutesUntilExpiry = timeUntilExpiry / (1000 * 60);
    
    console.log(`Token expires in ${minutesUntilExpiry.toFixed(2)} minutes`);
    
    // Refresh if token expires in less than 30 minutes
    if (minutesUntilExpiry < 30) {
      console.log('Token is about to expire. Generating new token...');
      const result = await authenticateAndGetToken();
      return result.success;
    }
    
    console.log('Token is still valid. No refresh needed.');
    return true;
    
  } catch (error) {
    console.error('Error checking token expiration:', error.message);
    return false;
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
  testAuthentication,
  checkAndRefreshToken,
  setupCronJobs
};