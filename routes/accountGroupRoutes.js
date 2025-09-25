const express = require('express');
const router = express.Router();
const db = require('../db');

// Get Account Groups
router.get("/accountgroup", (req, res) => {
  db.query("SELECT * FROM accountgroup", (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

module.exports = router;