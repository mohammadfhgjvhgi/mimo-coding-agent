let display = document.getElementById('display');
let currentInput = '';
let shouldResetDisplay = false;

function appendToDisplay(value) {
    if (shouldResetDisplay) {
        display.value = '';
        shouldResetDisplay = false;
    }
    
    if (display.value === '0' && value !== '.') {
        display.value = value;
    } else {
        display.value += value;
    }
    currentInput = display.value;
}

function clearDisplay() {
    display.value = '0';
    currentInput = '';
}

function deleteLast() {
    if (display.value.length > 1) {
        display.value = display.value.slice(0, -1);
    } else {
        display.value = '0';
    }
    currentInput = display.value;
}

function calculateResult() {
    try {
        // استبدل الرموز الرياضية بالرموز القياسية
        let expression = display.value.replace(/×/g, '*').replace(/÷/g, '/');
        
        // تأكد من عدم وجود عمليات غير صالحة
        if (/^([\d+\-*/.()]+)$/.test(expression)) {
            let result = eval(expression);
            
            // تأكد من أن النتيجة ليست غير محددة
            if (result !== undefined && !isNaN(result)) {
                display.value = result.toString();
                currentInput = result.toString();
                shouldResetDisplay = true;
            } else {
                throw new Error('Invalid calculation');
            }
        } else {
            throw new Error('Invalid expression');
        }
    } catch (error) {
        display.value = 'Error';
        currentInput = '';
        shouldResetDisplay = true;
    }
}

// إضافة مستمعي الأحداث للأزرار
document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => {
        button.addEventListener('click', function() {
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 100);
        });
    });
});

// دعم لوحة المفاتيح
document.addEventListener('keydown', function(event) {
    const key = event.key;
    
    if (key >= '0' && key <= '9' || key === '.') {
        appendToDisplay(key);
    } else if (key === '+' || key === '-' || key === '*' || key === '/') {
        appendToDisplay(key);
    } else if (key === 'Enter' || key === '=') {
        calculateResult();
    } else if (key === 'Escape' || key === 'c' || key === 'C') {
        clearDisplay();
    } else if (key === 'Backspace') {
        deleteLast();
    }
});