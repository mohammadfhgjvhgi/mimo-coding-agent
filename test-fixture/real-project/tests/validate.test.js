const { validate } = require('../src/validate');
function assertThrows(fn, m) { try { fn(); throw new Error('should throw: ' + m); } catch(e) { if (e.message.includes('should throw')) throw e; } }
function assert(c, m) { if (!c) throw new Error(m); }
assertThrows(() => validate('x', 1), 'string arg');
assertThrows(() => validate(1, 'y'), 'string arg 2');
assert(validate(1, 2) === true, 'valid should return true');
console.log('✓ validate.test.js passed');
