// Admin-only guard for chatbot endpoints.
// The app has no JWT yet; we verify the requesting user against the DB
// on every request (role = 'admin' and account active).
const db = require('../db');

const ACTIVE_STATUSES = [null, '', '1', 1, 'Active', 'active'];

function chatbotAdminGuard(req, res, next) {
  const userId =
    (req.body && req.body.userId) ||
    (req.body && req.body.parameters && req.body.parameters.userId) ||
    req.headers['x-user-id'] ||
    req.query.userId;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Login required' });
  }

  db.query(
    "SELECT id, role, status FROM accounts WHERE id = ? LIMIT 1",
    [userId],
    (err, rows) => {
      if (err) {
        console.error('chatbotAdminGuard error:', err.message);
        return res.status(500).json({ success: false, error: 'Auth check failed' });
      }
      const user = rows && rows[0];
      const roleOk = user && String(user.role || '').toLowerCase() === 'admin';
      const statusOk = user && ACTIVE_STATUSES.some((s) => String(user.status ?? '') === String(s ?? ''));
      if (!user || !roleOk || !statusOk) {
        return res.status(403).json({ success: false, error: 'Admin access required' });
      }
      req.adminUser = user;
      next();
    }
  );
}

module.exports = chatbotAdminGuard;
