const crypto = require('crypto');

function hashPayload(raw) {
  return crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}

module.exports = { hashPayload };
