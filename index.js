const express = require('express');
const cors = require('cors'); // ✅ Import CORS
const cron = require('node-cron'); // ✅ Move cron to top (only declare once)
const app = express();
const fetch = require('node-fetch');
require("./routes/ledgerEmailCron");



const salespersonScoreRoutes = require('./routes/salespersonScoreRoutes.');
require("dotenv").config();

const accountsRoutes = require('./routes/accountRoutes'); // Import account routes
const inventoryRoutes = require('./routes/Inventory/inventoryRoutes'); // Import inventory routes
// const offersRoutes = require('./routes/Inventory/OffersRoutes'); 
const inventoryCategoryRoutes = require('./routes/Inventory/Category_companyRoutes'); // Import inventory category and company routes
const inventoryServiceRoutes = require('./routes/Inventory/ServiceRoutes'); // Import inventory service routes
const inventoryStockRoutes = require('./routes/Inventory/StockRoutes'); // Import inventory stock routes
const gstApiRoutes = require('./routes/gstApiRoutes'); // Import GST API routes
const accountsGroupRoutes = require('./routes/accountGroupRoutes');
const staffRoutes = require('./routes/staffRoutes'); // Import staff routes
const loginRoutes = require('./routes/loginsignup');
const AuthRoutes = require('./routes/authRoutes');
const LogVisit = require('./routes/LogVisit'); // ✅ correct relative path
const expensiveRoutes = require("./routes/expensiveRoutes");
const CustomerRoutes = require("./routes/Inventory/CustomerRoutes")
// const salesPurchaseInventoryRoutes = require("./routes/Inventory/SalesPurchaseInventoryRoutes")
const vochurRoutes = require("./routes/VochurRoutes")
const receiptsRouter = require('./routes/routes');
const retailerReportRoutes = require("./routes/retailerReportRoutes");
const expenseReportRoutes = require("./routes/expenseReportRoutes");
const salesReportRoutes = require("./routes/salesReportRoutes");

const pdfRoutes = require('./routes/pdfRoutes'); // Add this line
const creditnoteRoutes = require('./routes/creditnote');
const debitnoteRoutes = require('./routes/debitnote');
const voucher = require('./routes/voucher');
const orderRoutes = require('./routes/orders');
const categoriesRoutes = require('./routes/categories');
const offersRoutes = require('./routes/Inventory/OffersRoutes');
const cartRoutes = require("./routes/Retailer/CartRoutes");
const RetailerOrderRoutes = require("./routes/Retailer/OrderRoutes");
const retailerScoreRoutes = require('./routes/retailerScore');
// Add this line with your other route imports
const creditPeriodFixRoutes = require('./routes/CreditPeriod/CreditPeriodRoutes');
const inventory = require('./routes/Retailer/InventoryRoutesRetailer');
const OfferFlashSale = require('./routes/OfferFlashSale');
const Journalroutes = require('./routes/Journalroutes');

const { baseurl } = require('./baseUrl');
const port = 5000;

// ✅ Use CORS Middleware (allows requests from any origin)
app.use(cors());

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Increase payload size limit for PDF storage
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware to parse JSON
app.use('/api', retailerScoreRoutes);
app.use('/api', salespersonScoreRoutes);
app.use(express.json());
app.use('/', AuthRoutes);
app.use('/', accountsRoutes);
app.use('/', inventoryRoutes); // Use inventory routes
app.use('/api', offersRoutes);
app.use('/', vochurRoutes);
app.use('/', inventoryCategoryRoutes); // Use inventory category and company routes
app.use('/', inventoryServiceRoutes); // Use inventory service routes
app.use('/', inventoryStockRoutes); // Use inventory stock routes
app.use('/', gstApiRoutes); // Use GST API routes
app.use('/', accountsGroupRoutes);
app.use('/api', staffRoutes);
app.use('/', loginRoutes);
app.use('/api', LogVisit); // ✅ mount LogVisit under /api
app.use("/", expensiveRoutes);
app.use('/api', receiptsRouter);
app.use('/', pdfRoutes);
app.use("/api", creditnoteRoutes);
app.use("/api", debitnoteRoutes);
app.use('/api', voucher);
app.use('/api', orderRoutes);
app.use('/api', categoriesRoutes);
app.use('/api', Journalroutes);

