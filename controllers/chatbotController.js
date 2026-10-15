const { findQuestion } = require('../chatbot/questionConfig');
const { executeHandler } = require('../services/chatbotService');
const db = require('../db');

// Keep in sync with frontend developer: audit every chatbot query.
function audit(req, body, outcome, ms) {
  db.query(
    `INSERT INTO chatbot_audit_log (user_id, question_id, parameters, outcome, execution_ms)
     VALUES (?, ?, ?, ?, ?)`,
    [req.adminUser ? req.adminUser.id : null, body.questionId || null, JSON.stringify(body.parameters || {}), outcome, ms],
    (err) => { if (err) console.error('audit log insert failed:', err.message); }
  );
}

async function query(req, res) {
  const started = Date.now();
  const { questionId, parameters } = req.body || {};

  if (!questionId) {
    return res.status(400).json({ success: false, error: 'questionId is required' });
  }
  const question = findQuestion(questionId);
  if (!question) {
    audit(req, req.body, 'failure:unknown_question', Date.now() - started);
    return res.status(400).json({ success: false, error: 'Unknown question' });
  }

  const params = parameters || {};
  for (const key of question.requiredParams) {
    if (params[key] === undefined || params[key] === null || params[key] === '') {
      audit(req, req.body, 'failure:missing_param', Date.now() - started);
      return res.status(400).json({ success: false, error: `Missing required parameter: ${key}` });
    }
  }
  if ((params.fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(params.fromDate)) || (params.toDate && !/^\d{4}-\d{2}-\d{2}$/.test(params.toDate))) {
    return res.status(400).json({ success: false, error: 'Dates must be YYYY-MM-DD' });
  }
  if (params.fromDate && params.toDate && params.fromDate > params.toDate) {
    return res.status(400).json({ success: false, error: 'fromDate must be on or before toDate' });
  }

  const result = await executeHandler(question.handler, params);
  const ms = Date.now() - started;
  audit(req, req.body, result.success ? 'success' : 'failure:handler', ms);

  return res.json({
    success: !!result.success,
    questionId,
    message: result.message,
    error: result.error,
    summary: result.summary,
    data: result.data || [],
    executionMs: ms,
  });
}

module.exports = { query };
