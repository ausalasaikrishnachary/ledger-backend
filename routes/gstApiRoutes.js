const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const bodyParser = require('body-parser');

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJnc3AiXSwiZXhwIjoxNzY4MTkxNTQ4LCJhdXRob3JpdGllcyI6WyJST0xFX1BST0RfRV9BUElfR1NUX1JFVFVSTlMiLCJST0xFX1BST0RfRV9BUElfRVdCIiwiUk9MRV9QUk9EX0VfQVBJX0dTVF9DT01NT04iLCJST0xFX1BST0RfRV9BUElfRUkiXSwianRpIjoiNmM1M2E4YWItMjRmYy00ODM3LTg4NGUtYzkzNDU5NDY2MTRlIiwiY2xpZW50X2lkIjoiNzcxQ0I4RTVDMjcwNDlBNDhCMzg0MjY0MzkxNzUyODQifQ.j2vauNaSsKmE3P1KOB-mO3pu4m46IcfDKjVFCqYWHpw';

router.post('/gstin-details', async (req, res) => {

  const gstin = req.body?.gstin;

if (!gstin) {
  fs.appendFileSync('error_log.txt', 'Invalid or missing GSTIN in request.\n');
  return res.status(400).json({ success: false, message: 'GSTIN is required' });
}

  const requestid = crypto.randomBytes(8).toString('hex');

  try {
    if (!ACCESS_TOKEN) {
      throw new Error('Access token is missing');
    }

    const url = 'https://gsp.adaequare.com/enriched/commonapi/search';

    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACCESS_TOKEN}`
      },
      params: {
        action: 'TP',
        gstin: gstin
      },
      validateStatus: () => true
    });

    const data = response.data;

    if (response.status === 200 && data.success && data.result) {
      const result = data.result;
      const addr = result.pradr?.addr || {};

      // Print details to console like how browser form is filled
      console.log("Customer Registered Name:", result.lgnm || '');
      console.log("Business Name:", result.tradeNam || '');
      console.log("Additional Business Name:", result.tradeNam || '');
      console.log("Display Name:", result.lgnm || '');

      const addressLine1 = `${addr.bno || ''}${addr.bno && addr.flno ? ', ' : ''}${addr.flno || ''}`.trim();
      const addressLine2 = `${addr.st || ''}${addr.st && addr.bnm ? ', ' : ''}${addr.bnm || ''}${(addr.st || addr.bnm) && addr.loc ? ', ' : ''}${addr.loc || ''}`.trim();

      console.log("Address Line 1:", addressLine1);
      console.log("Address Line 2:", addressLine2);
      console.log("City (ctj):", result.ctj || '');
      console.log("Pincode:", addr.pncd || '');
      console.log("State Code:", addr.stcd || '');
      console.log("Country: India");

      fs.appendFileSync('error_log.txt', `Success: ${JSON.stringify(data)}\n`);
      return res.json(data);
    } else {
      const message = data.message || 'Unknown error';
      fs.appendFileSync('error_log.txt', `Error: ${message}\n`);
      return res.status(response.status).json({ success: false, message });
    }
  } catch (error) {
    fs.appendFileSync('error_log.txt', `Exception: ${error.message}\n`);
    return res.status(500).json({ success: false, message: error.message });
  }
});


module.exports = router;