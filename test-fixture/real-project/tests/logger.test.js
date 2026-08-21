const logger = require('../src/logger');
function assert(c, m) { if (!c) throw new Error(m); }
logger.clear();
assert(logger.log('test1') === 1, 'log should return count');
assert(logger.log('test2') === 2, 'log should return count 2');
assert(logger.getLogs().length === 2, 'getLogs should have 2');
logger.clear();
assert(logger.getLogs().length === 0, 'clear should empty logs');
console.log('✓ logger.test.js passed');
