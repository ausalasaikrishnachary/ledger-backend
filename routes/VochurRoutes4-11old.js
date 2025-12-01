const express = require('express');
const router = express.Router();
const db = require('../db');

// Get next sales invoice number
router.get("/next-invoice-number", async (req, res) => {
  try {
    const query = `
      SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 4) AS UNSIGNED)) as maxNumber 
      FROM voucher 
      WHERE TransactionType = 'Sales' 
      AND InvoiceNumber LIKE 'INV%'
    `;
    
    db.query(query, (err, results) => {
      if (err) {
        console.error('Error fetching next invoice number:', err);
        return res.status(500).send({ error: 'Failed to get next invoice number' });
      }
      
      let nextNumber = 1;
      if (results[0].maxNumber !== null && !isNaN(results[0].maxNumber)) {
        nextNumber = parseInt(results[0].maxNumber) + 1;
      }
      
      const nextInvoiceNumber = `INV${nextNumber.toString().padStart(3, '0')}`;
      
      res.send({ nextInvoiceNumber });
    });
  } catch (error) {
    console.error('Error in next-invoice-number:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
});

// Helper function for database queries with promise wrapper
const executeQuery = (connection, sql, params = []) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

// Enhanced processTransactionItem function with proper stock calculations
async function processTransactionItem(item, connection, voucherId, invoiceDate) {
  try {
    console.log(`\n🔄 Processing item: ${item.product}, Quantity: ${item.quantity}, Batch: ${item.batch}`);
    
    let productId = null;
    let batchId = null;
    let pricePerUnit = parseFloat(item.price) || 0;
    let stockOut = parseFloat(item.quantity) || 0;

    // Use the product_id sent from frontend
    if (item.product_id) {
      console.log(`✅ Using provided product_id: ${item.product_id}`);
      productId = item.product_id;
      
      // Verify the product exists with this ID
      const products = await executeQuery(
        connection,
        'SELECT id, goods_name, maintain_batch, balance_stock, stock_in, stock_out, opening_stock FROM products WHERE id = ?',
        [productId]
      );

      if (products.length === 0) {
        throw new Error(`Product with ID ${productId} not found`);
      }

      var product = products[0];
    } else {
      // Fallback: Find product by name
      console.log(`⚠️ No product_id provided, falling back to product name search: ${item.product}`);
      const products = await executeQuery(
        connection,
        'SELECT id, goods_name, maintain_batch, balance_stock, stock_in, stock_out, opening_stock FROM products WHERE goods_name = ?',
        [item.product]
      );

      if (products.length === 0) {
        throw new Error(`Product ${item.product} not found`);
      }

      product = products[0];
      productId = product.id;
    }
    
    console.log(`📦 Product resolved:`, {
      id: product.id,
      name: product.goods_name,
      maintain_batch: product.maintain_batch,
      current_balance: product.balance_stock
    });

    let batchQuantityUpdated = false;
    
    // If product maintains batches, use batch logic
    if (product.maintain_batch === 1) {
      console.log(`🔄 Product maintains batches, checking for batch: ${item.batch}`);
      
      if (!item.batch) {
        throw new Error(`Batch number is required for product ${item.product} that maintains batches`);
      }

      // Find the batch for this product using product_id
      const batches = await executeQuery(
        connection,
        'SELECT * FROM batches WHERE product_id = ? AND batch_number = ?',
        [productId, item.batch]
      );

      if (batches.length === 0) {
        const availableBatches = await executeQuery(
          connection,
          'SELECT batch_number, quantity FROM batches WHERE product_id = ?',
          [productId]
        );
        
        console.log(`❌ Batch ${item.batch} not found for product ${product.goods_name} (ID: ${productId})`);
        console.log(`📋 Available batches:`, availableBatches);
        
        throw new Error(`Batch ${item.batch} not found for product ${item.product}. Available batches: ${availableBatches.map(b => b.batch_number).join(', ')}`);
      }

      const batch = batches[0];
      batchId = batch.id;
      console.log(`✅ Batch found: ${batch.batch_number}, Current quantity: ${batch.quantity}`);

      // Check if enough stock exists in the batch
      if (parseFloat(batch.quantity) < parseFloat(item.quantity)) {
        throw new Error(`Insufficient stock in batch ${item.batch}. Available: ${batch.quantity}, Requested: ${item.quantity}`);
      }

      // Update batch quantity
      const newBatchQuantity = parseFloat(batch.quantity) - parseFloat(item.quantity);
      await executeQuery(
        connection,
        'UPDATE batches SET quantity = ?, updated_at = NOW() WHERE id = ?',
        [newBatchQuantity, batch.id]
      );

      console.log(`✅ Updated batch ${batch.batch_number} quantity from ${batch.quantity} to ${newBatchQuantity}`);
      batchQuantityUpdated = true;
      
    } else {
      // Product doesn't maintain batches - use regular stock logic
      console.log(`📦 Product doesn't maintain batches, using regular stock`);
      
      // Handle NULL values properly
      const currentBalance = parseFloat(product.balance_stock || 0);
      if (currentBalance < parseFloat(item.quantity)) {
        throw new Error(`Insufficient stock for ${item.product}. Available: ${currentBalance}, Requested: ${item.quantity}`);
      }
    }

    // Get updated product details for stock entry
    const productDetails = await executeQuery(
      connection,
      'SELECT balance_stock, stock_in, stock_out, opening_stock FROM products WHERE id = ?',
      [productId]
    );

    if (productDetails.length === 0) {
      throw new Error(`Product details not found for ID: ${productId}`);
    }

    const currentProduct = productDetails[0];
    
    // Handle NULL values in product record
    const openingStock = parseFloat(currentProduct.opening_stock || 0);
    const currentStockIn = parseFloat(currentProduct.stock_in || 0);
    const currentStockOut = parseFloat(currentProduct.stock_out || 0);
    const currentBalance = parseFloat(currentProduct.balance_stock || 0);
    
    console.log(`📊 Current product stock:`, {
      opening_stock: openingStock,
      stock_in: currentStockIn,
      stock_out: currentStockOut,
      balance_stock: currentBalance
    });

    // Calculate new values - FIXED CALCULATIONS
    const newStockOut = currentStockOut + stockOut;
    let newBalanceStock = 0;

    if (product.maintain_batch === 1) {
      // For batch-managed products: balance = opening_stock - stock_out
      newBalanceStock = openingStock - newStockOut;
    } else {
      // For non-batch products: balance = opening_stock + stock_in - stock_out
      newBalanceStock = openingStock + currentStockIn - newStockOut;
    }

    // Create stock entry for this transaction
    const stockEntry = {
      product_id: productId,
      price_per_unit: pricePerUnit,
      opening_stock: currentBalance,
      stock_in: 0,
      stock_out: stockOut,
      balance_stock: newBalanceStock,
      batch_number: item.batch || null,
      voucher_id: voucherId,
      date: invoiceDate
    };

    await executeQuery(
      connection,
      'INSERT INTO stock SET ?',
      [stockEntry]
    );

    console.log(`✅ Created stock entry for product ${item.product}:`, {
      product_id: productId,
      opening_stock: currentBalance,
      stock_out: stockOut,
      new_balance: newBalanceStock,
      batch: item.batch
    });

    // Update product totals with proper NULL handling
    await executeQuery(
      connection,
      `UPDATE products SET 
        stock_out = ?,
        balance_stock = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [newStockOut, newBalanceStock, productId]
    );

    console.log(`✅ Updated product totals for ${item.product}:`, {
      product_id: productId,
      stock_out: newStockOut,
      balance: newBalanceStock
    });

    // Return the processed item with updated info
    return {
      ...item,
      product_id: productId,
      batch_id: batchId,
      batch_number: item.batch,
      stock_entry_created: true,
      opening_stock: currentBalance,
      stock_out: stockOut,
      new_balance: newBalanceStock
    };

  } catch (error) {
    console.error(`❌ Error processing item ${item.product}:`, error);
    throw error;
  }
}

// Enhanced main transaction processing function
async function processTransaction(transactionData, transactionType, connection) {
  try {
    console.log(`\n🚀 Processing ${transactionType} transaction...`);
    
    // Get next voucher ID
    const voucherCount = await executeQuery(connection, 'SELECT MAX(VoucherID) as maxId FROM voucher');
    const nextVoucherId = (voucherCount[0].maxId || 0) + 1;
    console.log(`Next available VoucherID: ${nextVoucherId}`);

    let invoiceNumber = transactionData.invoiceNumber;
    
    // Generate invoice number if not provided
    if (!invoiceNumber) {
      if (transactionType === 'Sales') {
        const lastInvoice = await executeQuery(
          connection,
          "SELECT MAX(CAST(SUBSTRING(InvoiceNumber, 4) AS UNSIGNED)) as maxNum FROM voucher WHERE TransactionType = 'Sales' AND InvoiceNumber LIKE 'INV%'"
        );
        const nextNum = (lastInvoice[0].maxNum || 0) + 1;
        invoiceNumber = `INV${nextNum.toString().padStart(3, '0')}`;
      }
    }
    
    console.log(`Using ${transactionType} invoice number: ${invoiceNumber}`);

    // Process each item individually and update stock/batches
    console.log(`\n📋 Processing ${transactionData.items.length} items...`);
    const processedItems = [];
    
    for (let i = 0; i < transactionData.items.length; i++) {
      const item = transactionData.items[i];
      console.log(`\n📦 Processing ${transactionType} item ${i + 1}:`, {
        product: item.product,
        quantity: item.quantity,
        batch: item.batch
      });

      // Process the item (update stock/batches and create stock entry)
      const processedItem = await processTransactionItem(item, connection, nextVoucherId, transactionData.invoiceDate);
      processedItems.push(processedItem);
      
      console.log(`✅ Successfully processed item: ${item.product}`);
    }

    // Create enhanced batch details with all processed item information
    const enhancedBatchDetails = processedItems.map(item => ({
      product: item.product,
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      price: item.price,
      discount: item.discount,
      gst: item.gst,
      cgst: item.cgst,
      sgst: item.sgst,
      igst: item.igst,
      cess: item.cess,
      total: item.total,
      batch: item.batch,
      batch_id: item.batch_id,
      batch_number: item.batch_number,
      batchDetails: item.batchDetails,
      stock_entry_created: item.stock_entry_created
    }));

    console.log(`📦 Enhanced batch details created with ${enhancedBatchDetails.length} items`);

    // Insert voucher record with all item details in BatchDetails
    const voucherSql = `
      INSERT INTO voucher (
        VoucherID, TransactionType, VchNo, InvoiceNumber, Date, PaymentTerms, 
        PartyID, PartyName, BasicAmount, TaxAmount, Subtotal, TotalAmount,
        CGSTAmount, SGSTAmount, IGSTAmount, BatchDetails, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const voucherValues = [
      nextVoucherId,
      transactionType,
      transactionData.invoiceNumber || invoiceNumber,
      invoiceNumber,
      transactionData.invoiceDate,
      transactionData.validityDate || '',
      transactionData.selectedSupplierId || null,
      transactionData.supplierInfo?.businessName || transactionData.supplierInfo?.name || '',
      parseFloat(transactionData.taxableAmount) || 0,
      parseFloat(transactionData.totalGST) || 0,
      parseFloat(transactionData.taxableAmount) || 0,
      parseFloat(transactionData.grandTotal) || 0,
      parseFloat(transactionData.totalCGST) || 0,
      parseFloat(transactionData.totalSGST) || 0,
      parseFloat(transactionData.totalIGST) || 0,
      JSON.stringify(enhancedBatchDetails)
    ];

    console.log(`Inserting ${transactionType} voucher data with VoucherID: ${nextVoucherId} Invoice No: ${invoiceNumber}`);
    await executeQuery(connection, voucherSql, voucherValues);
    console.log(`✅ ${transactionType} Voucher created with ID: ${nextVoucherId}`);

    console.log(`\n🎉 ${transactionType} transaction completed successfully!`);
    return {
      voucherId: nextVoucherId,
      invoiceNumber: invoiceNumber,
      taxType: transactionData.taxType,
      totalCGST: transactionData.totalCGST,
      totalSGST: transactionData.totalSGST,
      totalIGST: transactionData.totalIGST,
      batchDetails: enhancedBatchDetails,
      stockEntries: processedItems.length
    };

  } catch (error) {
    console.error(`❌ Error in ${transactionType} transaction processing:`, error);
    throw error;
  }
}

// Create Sales Transaction and Update Stock
router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  console.log('\n💰 Received sales transaction data:', {
    invoiceNumber: transactionData.invoiceNumber,
    itemsCount: transactionData.items?.length,
    totalAmount: transactionData.grandTotal
  });
  
  db.getConnection((err, connection) => {
    if (err) {
      console.error('Database connection error:', err);
      return res.status(500).send({ error: 'Database connection failed' });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error('Transaction begin error:', err);
        return res.status(500).send({ error: 'Transaction failed to start' });
      }

      processTransaction(transactionData, 'Sales', connection)
        .then((result) => {
          connection.commit((err) => {
            if (err) {
              console.error('Commit error:', err);
              return connection.rollback(() => {
                connection.release();
                res.status(500).send({ error: 'Transaction commit failed', details: err.message });
              });
            }
            connection.release();
            console.log('✅ Sales transaction completed successfully');
            res.send({
              message: "Sales transaction completed successfully",
              voucherId: result.voucherId,
              invoiceNumber: result.invoiceNumber,
              stockUpdated: true,
              stockEntriesCreated: result.stockEntries,
              taxType: result.taxType,
              gstBreakdown: {
                cgst: result.totalCGST,
                sgst: result.totalSGST,
                igst: result.totalIGST
              },
              batchDetails: result.batchDetails
            });
          });
        })
        .catch((error) => {
          console.error('❌ Sales transaction error:', error);
          connection.rollback(() => {
            connection.release();
            
            if (error.code === 'ER_DUP_ENTRY') {
              res.status(500).send({ 
                error: 'Database error: Duplicate entry detected.',
                details: 'VoucherID primary key conflict',
                code: 'DUPLICATE_KEY_ERROR'
              });
            } else {
              res.status(500).send({ 
                error: 'Sales transaction failed', 
                details: error.message,
                code: error.code
              });
            }
          });
        });
    });
  });
});

