const express = require('express');
const router = express.Router();
const chatbotAdminGuard = require('../middleware/chatbotAdminGuard');
const { query } = require('../controllers/chatbotController');
const { CATEGORIES, QUESTIONS } = require('../chatbot/questionConfig');

// Public config (still requires admin auth to be mounted on real usage; harmless to expose structure)
router.get('/chatbot/config', chatbotAdminGuard, (req, res) => {
  res.json({ success: true, categories: CATEGORIES, questions: QUESTIONS.map(({ handler, ...q }) => q) });
});

router.post('/chatbot/query', chatbotAdminGuard, query);

module.exports = router;
