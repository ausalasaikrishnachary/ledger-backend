const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path'); // ✅ Add this
const router = express.Router();
const fs = require('fs');
const db = require('../db');
const { getValidToken } = require('../gspAuth');
require('dotenv').config();

const USER_NAME = process.env.GSP_USERNAME;
const PASSWORD = process.env.GSP_PASSWORD;
// const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const GSP_URL = process.env.GSP_URL;

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


router.post("/generate-irn", async (req, res) => {
  try {
    const { payload } = req.body;
const accessToken = await getAccessToken();

    const response = await axios.post(
      `${GSP_URL}/enriched/ei/api/invoice`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "user_name": USER_NAME,
          "password": PASSWORD,
          "gstin": payload?.SellerDtls?.Gstin || "02AMBPG7773M002",
          "requestid": `req_${Date.now()}`,
          "Authorization": `Bearer ${accessToken}`
        }
      }
    );

    console.log("IRN Success:", response.data);

    res.status(200).json(response.data);

  } catch (error) {
    console.error(
      "IRN Error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to generate IRN",
      error: error.response?.data || null
    });
  }
});

// router.post('/generate-qr-image', async (req, res) => {
//   try {
//     const {
//       signedQrCode,
//       gstin,
//       invoiceCode
//     } = req.body;

//     if (!signedQrCode) {
//       return res.status(400).json({
//         success: false,
//         message: 'signedQrCode is required'
//       });
//     }
// const accessToken = await getAccessToken();
//     const response = await axios.post(
//       `${GSP_URL}/enriched/ei/others/qr/image`,
//       signedQrCode,
//       {
//         responseType: 'arraybuffer',
//         headers: {
//           'Content-Type': 'text/plain',
//           'user_name': USER_NAME,
//           'password': PASSWORD,
//           'gstin': gstin,
//           'requestid': `req_${Date.now()}`,
//           'Authorization': `Bearer ${accessToken}`,
//           'width': '300',
//           'height': '300',
//           'imgtype': 'jpg'
//         }
//       }
//     );

// const invoiceDir = path.join(__dirname, '../invoice');

// if (!fs.existsSync(invoiceDir)) {
//   fs.mkdirSync(invoiceDir, { recursive: true });
// }

// const fileName = `${invoiceCode}.jpg`;
// const filePath = path.join(invoiceDir, fileName);

// fs.writeFileSync(filePath, response.data);

// res.status(200).json({
//   success: true,
//   message: 'QR image generated successfully',
//   fileName,
//   filePath,
//   imageUrl: `http://localhost:5000/invoice/${fileName}`
// });

//   } catch (error) {
//     console.error(
//       'QR Image Error:',
//       error.response?.data || error.message
//     );

//     res.status(error.response?.status || 500).json({
//       success: false,
//       message:
//         error.response?.data?.message ||
//         error.message ||
//         'Failed to generate QR image'
//     });
//   }
// });

