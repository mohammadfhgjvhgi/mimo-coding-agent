// الحصول على عناصر الواجهة
const display = document.querySelector('.display');
const buttons = document.querySelectorAll('button');

// المتغيرات اللازمة للآلة الحاسبة
let firstOperand = '';
let secondOperand = '';
let currentOperator = null;
let shouldResetScreen = false;

// دالة لتحديث الشاشة
function updateDisplay() {
    display.textContent = firstOperand + (currentOperator || '') + secondOperand;
}

// دالة لإجراء العمليات الحسابية
function calculate() {
    if (currentOperator === null || secondOperand === '') return;
    
    let result;
    const first = parseFloat(firstOperand);
    const second = parseFloat(secondOperand);
    
    switch (currentOperator) {
        case '+':
            result = first + second;
            break;
        case '-':
            result = first - second;
            break;
        case '×':
            result = first * second;
            break;
        case '÷':
            result = second !== 0 ? first / second : 'Error';
            break;
        default:
            return;
    }
    
    // تحديث القيم بعد الحساب
    firstOperand = result.toString();
    secondOperand = '';
    currentOperator = null;
    shouldResetScreen = true;
    updateDisplay();
}

// دالة لإعادة تعيين الآلة الحاسبة
function clear() {
    firstOperand = '';
    secondOperand = '';
    currentOperator = null;
    shouldResetScreen = false;
    display.textContent = '0';
}

// دالة لمعالجة إدخال الأرقام
function appendNumber(number) {
    if (shouldResetScreen) {
        firstOperand = '';
        secondOperand = '';
        shouldResetScreen = false;
    }
    
    if (currentOperator === null) {
        // لا يوجد مشغل نشط، أضف إلى الأول
        if (number === '.' && firstOperand.includes('.')) return;
        firstOperand += number;
        display.textContent = firstOperand;
    } else {
        // هناك مشغل نشط، أضف إلى الثاني
        if (number === '.' && secondOperand.includes('.')) return;
        secondOperand += number;
        updateDisplay();
    }
}

// دالة لمعالجة إدخال المشغلين
function appendOperator(operator) {
    if (currentOperator !== null && secondOperand !== '') {
        calculate();
    }
    
    currentOperator = operator;
    shouldResetScreen = false;
    updateDisplay();
}

// إضافة مستمعات الأحداث للأزرار
buttons.forEach(button => {
    button.addEventListener('click', () => {
        const value = button.textContent;
        
        if (button.classList.contains('number') || button.classList.contains('decimal')) {
            appendNumber(value);
        } else if (button.classList.contains('operator')) {
            appendOperator(value);
        } else if (button.classList.contains('clear')) {
            clear();
        } else if (button.classList.contains('equals')) {
            calculate();
        }
    });
});

// دعم لوحة المفاتيح
document.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9' || e.key === '.') {
        appendNumber(e.key);
    } else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
        const operator = e.key === '*' ? '×' : e.key === '/' ? '÷' : e.key;
        appendOperator(operator);
    } else if (e.key === 'Enter' || e.key === '=') {
        calculate();
    } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        clear();
    }
});