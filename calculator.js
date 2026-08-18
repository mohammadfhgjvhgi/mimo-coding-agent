// آلة حاسبة بسيطة

/**
 * دالة الجمع
 * @param {number} a - الرقم الأول
 * @param {number} b - الرقم الثاني
 * @returns {number} - ناتج الجمع
 */
function add(a, b) {
    return a + b;
}

/**
 * دالة الطرح
 * @param {number} a - الرقم الأول
 * @param {number} b - الرقم الثاني
 * @returns {number} - ناتج الطرح
 */
function subtract(a, b) {
    return a - b;
}

/**
 * دالة الضرب
 * @param {number} a - الرقم الأول
 * @param {number} b - الرقم الثاني
 * @returns {number} - ناتج الضرب
 */
function multiply(a, b) {
    return a * b;
}

/**
 * دالة القسمة
 * @param {number} a - الرقم الأول
 * @param {number} b - الرقم الثاني
 * @returns {number|string} - ناتج القسمة أو رسالة خطأ عند القسمة على صفر
 */
function divide(a, b) {
    if (b === 0) {
        return "خطأ: لا يمكن القسمة على صفر";
    }
    return a / b;
}

// اختبارات الدوال
console.log("اختبارات الآلة الحاسبة:");
console.log("استدعاء دالة add(5, 3)");
console.log("5 + 3 =", add(5, 3));
console.log("10 - 4 =", subtract(10, 4));
console.log("6 * 7 =", multiply(6, 7));
console.log("20 / 5 =", divide(20, 5));
console.log("10 / 0 =", divide(10, 0));
