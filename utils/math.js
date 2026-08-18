// دوال رياضية

/**
 * دالة جمع رقمين
 * @param {number} a - الرقم الأول
 * @param {number} b - الرقم الثاني
 * @return {number} - ناتج الجمع
 */
function add(a, b) {
  return a + b;
}

/**
 * دالة طرح رقمين
 * @param {number} a - الرقم الأول
 * @param {number} b - الرقم الثاني
 * @return {number} - ناتج الطرح
 */
function subtract(a, b) {
  return a - b;
}

// تصدير الدوال
module.exports = {
  add,
  subtract
};