// Get transaction with batch details
router.get("/transactions/:id", (req, res) => {
  const query = `
    SELECT 
      v.*, 
      JSON_UNQUOTE(BatchDetails) as batch_details,
      a.billing_address_line1,
      a.billing_address_line2,
      a.billing_city,
      a.billing_pin_code,
      a.billing_state,
      a.shipping_address_line1,
      a.shipping_address_line2,
      a.shipping_city,
      a.shipping_pin_code,
      a.shipping_state,
      a.gstin
    FROM voucher v
    LEFT JOIN accounts a ON v.PartyID = a.id
    WHERE v.VoucherID = ?
  `;
  
  db.query(query, [req.params.id], (err, results) => {
    if (err) {
      console.error('Error fetching transaction:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: err.message
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = results[0];
    
    // Parse batch details from JSON string
    try {
      if (transaction.batch_details) {
        if (typeof transaction.batch_details === 'string') {
          transaction.batch_details = JSON.parse(transaction.batch_details);
        }
      } else {
        transaction.batch_details = [];
      }
    } catch (error) {
      console.error('Error parsing batch details:', error);
      transaction.batch_details = [];
    }
    
    res.json({
      success: true,
      data: transaction
    });
  });
});

// Get all transactions with batch details
router.get("/transactions", (req, res) => {
  const query = "SELECT *, JSON_UNQUOTE(BatchDetails) as batch_details FROM voucher ORDER BY VoucherID DESC";
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching transactions:', err);
      return res.status(500).send(err);
    }
    
    // Parse batch details for each transaction
    results.forEach(transaction => {
      try {
        if (transaction.batch_details) {
          transaction.batch_details = JSON.parse(transaction.batch_details);
        } else {
          transaction.batch_details = [];
        }
      } catch (error) {
        console.error('Error parsing batch details for transaction:', transaction.VoucherID, error);
        transaction.batch_details = [];
      }
    });
    
    res.send(results);
  });
});

