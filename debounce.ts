
/**
 * دالة debounce لدوال async
 * @param func الدالة غير المتزامنة التي تريد تطبيق debounce عليها
 * @param delay الوقت بالمللي ثانية الذي يجب الانتظار قبل تنفيذ الدالة
 * @returns دالة مُغلفة تطبق debounce
 */
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
  func: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  // متغير لتخزين معرّف مؤقت التأخير
  let timeoutId: NodeJS.Timeout | null = null;
  
  // متغير لتخزين آخر وعد تم إرجاعه للعميل
  let pendingPromise: Promise<ReturnType<T>> | null = null;
  
  // متغير لتخزين الوسائط الأخيرة التي تم استدعاء الدالة بها
  let lastArgs: Parameters<T> | null = null;
  
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    // حفظ الوسائط الحالية لاستخدامها لاحقاً
    lastArgs = args;
    
    // إذا كان هناك وعد قيد الانتظار، أعدم نفسه
    if (pendingPromise) {
      pendingPromise = null;
    }
    
    // إنشاء وعد جديد سيتم إرجاعه للعميل
    pendingPromise = new Promise<ReturnType<T>>((resolve, reject) => {
      // إذا كان هناك مؤقت سابق، قم بإلغائه
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // إنشاء مؤقت جديد
      timeoutId = setTimeout(() => {
        // محاولة تنفيذ الدالة الأصلية مع الوسائير المحفوظة
        try {
          const result = func(...lastArgs!);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          // إعادة التعيين بعد التنفيذ
          timeoutId = null;
          pendingPromise = null;
          lastArgs = null;
        }
      }, delay);
    });
    
    return pendingPromise;
  };
}

/**
 * مثال على استخدام debounceAsync مع دالة async
 */
async function fetchData(query: string): Promise<string> {
  // محاكاة استدعاء API
  console.log(`Fetching data for: ${query}`);
  await new Promise(resolve => setTimeout(resolve, 1000)); // تأخير 1 ثانية
  return `Results for ${query}`;
}

// إنشاء نسخة مع debounced من دالة fetchData
const debouncedFetchData = debounceAsync(fetchData, 300);

// مثال على الاستخدام
async function exampleUsage() {
  // سينفذ فقط الاستدعاء الأخير بعد 300 ميلي ثانية من عدم وجود استدعاءات جديدة
  debouncedFetchData('query1');
  debouncedFetchData('query2');
  debouncedFetchData('query3');
  
  // الانتظار كفاية لرؤية النتيجة
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('Only query3 should have been executed');
}

// لتشغيل المثال (إذا كان هذا الملف هو النقطة الرئيسية)
// exampleUsage().catch(console.error);
