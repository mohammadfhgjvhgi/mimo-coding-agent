// calculator.js — a tiny module for the agent's vertical-slice test.
// The agent is expected to read this file, add a `divide` function, then run it.

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

if (require.main === module) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error("❌ FAIL:", msg);
      process.exit(1);
    } else {
      console.log("✅ PASS:", msg);
    }
  };

  assert(add(2, 3) === 5, "add(2,3) should equal 5");
  assert(subtract(5, 2) === 3, "subtract(5,2) should equal 3");
  assert(multiply(4, 3) === 12, "multiply(4,3) should equal 12");
  assert(divide(6, 2) === 3, "divide(6,2) should equal 3");
  assert(divide(10, 4) === 2.5, "divide(10,4) should equal 2.5");
  
  // Test division by zero
  try {
    divide(5, 0);
    assert(false, "divide(5,0) should throw an error");
  } catch (e) {
    assert(e.message === 'Division by zero is not allowed', "divide(5,0) should throw the correct error");
  }

  console.log("\nAll core tests passed.");
}
