const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path'); // ✅ Add this
const fs = require('fs').promises;
const db = require('../db');

const router = express.Router();

// Helper function to promisify db queries
const queryAsync = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

// Middleware to check authentication
const authMiddleware = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    req.access_token = token;
    next();
};

// Generate IRN endpoint
router.post('/generate-irn', authMiddleware, async (req, res) => {
    try {
        const {
            username,
            password,
            invoiceId,
            branchId,
            sellerGstin
        } = req.body;

        const access_token = req.access_token;

        // Fetch invoice details
        const invoiceRows = await queryAsync(
            'SELECT * FROM invoice WHERE id = ?',
            [invoiceId]
        );

        if (invoiceRows.length === 0) {
            return res.status(404).json({ error: 'No invoice found' });
        }

        const invoice = invoiceRows[0];
        const invoice_code = invoice.invoice_code;
        const customer_id = invoice.customer_id;

        // Fetch branch details (Seller)
        const sellerRows = await queryAsync(
            'SELECT * FROM add_branch WHERE branch_id = ?',
            [branchId]
        );

        if (sellerRows.length === 0) {
            return res.status(404).json({ error: 'Seller branch not found' });
        }

        const seller = sellerRows[0];
        const SellerDtls = {
            Gstin: seller.GST,
            LglNm: seller.branch_name,
            TrdNm: seller.branch_name,
            Pos: '12',
            Addr1: seller.address_line1,
            Addr2: seller.address_line2,
            Loc: seller.city,
            Pin: seller.pincode,
            Stcd: seller.state_code,
            Ph: seller.phone_number,
            Em: seller.email
        };

        // Fetch product details
        const productRows = await queryAsync(
            'SELECT * FROM invoice_items WHERE invoice_id = ?',
            [invoiceId]
        );

        let ItemList = [];
        let AssVal = 0;
        let CgstVal = 0;
        let SgstVal = 0;
        let IgstVal = 0;
        let CesVal = 0;
        let StCesVal = 0;
        let Discount = 0;

        for (const product of productRows) {
            ItemList.push({
                SlNo: "43" + product.id,
                PrdDesc: product.product,
                IsServc: 'N',
                HsnCd: "1001",
                Barcde: "123456",
                Qty: parseFloat(product.qty),
                FreeQty: 0,
                Unit: 'PCS',
                UnitPrice: parseFloat(product.price),
                TotAmt: parseFloat(product.line_total).toFixed(2),
                Discount: parseFloat(product.discount),
                PreTaxVal: 0,
                AssAmt: (parseFloat(product.line_total) - parseFloat(product.discount)).toFixed(2),
                GstRt: parseFloat(product.gst),
                IgstAmt: parseFloat(product.igst),
                CgstAmt: 0,
                SgstAmt: 0,
                CesRt: parseFloat(product.cess_rate),
                CesAmt: parseFloat(product.cess_amount),
                CesNonAdvlAmt: 0,
                StateCesRt: 0,
                StateCesAmt: 0,
                StateCesNonAdvlAmt: 0,
                OthChrg: 0,
                TotItemVal: (parseFloat(product.cgst) + parseFloat(product.sgst) + 
                            parseFloat(product.igst) + parseFloat(product.line_total) - 
                            parseFloat(product.discount)).toFixed(2),
                OrgCntry: 'IN'
            });

            AssVal += parseFloat(product.line_total) - parseFloat(product.discount);
            CgstVal += parseFloat(product.cgst);
            SgstVal += parseFloat(product.sgst);
            IgstVal += parseFloat(product.igst);
            CesVal += parseFloat(product.cess_amount);
            StCesVal += parseFloat(product.cess_amount);
            Discount += parseFloat(product.discount);
        }

        // Fetch customer details
        const customerRows = await queryAsync(
            `SELECT c.*, a.* FROM customer_master c 
             JOIN address_master a ON a.customer_master_id = c.id  
             WHERE c.id = ?`,
            [customer_id]
        );

        if (customerRows.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        const buyer = customerRows[0];
        const BuyerDtls = {
            Gstin: buyer.gstin,
            LglNm: buyer.gst_reg_name,
            TrdNm: buyer.business_name,
            Pos: '12',
            Addr1: buyer.s_address_line1,
            Addr2: buyer.s_address_line2,
            Loc: buyer.s_city,
            Pin: buyer.s_Pincode,
            Stcd: buyer.state_code,
            Ph: buyer.mobile,
            Em: buyer.email
        };

        // Calculate totals
        const TotInvVal = (AssVal + CgstVal + SgstVal + IgstVal + CesVal + StCesVal + Discount + 0.3).toFixed(2);
        const TotInvValFc = (AssVal + CgstVal + SgstVal + IgstVal + CesVal + StCesVal + Discount - 10).toFixed(2);

        const ValDtls = {
            AssVal: parseFloat(AssVal).toFixed(2),
            CgstVal: parseFloat(CgstVal).toFixed(2),
            SgstVal: parseFloat(SgstVal).toFixed(2),
            IgstVal: parseFloat(IgstVal).toFixed(2),
            CesVal: parseFloat(CesVal).toFixed(2),
            StCesVal: parseFloat(StCesVal).toFixed(2),
            Discount: parseFloat(Discount).toFixed(2),
            OthChrg: 0,
            RndOffAmt: 0.3,
            TotInvVal: TotInvVal,
            TotInvValFc: TotInvValFc
        };

        const EwbDtls = {
            Transid: null,
            Transname: null,
            Distance: 0,
            Transdocno: null,
            TransdocDt: null,
            Vehno: 'KA123456',
            Vehtype: 'R',
            TransMode: '1'
        };

        // Prepare data for IRN Generation
        const data = {
            Version: '1.1',
            TranDtls: {
                TaxSch: 'GST',
                SupTyp: 'B2B',
                RegRev: 'N',
                EcmGstin: null,
                IgstOnIntra: 'N'
            },
            DocDtls: {
                Typ: 'INV',
                No: 'IRN' + crypto.randomBytes(16).toString('hex'),
                Dt: new Date().toLocaleDateString('en-GB')
            },
            SellerDtls,
            BuyerDtls,
            ItemList,
            ValDtls,
            EwbDtls
        };

        // Send IRN Generation Request
        const irnGenerationUrl = "https://gsp.adaequare.com/test/enriched/ei/api/invoice";
        
        const irnResponse = await axios.post(irnGenerationUrl, data, {
            headers: {
                'Content-Type': 'application/json',
                'user_name': username,
                'password': password,
                'gstin': sellerGstin,
                'requestid': crypto.randomBytes(16).toString('hex'),
                'Authorization': `Bearer ${access_token}`
            }
        });

        const irnResponseBody = irnResponse.data;

        if (irnResponseBody.result && irnResponseBody.result.Irn) {
            const IRN = irnResponseBody.result.Irn;
            
            // Generate QR code image
            const qrUrl = "https://gsp.adaequare.com/test/enriched/ei/others/qr/image";
            const qrResponse = await axios.post(qrUrl, irnResponseBody.result.SignedQRCode, {
                headers: {
                    'Content-Type': 'text/plain',
                    'user_name': username,
                    'password': password,
                    'gstin': sellerGstin,
                    'requestid': crypto.randomBytes(16).toString('hex'),
                    'Authorization': `Bearer ${access_token}`,
                    'width': '300',
                    'height': '300',
                    'imgtype': 'jpg'
                },
                responseType: 'arraybuffer'
            });

            // Create invoices directory if it doesn't exist
            const invoicesDir = path.join(__dirname, '..', 'invoices');
            await fs.mkdir(invoicesDir, { recursive: true });
            const filePath = `invoices/${invoice_code}.jpg`;
            const fullFilePath = path.join(__dirname, '..', filePath);
            await fs.writeFile(fullFilePath, qrResponse.data);

            // Update database
            const updateSql = `UPDATE invoice SET 
                IRNgenerated_status = 'Yes',
                qr_image = ?,
                ack_no = ?,
                ack_date = ?,
                irn_no = ?,
                signed_qr_code = ?,
                signed_invoice = ?,
                e_way_bill_no = ?,
                e_way_bill_date = ?,
                e_way_bill_valid_till = ?
                WHERE id = ?`;

            await queryAsync(updateSql, [
                filePath,
                irnResponseBody.result.AckNo,
                irnResponseBody.result.AckDt,
                IRN,
                irnResponseBody.result.SignedQRCode,
                irnResponseBody.result.SignedInvoice,
                irnResponseBody.result.EwbNo || null,
                irnResponseBody.result.EwbDt || null,
                irnResponseBody.result.EwbValidTill || null,
                invoiceId
            ]);

            // Fetch updated record
            const updatedRows = await queryAsync(
                'SELECT * FROM invoice WHERE id = ?',
                [invoiceId]
            );

            res.json({
                success: true,
                message: 'IRN created successfully',
                data: updatedRows[0]
            });
        } else {
            res.status(400).json({ 
                error: 'Error generating IRN', 
                message: irnResponseBody.message || 'Unknown error'
            });
        }
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'API Error', 
            message: error.response?.data || error.message 
        });
    }
});

// Get invoice details endpoint
router.get('/invoice/:id', async (req, res) => {
    try {
        const rows = await queryAsync(
            'SELECT * FROM invoice WHERE id = ?',
            [req.params.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get branches for dropdown
router.get('/branches', async (req, res) => {
    try {
        const rows = await queryAsync('SELECT branch_id, branch_name, GST FROM add_branch', []);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get customers for dropdown
router.get('/customers', async (req, res) => {
    try {
        const rows = await queryAsync(
            'SELECT c.id, c.business_name, c.gstin FROM customer_master c', 
            []
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;