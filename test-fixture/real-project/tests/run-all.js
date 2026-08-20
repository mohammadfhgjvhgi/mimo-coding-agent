const fs = require('fs');
const path = require('path');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'));
let pass = 0, fail = 0;
for (const f of files) {
  try { require(path.join(__dirname, f)); pass++; }
  catch (e) { fail++; console.error('✗ ' + f + ' FAILED: ' + e.message); }
}
console.log('\n=== Test Results: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail > 0 ? 1 : 0);
