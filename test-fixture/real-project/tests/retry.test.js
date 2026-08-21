const { retry } = require('../src/retry');
const logger = require('../src/logger');
async function run() {
  logger.clear();
  let attempts = 0;
  try {
    await retry(async () => { attempts++; throw new Error('always fails'); });
    throw new Error('TEST FAILED: retry should have thrown');
  } catch (e) {
    if (e.message.includes('TEST FAILED')) throw e;
    if (attempts !== 3) throw new Error('expected 3 attempts, got ' + attempts);
  }
  const logs = logger.getLogs();
  if (logs.length !== 3) throw new Error('expected 3 retry logs, got ' + logs.length);
  console.log('✓ retry.test.js passed');
}
run();
