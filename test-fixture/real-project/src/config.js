module.exports = {
  appName: 'real-project',
  version: '1.0.0',
  maxRetries: 3,
  // BUG: timeout is 0 — effectively disabled, retry.test expects 3 attempts
  // but retry.js calls config.timeout (0) → infinite loop if used as guard
  timeout: 0,
};
