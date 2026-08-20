const { validate } = require('./validate');
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function max(arr) { validate(arr[0], 0); return Math.max(...arr); }
// BUG: doesn't handle empty array — throws on reduce of []
function average(arr) { return sum(arr) / arr.length; }
module.exports = { sum, max, average };
