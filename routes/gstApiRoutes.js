// const express = require('express');
// const router = express.Router();
// const db = require('../db');
// const axios = require('axios');
// const crypto = require('crypto');
// const fs = require('fs');
// const bodyParser = require('body-parser');



// const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJnc3AiXSwiYXV0aG9yaXRpZXMiOlsiUk9MRV9TQl9BUElfRVdCIiwiUk9MRV9TQl9BUElfR1NUX0NPTU1PTiIsIlJPTEVfU0JfQVBJX0dTVF9SRVRVUk5TIiwiUk9MRV9TQl9FX0FQSV9FV0IiLCJST0xFX1NCX0VfQVBJX0dTVF9DT01NT04iLCJST0xFX1NCX0VfQVBJX0dTVF9SRVRVUk5TIiwiUk9MRV9TQl9BUElfRUkiLCJST0xFX1NCX0VfQVBJX0VJIiwiUk9MRV9TQl9BUElfR1NQX09USEVSUyJdLCJqdGkiOiIzOGVmOTlmNi05ZDQxLTQ4NmYtYjlhYy00YTA4Zjk5NTZiY2EiLCJjbGllbnRfaWQiOiI3OTUzNkUzOUYyMTY0NDk4ODM3MjBDQ0Q1MzY0M0Q4RiIsInN1YiI6Ijc5NTM2RTM5RjIxNjQ0OTg4MzcyMENDRDUzNjQzRDhGIiwiZXhwIjoxNzgxNTA2ODgyfQ.TJF16LJTUjWbGldZLOGepkD4fAvpn2AwD6721P3_f6U';
// const USER_NAME = 'your_username_here';


// router.post('/gstin-details', async (req, res) => {

//   const gstin = req.body?.gstin;

// if (!gstin) {
//   fs.appendFileSync('error_log.txt', 'Invalid or missing GSTIN in request.\n');
//   return res.status(400).json({ success: false, message: 'GSTIN is required' });
// }

//   const requestid = crypto.randomBytes(8).toString('hex');

//   try {
//     if (!ACCESS_TOKEN) {
//       throw new Error('Access token is missing');
//     }

//       const requestid = crypto.randomBytes(16).toString('hex');

//     const url = `${GSP_URL}/enriched/ei/api/master/gstin`;

//     const response = await axios.get(url, {
//       headers: {
//         'Authorization': `Bearer ${ACCESS_TOKEN}`,
//         'Content-Type': 'application/json',
//         'Accept': 'application/json',
//         'user_name': USER_NAME,      // Mandatory - Your username
//         'requestid': requestid,       // Mandatory - Unique request ID
//         'gstin': gstin               // Mandatory - GSTIN in header
//       },
//       params: {
//         gstin: gstin  // May also need to keep in query params
//       }
//     });

//     const data = response.data;

//     if (response.status === 200 && data.success && data.result) {
//       const result = data.result;
//       const addr = result.pradr?.addr || {};

//       // Print details to console like how browser form is filled
//       console.log("Customer Registered Name:", result.lgnm || '');
//       console.log("Business Name:", result.tradeNam || '');
//       console.log("Additional Business Name:", result.tradeNam || '');
//       console.log("Display Name:", result.lgnm || '');

//       const addressLine1 = `${addr.bno || ''}${addr.bno && addr.flno ? ', ' : ''}${addr.flno || ''}`.trim();
//       const addressLine2 = `${addr.st || ''}${addr.st && addr.bnm ? ', ' : ''}${addr.bnm || ''}${(addr.st || addr.bnm) && addr.loc ? ', ' : ''}${addr.loc || ''}`.trim();

//       console.log("Address Line 1:", addressLine1);
//       console.log("Address Line 2:", addressLine2);
//       console.log("City (ctj):", result.ctj || '');
//       console.log("Pincode:", addr.pncd || '');
//       console.log("State Code:", addr.stcd || '');
//       console.log("Country: India");

