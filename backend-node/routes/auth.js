// Auth Routes - register / login / me / refresh / logout
// Tokens are HttpOnly cookies (never exposed to JS).
const express = require('express');
const router = express.Router();
const {
  User,
  Organization,
  OrganizationMembership,
} = require('../models');
const {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../security');

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const ACCESS_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.ENVIRONMENT === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_MS,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.ENVIRONMENT === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TTL_MS,
  });
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName || null,
    organization_id: user.organizationId || null,
    role: user.role,
    is_active: user.isActive,
  };
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'org';
}

// POST /api/v1/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, full_name: fullName, organization_name: organizationName } = req.body || {};

    if (!email || !password || !organizationName) {
      return res.status(422).json({
        error: 'email, password and organization_name are required',
      });
    }
    if (String(password).length < 8) {
      return res.status(422).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await User.findOne({ where: { email: String(email).toLowerCase() } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Create organization (unique name + slug)
    let org = await Organization.findOne({ where: { name: organizationName } });
    if (!org) {
      let slug = slugify(organizationName);
      const clash = await Organization.findOne({ where: { slug } });
      if (clash) slug = `${slug}-${Date.now().toString(36)}`;
      org = await Organization.create({ name: organizationName, slug });
    }

    // Create user (User.beforeCreate hashes passwordHash via Argon2id)
    const user = await User.create({
      email: String(email).toLowerCase(),
      passwordHash: password,
      fullName: fullName || null,
      organizationId: org.id,
      role: 'owner',
      isActive: true,
    });

    await OrganizationMembership.findOrCreate({
      where: { userId: user.id, organizationId: org.id },
      defaults: { role: 'owner' },
    });

    const accessToken = generateAccessToken(user.id, org.id, ['owner']);
    const refreshToken = generateRefreshToken(user.id, org.id, `fam-${user.id}`);
    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({
      token_type: 'bearer',
      user: publicUser(user),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(422).json({ error: 'email and password are required' });
    }

    const user = await User.findOne({ where: { email: String(email).toLowerCase() } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const accessToken = generateAccessToken(user.id, user.organizationId, [user.role]);
    const refreshToken = generateRefreshToken(user.id, user.organizationId, `fam-${user.id}`);
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      token_type: 'bearer',
      user: publicUser(user),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
router.get('/me', async (req, res, next) => {
  try {
    const token = req.cookies[ACCESS_COOKIE];
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = await User.findByPk(payload.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) {
      return res.status(401).json({ error: 'No refresh token' });
    }
    const payload = verifyRefreshToken(token);
    if (!payload) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const user = await User.findByPk(payload.sub);
    if (!user || !user.isActive) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'User not found or disabled' });
    }

    const accessToken = generateAccessToken(user.id, user.organizationId, [user.role]);
    const refreshToken = generateRefreshToken(user.id, user.organizationId, payload.family || `fam-${user.id}`);
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      token_type: 'bearer',
      user: publicUser(user),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
});

module.exports = router;
