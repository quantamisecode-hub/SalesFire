// Members routes — list the organization's active members (for lead-owner
// assignment and owner filtering). Identity always comes from the token (§40).
const express = require('express');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const { OrganizationMembership, User } = models;

const router = express.Router();

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

// GET /api/v1/members — active members of the caller's organization.
router.get('/', async (req, res) => {
  try {
    const memberships = await OrganizationMembership.findAll({
      where: { organizationId: req.user.org, isActive: true },
    });
    const users = await User.findAll({
      where: { id: memberships.map((m) => m.userId) },
      attributes: ['id', 'email', 'fullName'],
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const data = memberships
      .map((m) => {
        const u = byId.get(m.userId);
        return u ? { id: u.id, email: u.email, fullName: u.fullName, role: m.role } : null;
      })
      .filter(Boolean);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Members list error:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

module.exports = router;