// Get last sales invoice number
router.get("/last-invoice", (req, res) => {
  const query = "SELECT VchNo FROM voucher WHERE TransactionType = 'Sales' ORDER BY VoucherID DESC LIMIT 1";
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching last invoice number:', err);
      return res.status(500).send(err);
    }
    
    if (results.length === 0) {
      return res.send({ lastInvoiceNumber: null });
    }
    
    res.send({ lastInvoiceNumber: results[0].VchNo });
  });
});


// Delete transaction
router.delete("/transactions/:id", (req, res) => {
  const voucherId = req.params.id;
  
  console.log(`🗑️ Deleting transaction with VoucherID: ${voucherId}`);
  
  const deleteQuery = 'DELETE FROM voucher WHERE VoucherID = ?';
  
  db.query(deleteQuery, [voucherId], (err, results) => {
    if (err) {
      console.error('Error deleting transaction:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete transaction',
        error: err.message
      });
    }
    
    if (results.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    console.log(`✅ Transaction ${voucherId} deleted successfully`);
    
    res.json({
      success: true,
      message: 'Transaction deleted successfully',
      deletedVoucherId: voucherId
    });
  });
});



router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  console.log("📦 COMPLETE REQUEST BODY:", JSON.stringify(transactionData, null, 2));
  console.log("Received transaction:", transactionData);

  const transactionType =
    transactionData.TransactionType ||
    transactionData.transactionType ||
    "Sales";

  console.log("Processing as:", transactionType);

  db.getConnection((err, connection) => {
    if (err) {
      console.error("DB Connection Error:", err);
      return res.status(500).send({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        console.error("Begin Transaction Error:", err);
        return res.status(500).send({ error: "Transaction failed" });
      }

      try {
        const result = await processTransaction(
          transactionData,
          transactionType,
          connection
        );

        const { voucherId, invoiceNumber, vchNo, batchDetails } = result;

        connection.commit((commitErr) => {
          if (commitErr) {
            console.error("Commit Error:", commitErr);

            return connection.rollback(() => {
              connection.release();
              res.status(500).send({
                error: "Transaction commit failed",
                details: commitErr.message,
              });
            });
          }

          connection.release();

          let message =
            transactionType === "CreditNote"
              ? "Credit Note created"
              : transactionType === "Purchase"
              ? "Purchase Transaction completed"
              : transactionType === "DebitNote"
              ? "Debit Note created"
              : "Sales Transaction completed";

          res.send({
            success: true,
            message,
            voucherId,
            invoiceNumber,
            vchNo,
            items: batchDetails,
          });
        });
      } catch (error) {
        console.error("Transaction Error:", error);

        connection.rollback(() => {
          connection.release();

          res.status(500).send({
            error: `${transactionType} transaction failed`,
            details: error.message,
          });
        });
      }
    });
  });
});

