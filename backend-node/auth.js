// Auth helpers re-export - token generation for routes
const {
  generateAccessToken,
  generateRefreshToken,
} = require('./security');

module.exports = {
  generateAccessToken,
  generateRefreshToken,
};
