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


router.put("/transactions/:id", async (req, res) => {
  const voucherId = req.params.id;
  const updateData = req.body;

  console.log("👤 UPDATE - Staff Data Received:", {
    staffid: updateData.selectedStaffId,
    assigned_staff: updateData.assigned_staff
  });

  db.getConnection((err, connection) => {
    if (err) return res.status(500).send({ error: "Database connection failed" });

    connection.beginTransaction(async (err) => {
      if (err)
        return res.status(500).send({ error: "Transaction failed to start" });

      try {
        // 1️⃣ FETCH ORIGINAL VOUCHER
        const originalVoucher = await queryPromise(
          connection,
          "SELECT * FROM voucher WHERE VoucherID = ?",
          [voucherId]
        );

        if (originalVoucher.length === 0)
          throw new Error("Transaction not found");

        const originalTransactionType =
          originalVoucher[0].TransactionType || "Sales";

        console.log("🔎 Original transaction:", originalTransactionType);

        // Fetch batch details from voucherdetails table
        let originalBatchDetails = [];
        try {
          const voucherDetails = await queryPromise(
            connection,
            "SELECT * FROM voucherdetails WHERE voucher_id = ?",
            [voucherId]
          );
          originalBatchDetails = voucherDetails.map(detail => ({
            product: detail.product,
            product_id: detail.product_id,
            batch: detail.batch,
            quantity: detail.quantity,
            price: detail.price,
            discount: detail.discount,
            gst: detail.gst,
            cgst: detail.cgst,
            sgst: detail.sgst,
            igst: detail.igst,
            cess: detail.cess,
            total: detail.total
          }));
        } catch {
          originalBatchDetails = [];
        }

        // -------------------------------------------------------------------
        // 2️⃣ REVERSE OLD STOCK (UNDO original stock effect) - FIXED
        // -------------------------------------------------------------------

        for (const item of originalBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          console.log("♻️ Reversing:", originalTransactionType, item);

          // First, check current batch stock
          const batchCheck = await queryPromise(
            connection,
            "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          if (batchCheck.length === 0) {
            console.warn(`⚠️ Batch ${item.batch} not found during reversal - creating it`);
            
            // Create the batch if it doesn't exist
            await queryPromise(
              connection,
              `INSERT INTO batches 
               (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
               VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
              [item.product_id, item.batch]
            );
            console.log(`✔ Created missing batch: ${item.batch}`);
          }

          // Re-fetch batch data after potential creation
          const updatedBatchCheck = await queryPromise(
            connection,
            "SELECT quantity, stock_out, stock_in FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          const currentQuantity = parseFloat(updatedBatchCheck[0].quantity);
          const currentStockOut = parseFloat(updatedBatchCheck[0].stock_out);
          const currentStockIn = parseFloat(updatedBatchCheck[0].stock_in);
          const itemQuantity = parseFloat(item.quantity);

          if (originalTransactionType === "Purchase" || originalTransactionType === "CreditNote") {
            // For Purchase and CreditNote reversal, use safe subtraction
            if (currentQuantity < itemQuantity) {
              console.warn(`⚠️ Insufficient stock for reversal in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}. Adjusting...`);
              
              // Instead of throwing error, set to 0 if insufficient
              const finalQuantity = Math.max(0, currentQuantity - itemQuantity);
              const finalStockIn = Math.max(0, currentStockIn - itemQuantity);
              
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = ?, stock_in = ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [finalQuantity, finalStockIn, item.product_id, item.batch]
              );
            } else {
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = quantity - ?, stock_in = stock_in - ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [itemQuantity, itemQuantity, item.product_id, item.batch]
              );
            }

            console.log(`✔ Reversed ${originalTransactionType} for batch ${item.batch}`);

          } else {
            // SALES reversal → return stock (use safe subtraction for stock_out)
            if (currentStockOut < itemQuantity) {
              console.warn(`⚠️ stock_out less than reversal quantity in batch ${item.batch}. Current: ${currentStockOut}, Required: ${item.quantity}. Adjusting...`);
              
              // Set stock_out to 0 if insufficient, but always add to quantity
              const finalStockOut = Math.max(0, currentStockOut - itemQuantity);
              
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = quantity + ?, stock_out = ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [itemQuantity, finalStockOut, item.product_id, item.batch]
              );
            } else {
              await queryPromise(
                connection,
                "UPDATE batches SET quantity = quantity + ?, stock_out = stock_out - ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
                [itemQuantity, itemQuantity, item.product_id, item.batch]
              );
            }

            console.log(`✔ Reversed SALES for batch ${item.batch}`);
          }
        }

        // -------------------------------------------------------------------
        // DELETE EXISTING VOUCHER DETAILS
        // -------------------------------------------------------------------
        await queryPromise(
          connection,
          "DELETE FROM voucherdetails WHERE voucher_id = ?",
          [voucherId]
        );

        // -------------------------------------------------------------------
        // 3️⃣ UPDATE voucher main table (INCLUDING STAFF FIELDS)
        // -------------------------------------------------------------------
        let newBatchDetails = [];
        if (updateData.batchDetails) {
          newBatchDetails = Array.isArray(updateData.batchDetails)
            ? updateData.batchDetails
            : JSON.parse(updateData.batchDetails || "[]");
        }

        let vchNo = updateData.invoiceNumber || originalVoucher[0].VchNo;
        let invoiceNumber =
          updateData.invoiceNumber || originalVoucher[0].InvoiceNumber;

        // 🔥 UPDATED: Include staff fields in the UPDATE query
        await queryPromise(
          connection,
          `UPDATE voucher 
           SET VchNo = ?, InvoiceNumber = ?, Date = ?, PartyName = ?, 
               BasicAmount = ?, TaxAmount = ?, TotalAmount = ?,
               staffid = ?, assigned_staff = ?  -- 🔥 NEW STAFF FIELDS
           WHERE VoucherID = ?`,
          [
            vchNo,
            invoiceNumber,
            updateData.invoiceDate || originalVoucher[0].Date,
            updateData.supplierInfo?.name || originalVoucher[0].PartyName,
            parseFloat(updateData.taxableAmount) ||
            parseFloat(originalVoucher[0].BasicAmount),
            parseFloat(updateData.totalGST) ||
            parseFloat(originalVoucher[0].TaxAmount),
            parseFloat(updateData.grandTotal) ||
            parseFloat(originalVoucher[0].TotalAmount),
            // 🔥 NEW: Staff data
            updateData.selectedStaffId || updateData.staffid || originalVoucher[0].staffid,
            updateData.assigned_staff || originalVoucher[0].assigned_staff,
            voucherId,
          ]
        );

        console.log("✅ Staff data updated in voucher:", {
          staffid: updateData.selectedStaffId || updateData.staffid,
          assigned_staff: updateData.assigned_staff
        });

        // -------------------------------------------------------------------
        // INSERT NEW voucherDetails
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          await queryPromise(
            connection,
            `INSERT INTO voucherdetails 
              (voucher_id, product, product_id, InvoiceNumber, batch, quantity, price, discount, gst, cgst, sgst, igst, cess, total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              voucherId,
              item.product || "",
              item.product_id || "",
              invoiceNumber,
              item.batch || "",
              parseFloat(item.quantity) || 0,
              parseFloat(item.price) || 0,
              parseFloat(item.discount) || 0,
              parseFloat(item.gst) || 0,
              parseFloat(item.cgst) || 0,
              parseFloat(item.sgst) || 0,
              parseFloat(item.igst) || 0,
              parseFloat(item.cess) || 0,
              parseFloat(item.total) || 0,
            ]
          );
        }

        // -------------------------------------------------------------------
        // 4️⃣ APPLY **NEW** STOCK CHANGES (WITH BATCH CREATION IF NEEDED)
        // -------------------------------------------------------------------
        for (const item of newBatchDetails) {
          if (!item.batch || !item.product_id) continue;

          const itemQuantity = parseFloat(item.quantity);

          // Check if batch exists before applying changes
          const batchExists = await queryPromise(
            connection,
            "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          // If batch doesn't exist, create it first
          if (batchExists.length === 0) {
            console.log(`➕ Creating new batch: ${item.batch} for product ${item.product_id}`);
            
            await queryPromise(
              connection,
              `INSERT INTO batches 
               (product_id, batch_number, quantity, stock_in, stock_out, created_at, updated_at) 
               VALUES (?, ?, 0, 0, 0, NOW(), NOW())`,
              [item.product_id, item.batch]
            );
            console.log(`✔ Created new batch: ${item.batch}`);
          }

          const currentBatch = await queryPromise(
            connection,
            "SELECT quantity, stock_in, stock_out FROM batches WHERE product_id = ? AND batch_number = ?",
            [item.product_id, item.batch]
          );

          const currentQuantity = parseFloat(currentBatch[0].quantity);

          if (originalTransactionType === "Purchase" || originalTransactionType === "CreditNote") {
            // PURCHASE/CREDIT NOTE → Add stock
            await queryPromise(
              connection,
              "UPDATE batches SET quantity = quantity + ?, stock_in = stock_in + ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
              [itemQuantity, itemQuantity, item.product_id, item.batch]
            );

            console.log(`✔ ${originalTransactionType} applied batch ${item.batch}`);

          } else {
            // SALES → Reduce stock (with quantity check)
            if (currentQuantity < itemQuantity) {
              throw new Error(
                `Insufficient quantity for SALES update in batch ${item.batch}. Available: ${currentQuantity}, Required: ${item.quantity}`
              );
            }

            await queryPromise(
              connection,
              "UPDATE batches SET quantity = quantity - ?, stock_out = stock_out + ?, updated_at = NOW() WHERE product_id = ? AND batch_number = ?",
              [itemQuantity, itemQuantity, item.product_id, item.batch]
            );

            console.log(`✔ SALES applied batch ${item.batch}`);
          }
        }

        // -------------------------------------------------------------------
        // COMMIT TRANSACTION
        // -------------------------------------------------------------------
        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).send({ error: commitErr.message });
            });
          }

          connection.release();
          res.json({
            success: true,
            message: "Transaction updated successfully",
            voucherId,
            staffid: updateData.selectedStaffId || updateData.staffid,
            assigned_staff: updateData.assigned_staff
          });
        });
      } catch (err) {
        console.error("❌ Error:", err);

        connection.rollback(() => {
          connection.release();
          res.status(500).json({ success: false, message: err.message });
        });
      }
    });
  });
});