const processTransaction = async (transactionData, transactionType, connection) => {

  // STEP 1: NEXT VOUCHER ID
  const maxIdResult = await queryPromise(
    connection,
    "SELECT COALESCE(MAX(VoucherID),0)+1 AS nextId FROM voucher"
  );
  const nextVoucherId = maxIdResult[0].nextId;

  // STEP 2: EXTRACT ITEMS
  let items = [];

  if (Array.isArray(transactionData.items)) items = transactionData.items;
  else if (Array.isArray(transactionData.batch_details)) items = transactionData.batch_details;
  else if (Array.isArray(transactionData.batchDetails)) items = transactionData.batchDetails;
  else items = [];

  // Normalize
  items = items.map((i) => ({
    product: i.product || "",
    product_id: parseInt(i.product_id || i.productId) || null,
    batch: i.batch || i.batch_number || "DEFAULT",
    quantity: parseFloat(i.quantity) || 0,
    price: parseFloat(i.price) || 0,
    discount: parseFloat(i.discount) || 0,
    gst: parseFloat(i.gst) || 0,
    cgst: parseFloat(i.cgst) || 0,
    sgst: parseFloat(i.sgst) || 0,
    igst: parseFloat(i.igst) || 0,
    cess: parseFloat(i.cess) || 0,
    total: parseFloat(i.total) || (parseFloat(i.quantity) * parseFloat(i.price)),
  }));

  let voucherBatchNumber = null;
  
  if (items.length > 0 && items[0].batch) {
    voucherBatchNumber = items[0].batch;
    console.log(`✅ Using batch number for voucher table: ${voucherBatchNumber}`);
  }

  let invoiceNumber =
    transactionData.InvoiceNumber ||
    transactionData.invoiceNumber ||
    "INV001";

  let vchNo = invoiceNumber;

  if (transactionType === "CreditNote") {
    vchNo =
      transactionData.VchNo ||
      transactionData.vchNo ||
      transactionData.creditNoteNumber ||
      "CNOTE001";
  }

  if (transactionType === "DebitNote") {
    vchNo =
      transactionData.VchNo ||
      transactionData.vchNo ||
      transactionData.creditNoteNumber ||
      "DNOTE001";
  }

  if (transactionType === "Purchase") {
    vchNo =
      transactionData.InvoiceNumber ||
      transactionData.invoiceNumber ||
      "PINV001";
  }

  if (transactionType === "stock transfer") {
    vchNo =
      transactionData.InvoiceNumber ||
      transactionData.invoiceNumber ||
      "ST001";
  }

  // STEP 5: TOTALS
  const taxableAmount =
    parseFloat(transactionData.BasicAmount) ||
    items.reduce((sum, i) => sum + i.quantity * i.price, 0);

  const totalGST =
    parseFloat(transactionData.TaxAmount) ||
    items.reduce((sum, i) => sum + (i.quantity * i.price * (i.gst / 100)), 0);

  const grandTotal =
    parseFloat(transactionData.TotalAmount) ||
    taxableAmount + totalGST;

  // STEP 6: ACCOUNT / PARTY
  const supplier = transactionData.supplierInfo || {};
  const customer = transactionData.customerData || {};

  let partyID =
    supplier.party_id ||
    customer.party_id ||
    transactionData.PartyID ||
    null;

  let accountID =
    supplier.account_id ||
    customer.account_id ||
    transactionData.AccountID ||
    null;

  const partyName =
    supplier.name ||
    supplier.business_name ||
    customer.business_name ||
    customer.name ||
    transactionData.PartyName ||
    "";

  const accountName =
    supplier.business_name ||
    customer.business_name ||
    transactionData.AccountName ||
    "";


const voucherData = {
  VoucherID: nextVoucherId,
  TransactionType: transactionType,
  VchNo: vchNo,
  InvoiceNumber: invoiceNumber,
  Date: transactionData.Date || new Date().toISOString().split("T")[0],

  PaymentTerms: transactionData.PaymentTerms || "Immediate",
  Freight: parseFloat(transactionData.Freight) || 0,
  TotalPacks: items.length,

  TaxAmount: totalGST,
  Subtotal: taxableAmount,
  BillSundryAmount: parseFloat(transactionData.BillSundryAmount) || 0,
  TotalAmount: grandTotal,
  paid_amount: parseFloat(transactionData.paid_amount) || grandTotal,

  AccountID: accountID,
  AccountName: accountName,
  PartyID: partyID,
  PartyName: partyName,

  BasicAmount: taxableAmount,
  ValueOfGoods: taxableAmount,
  EntryDate: new Date(),

  SGSTPercentage: parseFloat(transactionData.SGSTPercentage) || 0,
  CGSTPercentage: parseFloat(transactionData.CGSTPercentage) || 0,
  IGSTPercentage: parseFloat(transactionData.IGSTPercentage) || (items[0]?.igst || 0),

  SGSTAmount: parseFloat(transactionData.SGSTAmount) || 0,
  CGSTAmount: parseFloat(transactionData.CGSTAmount) || 0,
  IGSTAmount: parseFloat(transactionData.IGSTAmount) || 0,

  TaxSystem: transactionData.TaxSystem || "GST",

  product_id: items[0]?.product_id || null,
  batch_id: voucherBatchNumber,
  DC: transactionType === "CreditNote" ? "C" : "D",

  ChequeNo: transactionData.ChequeNo || "",
  ChequeDate: transactionData.ChequeDate || null,
  BankName: transactionData.BankName || "",

 // 🔥 NEW: ADD STAFF FIELDS
staffid: transactionData.selectedStaffId || transactionData.staffid || null,
assigned_staff: transactionData.assigned_staff || null, 

  created_at: new Date(),
  balance_amount: parseFloat(transactionData.balance_amount) || 0,
  status: transactionData.status || "active",
  paid_date: transactionData.paid_date || null,

  pdf_data: transactionData.pdf_data || null,
  pdf_file_name: transactionData.pdf_file_name || null,
  pdf_created_at: transactionData.pdf_created_at || null
};

console.log("👤 STAFF DATA - staffid:", voucherData.staffid, "assigned_staff:", voucherData.assigned_staff);

  console.log("📦 Voucher Data being inserted - batch_id (batch number):", voucherBatchNumber);
  console.log("📦 Complete voucher data:", voucherData);

  await queryPromise(
    connection,
    "INSERT INTO voucher SET ?",
    [voucherData]
  );

  // STEP 8: INSERT ITEMS INTO voucherdetails
  const insertDetailQuery = `
    INSERT INTO voucherdetails (
      voucher_id, product, product_id, transaction_type, InvoiceNumber,
      batch, quantity, price, discount,
      gst, cgst, sgst, igst, cess, total, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  for (const i of items) {
    await queryPromise(connection, insertDetailQuery, [
      nextVoucherId,
      i.product,
      i.product_id,
      transactionType,
      invoiceNumber,
      i.batch,
      i.quantity,
      i.price,
      i.discount,
      i.gst,
      i.cgst,
      i.sgst,
      i.igst,
      i.cess,
      i.total
    ]);
  }

  // STEP 9: STOCK UPDATES - FIXED FOR STOCK TRANSFER
  for (const i of items) {
    if (transactionType === "Sales" || transactionType === "DebitNote" || transactionType === "stock transfer") {
      await queryPromise(
        connection,
        `
        UPDATE batches 
          SET quantity = quantity - ?, stock_out = stock_out + ?, updated_at = NOW()
        WHERE product_id = ? AND batch_number = ? AND quantity >= ?
      `,
        [i.quantity, i.quantity, i.product_id, i.batch, i.quantity]
      );
    }

    if (transactionType === "Purchase" || transactionType === "CreditNote") {
      await queryPromise(
        connection,
        `
        UPDATE batches 
          SET quantity = quantity + ?, stock_in = stock_in + ?, updated_at = NOW()
        WHERE product_id = ? AND batch_number = ?
      `,
        [i.quantity, i.quantity, i.product_id, i.batch]
      );
    }
  }

  return {
    voucherId: nextVoucherId,
    invoiceNumber,
    vchNo,
    batchDetails: items,
    grandTotal
  };
};
module.exports = router;