app.use("/api/reports", retailerReportRoutes);
app.use("/api/reports", expenseReportRoutes);
app.use("/api/reports", salesReportRoutes);

// Add this line with your other route uses
app.use('/api/credit-period-fix', creditPeriodFixRoutes);

app.use('/', pdfRoutes);
app.use("/", OfferFlashSale);
app.use("/orders", RetailerOrderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api", inventory);

// ============================================
// CRON JOB FOR AUTOMATIC SCORE CALCULATION
// ============================================
// Schedule to run at 18:36 (6:36 PM) every day
cron.schedule('50 19 * * *', async () => {
  console.log(`⏰ [${new Date().toISOString()}] Running daily score calculation...`);

  try {
    // Use node-fetch for making HTTP requests
    const fetch = require('node-fetch');

    const response = await fetch(`${baseurl}//api/calculate-retailer-scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ period: 90 }) // Calculate for last 90 days
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    console.log('✅ Daily score calculation completed:', data.message || 'Success');
    if (data.results) {
      console.log(`📊 Processed ${data.results.length} retailers`);

      // Log tier distribution
      const tierCount = data.results.reduce((acc, retailer) => {
        acc[retailer.tier] = (acc[retailer.tier] || 0) + 1;
        return acc;
      }, {});

      console.log('🏆 Tier distribution:', tierCount);
    }

  } catch (err) {
    console.error('❌ Cron job failed:', err.message);

    // Fallback: Try direct function call if fetch fails
    try {
      console.log('🔄 Attempting direct function call as fallback...');
      // If you have a direct function, you can call it here
      // const { calculateAllScores } = require('./routes/retailerScore');
      // await calculateAllScores();
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
    }
  }
});

console.log('⏰ Cron job scheduled: Daily score calculation at 18:36 (6:36 PM)');

// ============================================
// CRON JOB FOR SALESPERSON TARGET SCORE CALCULATION
// ============================================
// Run at 19:00 (7:00 PM) every day - after retailer scores
cron.schedule('18 19 * * *', async () => {
  console.log(`⏰ [${new Date().toISOString()}] Running daily salesperson target score calculation...`);
  
  try {
    const fetch = require('node-fetch');
    
    const response = await fetch(`${baseurl}/api/calculate-salesperson-scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ period: 30 }) // Calculate for last 30 days
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('✅ Daily salesperson score calculation completed:', data.message || 'Success');
    if (data.results) {
      console.log(`📊 Processed ${data.results.length} salespersons`);
      
      // Log performance summary
      const avgAchievement = data.results.reduce((sum, sp) => sum + sp.achievement_percentage, 0) / data.results.length;
      const topPerformer = data.results.sort((a, b) => b.achievement_percentage - a.achievement_percentage)[0];
      
      console.log(`🏆 Average Achievement: ${avgAchievement.toFixed(2)}%`);
      console.log(`🎯 Top Performer: ${topPerformer?.salesperson_name} with ${topPerformer?.achievement_percentage}%`);
    }
    
  } catch (err) {
    console.error('❌ Salesperson score cron job failed:', err.message);
    
    // Fallback: Try direct function call
    try {
      console.log('🔄 Attempting direct salesperson score calculation...');
      // You can add a direct function call here if needed
    } catch (fallbackError) {
      console.error('❌ Salesperson score fallback failed:', fallbackError.message);
    }
  }
});

console.log('⏰ Cron jobs scheduled:');
console.log('   - Retailer scores: Daily at 18:47 (6:47 PM)');
console.log('   - Salesperson scores: Daily at 19:00 (7:00 PM)');

// ============================================
// MONTHLY RESET AND ARCHIVE JOB (Optional)
// ============================================
// Run on 1st of every month at 00:01 AM
cron.schedule('1 0 1 * *', async () => {
  console.log(`📅 [${new Date().toISOString()}] Running monthly target reset...`);
  
  try {
    // You can add monthly reset logic here
    // For example: Archive current scores, reset targets, etc.
    
    console.log('✅ Monthly reset completed');
  } catch (err) {
    console.error('❌ Monthly reset failed:', err.message);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});