router.post("/transaction", (req, res) => {
  const transactionData = req.body;
  

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

  // STEP 2: Get order_mode from transactionData
  const orderMode = (transactionData.order_mode || transactionData.orderMode || "Pakka").toUpperCase();
  const isKacha = orderMode === "KACHA";
  
  console.log(`📊 Order Mode from request: ${orderMode}, Is Kacha: ${isKacha}`);

  // STEP 3: GET STAFF INCENTIVE FROM TRANSACTION DATA
  const staffIncentive = parseFloat(transactionData.staff_incentive) || 
                        parseFloat(transactionData.originalOrder?.staff_incentive) || 
                        0;
  
  console.log(`💰 Staff Incentive from request: ${staffIncentive}`);

  // STEP 4: EXTRACT ITEMS
  let items = [];

  if (Array.isArray(transactionData.items)) items = transactionData.items;
  else if (Array.isArray(transactionData.batch_details)) items = transactionData.batch_details;
  else if (Array.isArray(transactionData.batchDetails)) items = transactionData.batchDetails;
  else items = [];

  items = items.map((i) => {
    const itemStaffIncentive = parseFloat(i.staff_incentive) || 0;
    
    if (isKacha) {
      console.log(`🔄 Converting item ${i.product} to KACHA mode - removing GST`);
      return {
        product: i.product || "",
        product_id: parseInt(i.product_id || i.productId) || null,
        batch: i.batch || i.batch_number || "DEFAULT",
        quantity: parseFloat(i.quantity) || 0,
        price: parseFloat(i.price) || 0,
        discount: parseFloat(i.discount) || 0,
        gst: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        total: parseFloat(i.total) || (parseFloat(i.quantity) * parseFloat(i.price)),
        mfg_date: i.mfg_date || null,
        staff_incentive: itemStaffIncentive
      };
    } else {
      return {
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
        mfg_date: i.mfg_date || null,
        staff_incentive: itemStaffIncentive
      };
    }
  });

  // Check if this is from an order (has order_number)
  const orderNumber = transactionData.orderNumber || transactionData.order_number || null;
  console.log("🛒 Order Number from request:", orderNumber);

  // Check if we have item selection data
  const selectedItemIds = transactionData.selectedItemIds || transactionData.selected_item_ids || [];
  const hasItemSelection = selectedItemIds && selectedItemIds.length > 0;
  
  console.log("📋 Has item selection:", hasItemSelection ? `Yes (${selectedItemIds.length} items)` : "No");

  if (orderNumber) {
    console.log("✅ This is an order conversion. Updating order items and order status...");
    
    const invoiceNumber = transactionData.InvoiceNumber || transactionData.invoiceNumber || `INV${Date.now()}`;
    const invoiceDate = transactionData.Date || new Date().toISOString().split('T')[0];
    
    try {
      // Step 1: Update order_items table
      if (hasItemSelection && selectedItemIds.length > 0) {
        const placeholders = selectedItemIds.map(() => '?').join(',');
        const updateParams = [invoiceNumber, invoiceDate, orderNumber, ...selectedItemIds];
        
        await queryPromise(
          connection,
          `
          UPDATE order_items SET 
            invoice_number = ?, 
            invoice_date = ?, 
            invoice_status = 1, 
            updated_at = NOW()
          WHERE order_number = ? 
            AND id IN (${placeholders})
          `,
          updateParams
        );
        
        console.log(`✅ Updated ${selectedItemIds.length} selected items in order ${orderNumber} with invoice ${invoiceNumber}`);
        
      } else {
        await queryPromise(
          connection,
          `
          UPDATE order_items SET 
            invoice_number = ?, 
            invoice_date = ?, 
            invoice_status = 1, 
            updated_at = NOW()
          WHERE order_number = ?
          `,
          [invoiceNumber, invoiceDate, orderNumber]
        );
        
        const countResult = await queryPromise(
          connection,
          "SELECT COUNT(*) as count FROM order_items WHERE order_number = ?",
          [orderNumber]
        );
        
        console.log(`✅ Updated ALL ${countResult[0].count} items in order ${orderNumber} with invoice ${invoiceNumber}`);
      }
      
      // Step 2: Update orders table
      console.log(`🔄 Updating order status in orders table for: ${orderNumber}`);
      
      await queryPromise(
        connection,
        `
        UPDATE orders SET 
          order_status = 'Invoice',
          invoice_number = ?,
          invoice_date = ?,
          invoice_status = 1,
          updated_at = NOW()
        WHERE order_number = ?
        `,
        [invoiceNumber, invoiceDate, orderNumber]
      );
      
      console.log(`✅ Order ${orderNumber} status updated to 'Invoiced' in orders table with invoice ${invoiceNumber}`);
      
    } catch (error) {
      if (error.code === 'ER_BAD_FIELD_ERROR') {
        if (error.message.includes('updated_at')) {
          console.log("ℹ️ 'updated_at' column not found, updating without it...");
          
          if (hasItemSelection && selectedItemIds.length > 0) {
            const placeholders = selectedItemIds.map(() => '?').join(',');
            const updateParams = [invoiceNumber, invoiceDate, orderNumber, ...selectedItemIds];
            
            await queryPromise(
              connection,
              `
              UPDATE order_items SET 
                invoice_number = ?, 
                invoice_date = ?, 
                invoice_status = 1
              WHERE order_number = ? 
                AND id IN (${placeholders})
              `,
              updateParams
            );
          } else {
            await queryPromise(
              connection,
              `
              UPDATE order_items SET 
                invoice_number = ?, 
                invoice_date = ?, 
                invoice_status = 1
              WHERE order_number = ?
              `,
              [invoiceNumber, invoiceDate, orderNumber]
            );
          }
          
          await queryPromise(
            connection,
            `
            UPDATE orders SET 
              order_status = 'Invoice',
              invoice_number = ?,
              invoice_date = ?,
              invoice_status = 1
            WHERE order_number = ?
            `,
            [invoiceNumber, invoiceDate, orderNumber]
          );
          
        } else if (error.message.includes('invoice_status')) {
          console.log("ℹ️ 'invoice_status' column not found in orders table, updating without it...");
          
          await queryPromise(
            connection,
            `
            UPDATE orders SET 
              order_status = 'Invoice',
              invoice_number = ?,
              invoice_date = ?
            WHERE order_number = ?
            `,
            [invoiceNumber, invoiceDate, orderNumber]
          );
        }
      } else {
        console.error(`❌ Error updating order ${orderNumber}:`, error.message);
        throw error;
      }
    }
  }

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
  let taxableAmount, totalGST, grandTotal;
  
  if (isKacha) {
    console.log("🔴 KACHA Order Mode Detected - Calculating totals without GST");
    
    taxableAmount = parseFloat(transactionData.BasicAmount) ||
                   parseFloat(transactionData.taxableAmount) ||
                   parseFloat(transactionData.Subtotal) ||
                   items.reduce((sum, i) => sum + i.total, 0);
    
    totalGST = 0;
    grandTotal = taxableAmount;
    
  } else {
    taxableAmount = parseFloat(transactionData.BasicAmount) ||
                    parseFloat(transactionData.taxableAmount) ||
                    parseFloat(transactionData.Subtotal) ||
                    items.reduce((sum, i) => sum + (i.quantity * i.price), 0);
    
    totalGST = parseFloat(transactionData.TaxAmount) ||
               parseFloat(transactionData.totalGST) ||
               items.reduce((sum, i) => {
                 const itemTotal = i.quantity * i.price;
                 const discountAmount = itemTotal * (i.discount / 100);
                 const amountAfterDiscount = itemTotal - discountAmount;
                 return sum + (amountAfterDiscount * (i.gst / 100));
               }, 0);
    
    grandTotal = parseFloat(transactionData.TotalAmount) ||
                 parseFloat(transactionData.grandTotal) ||
                 taxableAmount + totalGST;
  }

  console.log(`💰 Totals - Taxable: ${taxableAmount}, GST: ${totalGST}, Grand Total: ${grandTotal}`);
  console.log(`💰 Staff Incentive: ${staffIncentive}`);

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

  // STEP 7: VOUCHER DATA WITH STAFF INCENTIVE
  const voucherData = {
    VoucherID: nextVoucherId,
    TransactionType: transactionType,
    VchNo: vchNo,
    InvoiceNumber: invoiceNumber,
    order_number: orderNumber, 
    order_mode: orderMode,
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

    SGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.SGSTPercentage) || 0),
    CGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.CGSTPercentage) || 0),
    IGSTPercentage: isKacha ? 0 : (parseFloat(transactionData.IGSTPercentage) || (items[0]?.igst || 0)),

    SGSTAmount: isKacha ? 0 : (parseFloat(transactionData.SGSTAmount) || 0),
    CGSTAmount: isKacha ? 0 : (parseFloat(transactionData.CGSTAmount) || 0),
    IGSTAmount: isKacha ? 0 : (parseFloat(transactionData.IGSTAmount) || 0),
    
    description_preview: transactionData.description_preview || 
                        (transactionData.description ? 
                         transactionData.description.substring(0, 200) : ''),
    
    note_preview: transactionData.note_preview || 
                 (transactionData.note ? transactionData.note.substring(0, 200) : ''),
    
    TaxSystem: isKacha ? "KACHA_NO_GST" : (transactionData.TaxSystem || "GST"),

    product_id: items[0]?.product_id || null,
    batch_id: voucherBatchNumber,
    DC: transactionType === "CreditNote" ? "C" : "D",

    ChequeNo: transactionData.ChequeNo || "",
    ChequeDate: transactionData.ChequeDate || null,
    BankName: transactionData.BankName || "",

    staffid: transactionData.staffid || null,
    assigned_staff: transactionData.assigned_staff || null,
    staff_incentive: staffIncentive, // Now properly defined

    created_at: new Date(),
    balance_amount: parseFloat(transactionData.balance_amount) || 0,
    status: transactionData.status || "active",
    paid_date: transactionData.paid_date || null,

    pdf_data: transactionData.pdf_data || null,
    pdf_file_name: transactionData.pdf_file_name || null,
    pdf_created_at: transactionData.pdf_created_at || null
  };

  console.log("🔍 DEBUG - Staff Incentive in voucher:", voucherData.staff_incentive);

  await queryPromise(
    connection,
    "INSERT INTO voucher SET ?",
    [voucherData]
  );

  // STEP 8: INSERT ITEMS INTO voucherdetails - Fix the SQL query
  const insertDetailQuery = `
    INSERT INTO voucherdetails (
      voucher_id, product, product_id, transaction_type, InvoiceNumber,
      batch, quantity, price, discount,
      gst, cgst, sgst, igst, cess, total,  created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, NOW())
  `;

  for (const i of items) {
    const itemGST = isKacha ? 0 : i.gst;
    const itemCGST = isKacha ? 0 : i.cgst;
    const itemSGST = isKacha ? 0 : i.sgst;
    const itemIGST = isKacha ? 0 : i.igst;
    const itemCess = isKacha ? 0 : i.cess;
    
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
      itemGST,
      itemCGST,
      itemSGST,
      itemIGST,
      itemCess,
      i.total,
    ]);
  }

  // STEP 9: SMART STOCK UPDATES
  for (const i of items) {
    if (transactionType === "Sales" || transactionType === "DebitNote" || transactionType === "stock transfer") {
      
      let remainingQuantity = i.quantity;
      
      const batches = await queryPromise(
        connection,
        `
        SELECT batch_number, quantity, mfg_date 
        FROM batches 
        WHERE product_id = ? 
          AND quantity > 0 
        ORDER BY mfg_date ASC
        `,
        [i.product_id]
      );
      
      console.log(`📊 Found ${batches.length} batches for product ${i.product_id}`);
      console.log(`📦 Need to deduct ${remainingQuantity} units`);
      
      if (batches.length === 0) {
        throw new Error(`No stock available for product ID ${i.product_id}`);
      }
      
      for (const batch of batches) {
        if (remainingQuantity <= 0) break;
        
        const batchQtyAvailable = batch.quantity;
        const batchNumber = batch.batch_number;
        
        const deductQty = Math.min(remainingQuantity, batchQtyAvailable);
        
        if (deductQty > 0) {
          console.log(`➖ Deducting ${deductQty} from batch ${batchNumber} (MFG: ${batch.mfg_date})`);
          
          await queryPromise(
            connection,
            `
            UPDATE batches 
              SET quantity = quantity - ?, 
                  stock_out = stock_out + ?, 
                  updated_at = NOW()
            WHERE product_id = ? 
              AND batch_number = ? 
              AND quantity >= ?
            `,
            [deductQty, deductQty, i.product_id, batchNumber, deductQty]
          );
          
          remainingQuantity -= deductQty;
        }
      }
      
      if (remainingQuantity > 0) {
        throw new Error(`Insufficient stock for product ID ${i.product_id}. Shortage: ${remainingQuantity} units`);
      }
      
    } else if (transactionType === "Purchase" || transactionType === "CreditNote") {
      await queryPromise(
        connection,
        `
        UPDATE batches 
          SET quantity = quantity + ?, 
              stock_in = stock_in + ?, 
              updated_at = NOW()
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
    taxableAmount,
    totalGST,
    grandTotal,
    staffIncentive: staffIncentive, // Return staff incentive
    orderNumber: orderNumber,
    orderMode: orderMode,
    isKacha: isKacha,
    updatedItemCount: hasItemSelection ? selectedItemIds.length : 'all',
    orderStatusUpdated: orderNumber ? true : false
  };
};

module.exports = router;