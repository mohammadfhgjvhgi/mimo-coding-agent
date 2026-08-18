const { add, subtract, multiply } = require('./math');
function calculate(op, a, b) {
  if (op === 'add') return add(a, b);
  if (op === 'subtract') return subtract(a, b);
  if (op === 'multiply') return multiply(a, b);
  throw new Error('Unknown op');
}
module.exports = { calculate };
