// Notifications — read-only surface for the unified inbox + org alerts.
// Tenancy from the token; users only ever see their own notifications.
const express = require('express');
const models = require('../models');
const { verifyAccessToken } = require('../security');

const router = express.Router();
const { Notification } = models;

router.use((req, res, next) => {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles || [] };
    if (!req.user.org) return res.status(403).json({ error: 'No organization membership' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// GET /notifications?unread=1|0&page=&pageSize= — list (newest first)
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const where = { organizationId: req.user.org, userId: req.user.id };
    if (req.query.unread === '1') where.isRead = false;
    if (req.query.unread === '0') where.isRead = true;
    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    res.json({
      success: true,
      data: rows.map((n) => ({
        id: n.id, type: n.type, title: n.title, body: n.body,
        conversationId: n.conversationId, isRead: n.isRead, createdAt: n.createdAt,
      })),
      pagination: { page, pageSize, total: count, pages: Math.ceil(count / pageSize) || 1 },
    });
  } catch (error) {
    console.error('Notifications list error:', error);
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

// GET /notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.count({ where: { organizationId: req.user.org, userId: req.user.id, isRead: false } });
    res.json({ success: true, data: { unread: count } });
  } catch (error) {
    console.error('Notifications unread error:', error);
    res.status(500).json({ error: 'Failed to count notifications' });
  }
});

// POST /notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    await Notification.update({ isRead: true }, { where: { organizationId: req.user.org, userId: req.user.id, isRead: false } });
    res.json({ success: true });
  } catch (error) {
    console.error('Notifications read-all error:', error);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

// POST /notifications/:id/read
router.post('/:id/read', async (req, res) => {
  try {
    const n = await Notification.findOne({ where: { id: req.params.id, organizationId: req.user.org, userId: req.user.id } });
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    await n.update({ isRead: true });
    res.json({ success: true });
  } catch (error) {
    console.error('Notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification read' });
  }
});

module.exports = router;
