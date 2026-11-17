// Auth Middleware - Equivalent to backend/app/security.py
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const { v4: uuidv4 } = require('uuid');

const { Users } = require('./models'); // Will be imported dynamically

/**
 * Hash password using Argon2id (security-first from Prompt 1)
 */
async function hashPassword(plainPassword) {
  const hash = await argon2.hash(plainPassword);
  return hash;
}

/**
 * Verify password against Argon2id hash
 */
async function verifyPassword(plainPassword, hashedPassword) {
  const valid = await argon2.verify(hashedPassword, plainPassword);
  return valid;
}

/**
 * Generate JWT access token (15 min expiry)
 */
function generateAccessToken(userId, organizationId, roles) {
  return jwt.sign(
    { 
      sub: userId, 
      org: organizationId,
      roles: roles || [],
      type: 'access'
    }, 
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

/**
 * Generate JWT refresh token (7 days expiry)
 */
function generateRefreshToken(userId, organizationId, familyId) {
  return jwt.sign(
    { 
      sub: userId, 
      org: organizationId,
      type: 'refresh',
      family: familyId
    }, 
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Verify JWT access token (from HttpOnly cookie)
 */
function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Verify JWT refresh token
 */
function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Create session ID for refresh token rotation protection
 */
function createSessionFamily() {
  return uuidv4();
}

/**
 * SSRF Protection - Block localhost/127.0.0.1/private IPs/cloud metadata/dangerous schemes
 * Equivalent to backend/app/security/ssrf.py
 */
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Block localhost
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }
    
    // Block private IP ranges
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./
    ];
    
    for (const range of privateRanges) {
      if (range.test(parsed.hostname)) {
        return false;
      }
    }
    
    // Block common dangerous schemes
    const dangerousSchemes = ['file://', 'ftp://', 'javascript:', 'data:'];
    if (dangerousSchemes.some(scheme => url.startsWith(scheme))) {
      return false;
    }
    
    // Block cloud metadata endpoints
    if (parsed.hostname.match(/^metadata\\.|169\\.254/)) {
      return false;
    }
    
    return true;
  } catch (e) {
    return false; // Invalid URL is not safe
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  createSessionFamily,
  isSafeUrl
};