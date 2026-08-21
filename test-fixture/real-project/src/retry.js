const config = require('./config');
const logger = require('./logger');
async function retry(fn) {
  for (let i = 0; i < config.maxRetries; i++) {
    try { return await fn(); }
    catch (e) { logger.log(`retry ${i+1}: ${e.message}`); }
  }
  throw new Error('max retries exceeded');
}
module.exports = { retry };
