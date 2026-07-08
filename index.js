const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path'); // ✅ Add this line - missing path module
const fetch = require('node-fetch');
require("dotenv").config();

const app = express();

// Import routes
require("./routes/ledgerEmailCron");
const salespersonScoreRoutes = require('./routes/salespersonScoreRoutes.');
const accountsRoutes = require('./routes/accountRoutes');
const inventoryRoutes = require('./routes/Inventory/inventoryRoutes');
const inventoryCategoryRoutes = require('./routes/Inventory/Category_companyRoutes');
const inventoryServiceRoutes = require('./routes/Inventory/ServiceRoutes');
const inventoryStockRoutes = require('./routes/Inventory/StockRoutes');
const gstApiRoutes = require('./routes/gstApiRoutes');
const accountsGroupRoutes = require('./routes/accountGroupRoutes');
const staffRoutes = require('./routes/staffRoutes');
const loginRoutes = require('./routes/loginsignup');
const AuthRoutes = require('./routes/authRoutes');
const LogVisit = require('./routes/LogVisit');
const expensiveRoutes = require("./routes/expensiveRoutes");
const CustomerRoutes = require("./routes/Inventory/CustomerRoutes");
const vochurRoutes = require("./routes/VochurRoutes");
const receiptsRouter = require('./routes/routes');
const retailerReportRoutes = require("./routes/retailerReportRoutes");
const expenseReportRoutes = require("./routes/expenseReportRoutes");
const GstrbReportRoutes = require("./routes/GstrbReportRoutes");
const salesReportRoutes = require("./routes/salesReportRoutes");
const pdfRoutes = require('./routes/pdfRoutes');
const creditnoteRoutes = require('./routes/creditnote');
const debitnoteRoutes = require('./routes/debitnote');
const voucher = require('./routes/vouchercopy');
const orderRoutes = require('./routes/orders');
const categoriesRoutes = require('./routes/categories');
const offersRoutes = require('./routes/Inventory/OffersRoutes');
const cartRoutes = require("./routes/Retailer/CartRoutes");
const RetailerOrderRoutes = require("./routes/Retailer/OrderRoutes");
const retailerScoreRoutes = require('./routes/retailerScore');
const creditPeriodFixRoutes = require('./routes/CreditPeriod/CreditPeriodRoutes');
const inventory = require('./routes/Retailer/InventoryRoutesRetailer');
const OfferFlashSale = require('./routes/OfferFlashSale');
const Journalroutes = require('./routes/Journalroutes');
const gspRoutes = require('./routes/gspRoutes');
const irnRoutes = require('./routes/irnRoutes');
const saleType = require('./routes/saleType');
const gspAuth = require('./gspAuth');

const { baseurl } = require('./baseUrl');
const port = 5000;

// ✅ Use CORS Middleware (allows requests from any origin)
app.use(cors());

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Increase payload size limit for PDF storage
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

console.log(
  "Invoice Path:",
  path.join(__dirname, './invoice')
);

// Serve static files from invoices directory
// app.use(
//   '/invoice',
//   express.static(path.join(__dirname, '../invoice'))
// );

app.use(
  '/invoice',
  express.static(
    path.resolve(process.cwd(), 'invoice')
  )
);
// Middleware to parse JSON
app.use(express.json());

