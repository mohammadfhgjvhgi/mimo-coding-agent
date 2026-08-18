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

// NOTE: division is intentionally missing — the agent should add it.

module.exports = { add, subtract, multiply };

if (require.main === module) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error("FAIL:", msg);
      process.exit(1);
    } else {
      console.log("PASS:", msg);
    }
  };

  assert(add(2, 3) === 5, "add(2,3) should equal 5");
  assert(subtract(5, 2) === 3, "subtract(5,2) should equal 3");
  assert(multiply(4, 3) === 12, "multiply(4,3) should equal 12");

  console.log("\nAll core tests passed.");
}
