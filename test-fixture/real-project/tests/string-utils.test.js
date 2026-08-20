const { reverse, capitalize, truncate } = require('../src/string-utils');
function assert(c, m) { if (!c) throw new Error(m); }
assert(reverse('abc') === 'cba', 'reverse failed');
assert(capitalize('hello') === 'Hello', 'capitalize failed');
// FAIL: truncate(null, 5) should handle null gracefully but throws TypeError
assert(truncate(null, 5) === '...', 'truncate null should return ...');
console.log('✓ string-utils.test.js passed');
