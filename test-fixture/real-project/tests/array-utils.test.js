const { sum, max, average } = require('../src/array-utils');
function assert(c, m) { if (!c) throw new Error(m); }
assert(sum([1, 2, 3]) === 6, 'sum failed');
assert(max([1, 5, 3]) === 5, 'max failed');
assert(average([2, 4, 6]) === 4, 'average failed');
console.log('✓ array-utils.test.js passed');
