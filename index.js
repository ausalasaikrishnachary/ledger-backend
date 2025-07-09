const express = require('express');
const cors = require('cors'); // ✅ Import CORS
const app = express();
const accountsRoutes = require('./routes/accountRoutes'); // Import account routes

const port = 5000;

// ✅ Use CORS Middleware (allows requests from any origin)
app.use(cors());

// Middleware to parse JSON
app.use(express.json());
app.use('/', accountsRoutes);
// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
