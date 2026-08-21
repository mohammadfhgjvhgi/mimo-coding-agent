const { validate } = require('./validate');
function add(a, b) { validate(a, b); return a + b; }
function subtract(a, b) { validate(a, b); return a - b; }
function multiply(a, b) { validate(a, b); return a * b; }
function divide(a, b) {
  validate(a, b);
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}
module.exports = { add, subtract, multiply, divide };