//       fs.appendFileSync('error_log.txt', `Success: ${JSON.stringify(data)}\n`);
//       return res.json(data);
//     } else {
//       const message = data.message || 'Unknown error';
//       fs.appendFileSync('error_log.txt', `Error: ${message}\n`);
//       return res.status(response.status).json({ success: false, message });
//     }
//   } catch (error) {
//     fs.appendFileSync('error_log.txt', `Exception: ${error.message}\n`);
//     return res.status(500).json({ success: false, message: error.message });
//   }
// });


// module.exports = router;


const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const { getValidToken } = require('../gspAuth');
// require('dotenv').config();

const USER_NAME = process.env.GSP_USERNAME?.trim();
const PASSWORD = process.env.GSP_PASSWORD?.trim();
const GSTIN = process.env.GSTIN?.trim();
const GSP_URL = process.env.GSP_URL?.trim();
const APP_ID = process.env.GSP_APP_ID?.trim();
const APP_SECRET = process.env.GSP_APP_SECRET?.trim();

// console.log({
//   USER_NAME,
//   PASSWORD,
//   GSP_URL,
//   GSTIN
// });

async function getAccessToken() {
  try {
    const tokenData = await getValidToken();

    if (!tokenData || !tokenData.access_token) {
      throw new Error('No valid GSP token found');
    }

    return tokenData.access_token;
  } catch (error) {
    console.error('Error getting GSP token:', error.message);
    throw error;
  }
}

router.post('/gstin-details', async (req, res) => {
  const gstin = req.body?.gstin;
const accessToken = await getAccessToken();
  if (!gstin) {
    return res.status(400).json({
      success: false,
      message: 'GSTIN is required'
    });
  }

  try {
    const requestid = crypto.randomBytes(16).toString('hex');

    console.log('========== REQUEST ==========');
    console.log('GSTIN:', gstin);
    console.log('Username:', USER_NAME);
    console.log('Request ID:', requestid);
    console.log('Token Present:', accessToken);

    const response = await axios.get(
  `${GSP_URL}/enriched/ei/api/master/gstin`,
  {
    params: {
      gstin
    },
    headers: {
      "Content-Type": "application/json",
      "user_name": USER_NAME,
      "password": PASSWORD,
      "gstin": GSTIN,
      "requestid": requestid,
      "Authorization": `Bearer ${accessToken}`
    },
//      headers: {
//   Authorization: `Bearer ${accessToken}`,
//   Accept: 'application/json',
//   'Content-Type': 'application/json',
//   user_name: 'SHASHWATRAJ#MSA',
//   password: 'Croma@0786',
//   gstin: '10AAOCS1541B1ZZ',
//   requestid: requestid
// },
    validateStatus: () => true
  }
);

    console.log("headers:", response.config.headers);
    console.log('========== RESPONSE ==========');
    console.log('Status:', response.status);
    console.log(
      'Body:',
      JSON.stringify(response.data, null, 2)
    );

    console.log('Header GSTIN:', gstin);
    console.log('Query GSTIN:', gstin);

    if (response.status !== 200) {
      return res.status(response.status).json({
        success: false,
        response: response.data
      });
    }

    const result = response.data?.result;

    if (!result) {
      return res.status(400).json({
        success: false,
        response: response.data
      });
    }

    const addr = result?.pradr?.addr || {};

    const data = {
      customerRegisteredName: result.lgnm || '',
      businessName: result.tradeNam || '',
      displayName: result.lgnm || '',
      addressLine1: `${addr.bno || ''} ${addr.flno || ''}`.trim(),
      addressLine2: `${addr.st || ''} ${addr.bnm || ''} ${addr.loc || ''}`.trim(),
      city: result.ctj || '',
      pincode: addr.pncd || '',
      stateCode: addr.stcd || '',
      country: 'India',
      raw: result
    };

    return res.json({
      success: true,
      data
    });

  } catch (error) {
    console.log('========== ERROR ==========');
    console.log('Message:', error.message);
    console.log(
      'Response:',
      JSON.stringify(error.response?.data, null, 2)
    );

    fs.appendFileSync(
      'error_log.txt',
      `${new Date().toISOString()} - ${error.message}\n`
    );

    return res.status(500).json({
      success: false,
      message: error.message,
      details: error.response?.data || null
    });
  }
});

module.exports = router;