// Routes - Order matters! Put specific routes before general ones
app.use('/api', irnRoutes);
app.use('/api', retailerScoreRoutes);
app.use('/api', salespersonScoreRoutes);
app.use('/', AuthRoutes);
app.use('/', accountsRoutes);
app.use('/', inventoryRoutes);
app.use('/api', offersRoutes);
app.use('/', vochurRoutes);
app.use('/', inventoryCategoryRoutes);
app.use('/', inventoryServiceRoutes);
app.use('/', inventoryStockRoutes);
app.use('/', gstApiRoutes);
app.use('/', accountsGroupRoutes);
app.use('/api', staffRoutes);
app.use('/', loginRoutes);
app.use('/api', LogVisit);
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
app.use("/api/reports", GstrbReportRoutes);
app.use("/api/gstr3b", GstrbReportRoutes);
app.use("/api/reports", salesReportRoutes);
app.use('/api/credit-period-fix', creditPeriodFixRoutes);
app.use("/", OfferFlashSale);
app.use("/orders", RetailerOrderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api", inventory);
app.use("/api", require("./routes/companyInfo"));
app.use('/api', gspRoutes);
app.use('/api', saleType);



// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});


// Setup cron jobs when your application starts
gspAuth.setupCronJobs();

// Optional: Test authentication
gspAuth.testAuthentication().then(result => {
  if (result.success) {
    console.log('✅ GSP Authentication configured successfully');
  } else {
    console.log('⚠️ GSP Authentication test failed. Check your credentials.');
  }
});

// ============================================
// CRON JOB FOR AUTOMATIC SCORE CALCULATION
// ============================================
cron.schedule('50 19 * * *', async () => {
  console.log(`⏰ [${new Date().toISOString()}] Running daily score calculation...`);

  try {
    const response = await fetch(`${baseurl}/api/calculate-retailer-scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ period: 90 })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    console.log('✅ Daily score calculation completed:', data.message || 'Success');
    if (data.results) {
      console.log(`📊 Processed ${data.results.length} retailers`);

      const tierCount = data.results.reduce((acc, retailer) => {
        acc[retailer.tier] = (acc[retailer.tier] || 0) + 1;
        return acc;
      }, {});

      console.log('🏆 Tier distribution:', tierCount);
    }

  } catch (err) {
    console.error('❌ Cron job failed:', err.message);
  }
});

console.log('⏰ Cron job scheduled: Daily score calculation at 18:36 (6:36 PM)');

// ============================================
// CRON JOB FOR SALESPERSON TARGET SCORE CALCULATION
// ============================================
cron.schedule('18 19 * * *', async () => {
  console.log(`⏰ [${new Date().toISOString()}] Running daily salesperson target score calculation...`);
  
  try {
    const response = await fetch(`${baseurl}/api/calculate-salesperson-scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ period: 30 })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('✅ Daily salesperson score calculation completed:', data.message || 'Success');
    if (data.results) {
      console.log(`📊 Processed ${data.results.length} salespersons`);
      
      const avgAchievement = data.results.reduce((sum, sp) => sum + sp.achievement_percentage, 0) / data.results.length;
      const topPerformer = data.results.sort((a, b) => b.achievement_percentage - a.achievement_percentage)[0];
      
      console.log(`🏆 Average Achievement: ${avgAchievement.toFixed(2)}%`);
      console.log(`🎯 Top Performer: ${topPerformer?.salesperson_name} with ${topPerformer?.achievement_percentage}%`);
    }
    
  } catch (err) {
    console.error('❌ Salesperson score cron job failed:', err.message);
  }
});


console.log('   - Retailer scores: Daily at 18:47 (6:47 PM)');
console.log('   - Salesperson scores: Daily at 19:00 (7:00 PM)');
console.log('   - GSP token refresh: Daily at 2:00 AM');

// ============================================
// MONTHLY RESET AND ARCHIVE JOB (Optional)
// ============================================
cron.schedule('1 0 1 * *', async () => {
  console.log(`📅 [${new Date().toISOString()}] Running monthly target reset...`);
  
  try {
    console.log('✅ Monthly reset completed');
  } catch (err) {
    console.error('❌ Monthly reset failed:', err.message);
  }
});

// Create invoices directory if it doesn't exist
const invoicesDir = path.join(__dirname, 'invoices');
if (!require('fs').existsSync(invoicesDir)) {
  require('fs').mkdirSync(invoicesDir, { recursive: true });
  console.log('📁 Created invoices directory');
}

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`📁 Invoices directory: ${path.join(__dirname, 'invoices')}`);
});