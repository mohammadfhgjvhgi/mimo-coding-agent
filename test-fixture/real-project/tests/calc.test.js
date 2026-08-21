const { add, subtract, multiply, divide } = require('../src/calc');
function assert(c, m) { if (!c) throw new Error(m); }
assert(add(2, 3) === 5, 'add failed');
assert(subtract(5, 2) === 3, 'subtract failed');
assert(multiply(3, 4) === 12, 'multiply failed');
// FAIL: divide(10,0) should throw but returns Infinity
try { divide(10, 0); throw new Error('TEST FAILED: divide(10,0) did not throw'); }
catch (e) { if (e.message.includes('TEST FAILED')) throw e; }
console.log('✓ calc.test.js passed');
