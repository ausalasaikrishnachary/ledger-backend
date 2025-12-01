const express = require('express');
const cors = require('cors'); // ✅ Import CORS
const app = express();

const accountsRoutes = require('./routes/accountRoutes'); // Import account routes
const inventoryRoutes = require('./routes/Inventory/inventoryRoutes'); // Import inventory routes
// const offersRoutes = require('./routes/Inventory/OffersRoutes'); 
const inventoryCategoryRoutes = require('./routes/Inventory/Category_companyRoutes'); // Import inventory category and company routes
const inventoryServiceRoutes = require('./routes/Inventory/ServiceRoutes'); // Import inventory service routes
const inventoryStockRoutes = require('./routes/Inventory/StockRoutes'); // Import inventory stock routes
const gstApiRoutes = require('./routes/gstApiRoutes'); // Import GST API routes
const transactionApiRoutes = require('./routes/Transaction/TransactionRoutes');
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


// Add this line with your other route imports
const creditPeriodFixRoutes = require('./routes/CreditPeriod/CreditPeriodRoutes');



const port = 5001;

// ✅ Use CORS Middleware (allows requests from any origin)
app.use(cors());

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Increase payload size limit for PDF storage
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware to parse JSON
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
app.use('/', transactionApiRoutes);
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

app.use("/api/reports", retailerReportRoutes);
app.use("/api/reports", expenseReportRoutes);
app.use("/api/reports", salesReportRoutes);

// Add this line with your other route uses
app.use('/api/credit-period-fix', creditPeriodFixRoutes);


app.use('/', pdfRoutes);


app.use("/orders", RetailerOrderRoutes);
app.use("/api/cart", cartRoutes);


// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});