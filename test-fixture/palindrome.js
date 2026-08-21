/**
 * دالة للتحقق ما إذا كان النص هو palindrome
 * @param {string} str - النص المراجع
 * @returns {boolean} - true إذا كان النص palindrome، false في حال أخرى
 */
function isPalindrome(str) {
  // إزالة المسافات وتحويل الأحرف إلى صغيرة
  const cleanStr = str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  
  // مقارنة النص مع عكسه
  return cleanStr === cleanStr.split('').reverse().join('');
}

// اختبارات الدالة
function testPalindrome() {
  const testCases = [
    { input: 'racecar', expected: true },
    { input: 'hello', expected: false },
    { input: 'A man, a plan, a canal: Panama', expected: true },
    { input: '12321', expected: true },
    { input: '12345', expected: false },
    { input: '', expected: true },
    { input: 'a', expected: true }
  ];
  
  testCases.forEach((test, index) => {
    const result = isPalindrome(test.input);
    const passed = result === test.expected;
    console.log(`Test ${index + 1}: ${passed ? '✅' : '❌'}`);
    console.log(`  Input: "${test.input}"`);
    console.log(`  Expected: ${test.expected}, Got: ${result}`);
    console.log('');
  });
}

// تشغيل الاختبارات إذا تم تشغيل الملف مباشرة
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isPalindrome };
} else {
  testPalindrome();
}
