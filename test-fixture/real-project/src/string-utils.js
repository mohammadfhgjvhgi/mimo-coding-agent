function reverse(s) { return s.split('').reverse().join(''); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
// BUG: doesn't handle empty string — crashes
function truncate(s, n) { return s.substring(0, n) + '...'; }
module.exports = { reverse, capitalize, truncate };
