const express = require('express');
const cors = require('cors'); // ✅ Import CORS
const app = express();
const accountsRoutes = require('./routes/accountRoutes'); // Import account routes
const inventoryRoutes = require('./routes/Inventory/inventoryRoutes'); // Import inventory routes
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

const port = 5000;

// ✅ Use CORS Middleware (allows requests from any origin)
app.use(cors());

// Middleware to parse JSON
app.use(express.json());
app.use('/', accountsRoutes);
app.use('/', inventoryRoutes); // Use inventory routes
app.use('/', inventoryCategoryRoutes); // Use inventory category and company routes
app.use('/', inventoryServiceRoutes); // Use inventory service routes
app.use('/', inventoryStockRoutes); // Use inventory stock routes
app.use('/', gstApiRoutes); // Use GST API routes
app.use('/', transactionApiRoutes);
app.use('/', accountsGroupRoutes);
app.use('/api', staffRoutes);
app.use('/', loginRoutes); 
app.use('/', AuthRoutes); 
app.use('/api', LogVisit); // ✅ mount LogVisit under /api


// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});