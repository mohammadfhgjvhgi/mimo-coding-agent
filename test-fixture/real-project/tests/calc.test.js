const { add, subtract, multiply, divide } = require('../src/calc');
function assert(cond, msg) { if(!cond) throw new Error(msg); }
assert(add(2,3)===5, 'add failed');
assert(subtract(5,2)===3, 'subtract failed');
// divide by zero MUST throw — currently returns Infinity (bug)
try { divide(10,0); throw new Error('TEST FAILED: divide(10,0) did not throw'); }
catch(e) { if(e.message.includes('TEST FAILED')) throw e; }
assert(divide(10,2)===5, 'divide normal failed');
console.log('ALL TESTS PASSED');
