// math-utils — a small but real project to test the agent end-to-end.
// Currently has: add, subtract, multiply. Missing: divide + tests.

function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero is not allowed');
  }
  return a / b;
}

module.exports = { add, subtract, multiply, divide };
