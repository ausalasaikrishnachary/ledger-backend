const express = require('express');
const router = express.Router();
const db = require('./../../db');

router.post("/transaction", (req, res) => {
  console.log("Request Body:", req.body);
  res.send("Received");
});



module.exports = router;