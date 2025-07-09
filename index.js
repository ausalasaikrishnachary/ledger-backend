const express = require('express');
const cors = require('cors'); // ✅ Import CORS
const app = express();
const port = 5000;

// ✅ Use CORS Middleware (allows requests from any origin)
app.use(cors());

// Middleware to parse JSON
app.use(express.json());

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