router.post('/generate-qr-image', async (req, res) => {
  try {
    const { signedQrCode, gstin, invoiceCode } = req.body;

    console.log("=== QR REQUEST ===");
    console.log("GSTIN:", gstin);
    console.log("Invoice Code:", invoiceCode);
    console.log("Signed QR Exists:", !!signedQrCode);

    if (!signedQrCode) {
      return res.status(400).json({
        success: false,
        message: 'signedQrCode is required'
      });
    }
const accessToken = await getAccessToken();
    const qrResponse = await axios.post(
      `${GSP_URL}/enriched/ei/others/qr/image`,
      signedQrCode,
      {
        responseType: 'arraybuffer',
        headers: {
          'Content-Type': 'text/plain',
          user_name: USER_NAME,
          password: PASSWORD,
          gstin: gstin,
          requestid: `req_${Date.now()}`,
          Authorization: `Bearer ${accessToken}`,
          width: '300',
          height: '300',
          imgtype: 'jpg'
        }
      }
    );

    // Always save inside project root invoice folder
    const invoiceDir = path.resolve(process.cwd(), 'invoice');

    console.log("Invoice Directory:", invoiceDir);

    if (!fs.existsSync(invoiceDir)) {
      fs.mkdirSync(invoiceDir, { recursive: true });
    }

    const safeInvoiceCode =
      String(invoiceCode || `QR_${Date.now()}`)
        .replace(/[<>:"/\\|?*]/g, "_");

    const fileName = `${safeInvoiceCode}.jpg`;
    const filePath = path.join(invoiceDir, fileName);

    fs.writeFileSync(filePath, qrResponse.data);

    console.log("QR Saved:", filePath);
    console.log("Exists:", fs.existsSync(filePath));

    return res.status(200).json({
      success: true,
      message: 'QR image generated successfully',
      fileName,
      filePath,
      imageUrl: `${req.protocol}://${req.get('host')}/invoice/${fileName}`
    });

  } catch (error) {

    console.error("=== QR IMAGE ERROR ===");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    }

    console.error("Message:", error.message);
    console.error("Stack:", error.stack);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.get("/test-image", (req, res) => {
  const filePath = path.join(
    process.cwd(),
    "invoice",
    "SSA_000010_26-27.jpg"
  );

  res.json({
    exists: fs.existsSync(filePath),
    filePath
  });
});

// Update invoice with IRN details
router.put('/update-invoice-irn', async (req, res) => {
  try {
    const {
      invoiceNumber,
      branch_code,
      ack_no,
      ack_date,
      irn_no,
      signed_qr_code,
      signed_invoice,
      qr_image,
      e_way_bill_no,
      e_way_bill_date,
      e_way_bill_valid_till,
      IRNgenerated_status
    } = req.body;

    // Validate required fields
    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number is required'
      });
    }

    // Check if invoice exists
    const checkQuery = 'SELECT VoucherID FROM voucher WHERE InvoiceNumber = ?';
    db.query(checkQuery, [invoiceNumber], (err, results) => {
      if (err) {
        console.error('Error checking invoice:', err);
        return res.status(500).json({
          success: false,
          message: 'Database error while checking invoice'
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Invoice ${invoiceNumber} not found`
        });
      }

      // Build update query dynamically
      let updateFields = [];
      let updateValues = [];

      // Only add fields that are provided and not null/undefined
      const fieldsToUpdate = {
        branch_code,
        ack_no,
        ack_date,
        irn_no,
        signed_qr_code,
        signed_invoice,
        qr_image,
        e_way_bill_no,
        e_way_bill_date,
        e_way_bill_valid_till,
        IRNgenerated_status
      };

      Object.entries(fieldsToUpdate).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          updateFields.push(`${key} = ?`);
          updateValues.push(value);
        }
      });

      // If no fields to update, return error
      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      // Add invoice number to values array for WHERE clause
      updateValues.push(invoiceNumber);

      const updateQuery = `
        UPDATE voucher 
        SET ${updateFields.join(', ')} 
        WHERE InvoiceNumber = ?
      `;

      console.log('Update Query:', updateQuery);
      console.log('Update Values:', updateValues);

      db.query(updateQuery, updateValues, (err, result) => {
        if (err) {
          console.error('Error updating invoice:', err);
          return res.status(500).json({
            success: false,
            message: 'Database error while updating invoice'
          });
        }

        // Fetch the updated record
        const selectQuery = 'SELECT * FROM voucher WHERE InvoiceNumber = ?';
        db.query(selectQuery, [invoiceNumber], (err, updatedResults) => {
          if (err) {
            console.error('Error fetching updated invoice:', err);
            return res.status(500).json({
              success: false,
              message: 'Invoice updated but failed to fetch updated data'
            });
          }

          res.status(200).json({
            success: true,
            message: 'Invoice IRN details updated successfully',
            data: updatedResults[0]
          });
        });
      });
    });

  } catch (error) {
    console.error('Error updating invoice IRN:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

// CANCEL E-INVOICE API
router.post("/cancel-irn", async (req, res) => {
  try {
    const { irn, cnlrsn, cnlrem } = req.body;

    // Validate required fields
    if (!irn) {
      return res.status(400).json({
        success: false,
        message: "IRN is required for cancellation"
      });
    }

    const payload = {
      Irn: irn,
      Cnlrsn: cnlrsn || "1",
      Cnlrem: cnlrem || "Cancelled by user"
    };
const accessToken = await getAccessToken();
    const response = await axios.post(
      `${GSP_URL}/enriched/ei/api/invoice/cancel`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "user_name": USER_NAME,
          "password": PASSWORD,
          "gstin": req.body.gstin || "02AMBPG7773M002",
          "requestid": `req_${Date.now()}`,
          "Authorization": `Bearer ${accessToken}`
        }
      }
    );

    console.log("IRN Cancellation Success:", response.data);

    res.status(200).json({
      success: true,
      data: response.data,
      message: "E-Invoice cancelled successfully"
    });

  } catch (error) {
    console.error(
      "IRN Cancellation Error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to cancel e-invoice",
      error: error.response?.data || null
    });
  }
});

// Get invoice IRN status
router.get('/invoice-irn-status/:invoiceNumber', async (req, res) => {
  try {
    // Decode the invoice number from URL
    const invoiceNumber = decodeURIComponent(req.params.invoiceNumber);

    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number is required'
      });
    }

    console.log('Fetching IRN status for invoice:', invoiceNumber);

    const query = `
      SELECT 
        VoucherID,
        InvoiceNumber,
        irn_no,
        IRNgenerated_status,
        ack_no,
        ack_date,
        signed_qr_code,
        qr_image,
        e_way_bill_no,
        e_way_bill_date,
        e_way_bill_valid_till
      FROM voucher 
      WHERE InvoiceNumber = ?
    `;

    db.query(query, [invoiceNumber], (err, results) => {
      if (err) {
        console.error('Error fetching IRN status:', err);
        return res.status(500).json({
          success: false,
          message: 'Database error: ' + err.message
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Invoice ${invoiceNumber} not found`
        });
      }

      res.status(200).json({
        success: true,
        data: results[0]
      });
    });

  } catch (error) {
    console.error('Error fetching IRN status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});


router.post('/generate-ewaybill', async (req, res) => {
  try {
    console.log("Request Bodys:", req.body);

    const {
      invoiceId,
      irn_no,
      transId,
      transName,
      transDocNo,
      vehicleNo,
      vehicleType,
      distance,
      transMode
    } = req.body;

    // Current Date in DD/MM/YYYY format
    const currentDate = new Date().toLocaleDateString('en-GB');

    // Request payload
    const payload = {
      Irn: irn_no,
      Distance: distance,
      TransMode: transMode,
      TransId: transId,
      TransName: transName,
      TransDocDt: currentDate,
      TransDocNo: transDocNo,
      VehNo: vehicleNo,
      VehType: vehicleType
    };

const accessToken = await getAccessToken();
    // Headers
    const headers = {
      'Content-Type': 'application/json',
      'user_name': USER_NAME,
      'password': PASSWORD,
      'gstin': req.body.gstin || "02AMBPG7773M002",
      'requestid': crypto.randomUUID(),
      'Authorization': `Bearer ${accessToken}`
    };


    const response = await axios.post(
      `${GSP_URL}/enriched/ei/api/ewaybill`,
      payload,
      { headers }
    );

    console.log(
      "GSP Response:",
      JSON.stringify(response.data, null, 2)
    );

    // Check success
    if (!response.data.success) {
      return res.status(400).json(response.data);
    }

    const result = response.data.result;

    // Update Invoice Table
    const sql = `
            UPDATE voucher
            SET
                e_way_bill_no = ?,
                e_way_bill_date = ?,
                e_way_bill_valid_till = ?,
                e_way_bill_status = 'Generated'
            WHERE InvoiceNumber = ?
        `;

    db.query(
      sql,
      [
        result.EwbNo,
        result.EwbDt,
        result.EwbValidTill,
        invoiceId
      ],
      (err, dbResult) => {
        if (err) {
          console.error("DB Update Error:", err);
          return res.status(500).json({
            success: false,
            message: "Database update failed",
            error: err.message
          });
        }

        console.log("DB Update Result:", dbResult);

        if (dbResult.affectedRows === 0) {
          return res.status(404).json({
            success: false,
            message: `No invoice found with InvoiceNumber: ${invoiceId}`
          });
        }

        return res.status(200).json({
          success: true,
          message: "E-Way Bill generated successfully",
          ewaybill: result
        });
      }
    );

  } catch (error) {
    console.error(
      "E-Way Bill Error:",
      JSON.stringify(error.response?.data, null, 2)
    );

    return res.status(
      error.response?.status || 500
    ).json({
      success: false,
      message: error.response?.data?.error_description ||
        error.response?.data?.message ||
        error.message
    });
  }
});

router.post('/cancel-ewaybill', async (req, res) => {
  try {

    const accessToken = await getAccessToken();

    const {
      invoiceId,
      ewbNo,
      cancelRsnCode = "4",
      cancelRmrk = "Other"
    } = req.body;

    const payload = {
      ewbNo: Number(ewbNo),
      cancelRsnCode: 4,
      cancelRmrk: "Other"
    };

    console.log("Cancel EWB Payload:", payload);

    // const headers = {
    //   'Content-Type': 'application/json',
    //   // 'user_name': USER_NAME, // use for production
    //   'username': USER_NAME, // use for test environment
    //   'password': PASSWORD,
    //   'gstin': req.body.gstin || "02AMBPG7773M002",
    //   'requestid': crypto.randomUUID(),
    //   'Authorization': `Bearer ${accessToken}`,
    //   'ctype': 'IRN' // use ctype only in test environment, remove in production
    // };

    // const response = await axios.post(
    //   `${GSP_URL}/enriched/ewb/ewayapi?action=CANEWB`,
    //   payload,
    //   { headers }
    // );

    const isTestEnv = GSP_URL.includes('/test');

// Headers
const headers = {
  'Content-Type': 'application/json',
  ...(isTestEnv
    ? { username: USER_NAME }      // Test Environment
    : { user_name: USER_NAME }),   // Live Environment

  'password': PASSWORD,
  'gstin': req.body.gstin || "02AMBPG7773M002",
  'requestid': crypto.randomUUID(),
  'Authorization': `Bearer ${accessToken}`,

  // Add ctype only for test environment
  ...(isTestEnv && { ctype: 'IRN' })
};

// API URL
const apiUrl = isTestEnv
  ? `${GSP_URL}/enriched/ewb/ewayapi?action=CANEWB`
  : `${GSP_URL}/enriched/ei/api/ewayapi`;

const response = await axios.post(
  apiUrl,
  payload,
  { headers }
);

    

    console.log(
      "Cancel EWB Response:",
      JSON.stringify(response.data, null, 2)
    );

    if (!response.data.success) {
      return res.status(400).json(response.data);
    }

    db.query(
      `UPDATE voucher
       SET e_way_bill_status = 'Cancelled'
       WHERE InvoiceNumber = ?`,
      [invoiceId],
      (err) => {

        if (err) {
          return res.status(500).json({
            success: false,
            message: "Database update failed"
          });
        }

        return res.status(200).json({
          success: true,
          message: "E-Way Bill cancelled successfully"
        });

      }
    );

  } catch (error) {

    console.error(
      "Cancel EWB Error:",
      JSON.stringify(error.response?.data, null, 2)
    );

    return res.status(
      error.response?.status || 500
    ).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message
    });
  }
});

module.exports = router;