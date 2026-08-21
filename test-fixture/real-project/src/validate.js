function validate(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new TypeError('args must be numbers');
  }
  return true;
}
module.exports = { validate };
