# Base44 Bridge - Chrome Extension

תוסף Chrome שמחבר את Base44 לאתרי רשות האוכלוסין (PIBA) ו-HopOn.

## מה זה עושה

1. **סנכרון טוקן PIBA אוטומטי** - ברגע שאתה מתחבר לאתר PIBA, התוסף קולט את ה-authToken (JWT) ושומר אותו באחסון של התוסף.
2. **סנכרון טוקן HopOn** - אותו דבר עבור HopOn.
3. **גישור ל-Base44** - דף Base44 יכול לקרוא ל-`window.__base44Bridge.fetchPibaVisa(foreignKey)` והתוסף מבצע את הקריאה ל-PIBA ומחזיר את ה-PDF.

## למה התוסף נדרש

אתר PIBA בודק **TLS fingerprint** של הבקשה - שיטה שמזהה "בוטים" גם אם כל ה-headers נכונים. שרתי Base44 (Deno) נחסמים בבדיקה הזו. אבל דפדפן Chrome אמיתי עובר - אז התוסף מפעיל את הקריאות מה-Chrome שלך ומעביר את ה-PDF ל-Base44.

## התקנה

### שלב 1: הורד/שכפל את התיקייה

תוודא שיש לך את כל הקבצים בתיקייה אחת:

```
piba-bridge-extension/
├── manifest.json
├── background.js
├── content-piba.js
├── content-hopon.js
├── content-base44.js
├── page-bridge.js
├── popup.html
├── popup.js
└── icons/
    ├── 16.png
    ├── 48.png
    └── 128.png
```

### שלב 2: טען את התוסף ב-Chrome

1. פתח את Chrome וגש לכתובת: `chrome://extensions/`
2. הפעל את המתג **Developer mode** (פינה ימנית למעלה)
3. לחץ על **Load unpacked**
4. בחר את התיקייה `piba-bridge-extension/`
5. אמור להופיע כעת התוסף "D.Yohai Bridge - PIBA & HopOn" ברשימה

### שלב 3: קבע הרשאות

וודא שהתוסף מופיע ב-extensions bar (סמל הפאזל ⊕ בדפדפן). הצמד אותו (📌) לגישה מהירה.

### שלב 4: התחבר ל-PIBA פעם אחת

1. לחץ על סמל התוסף → לחץ "פתח את PIBA"
2. התחבר עם ת.ז. + סיסמה + SMS 2FA
3. פתח שוב את התוסף - אמור להופיע "✅ טוקן תקף"

### שלב 5: עדכן את Base44

1. החלף את הקובץ `components/employees/DownloadVisaButton.jsx` בקוד מ-`DownloadVisaButton_v3_extension.jsx`
2. **אין צורך** ב-backend function - אפשר למחוק את `functions/downloadPibaVisa.js`
3. Deploy את השינויים

## איך זה עובד (בפנים)

```
┌────────────────────────────────────────────────────────────────┐
│ הדפדפן שלך (Chrome)                                            │
│                                                                │
│ ┌─────────────┐                 ┌────────────────────────┐     │
│ │ טאב PIBA    │◄─sync authToken→│ chrome.storage.local   │     │
│ │ (מחובר)     │                 │  • piba_token          │     │
│ └─────────────┘                 │  • piba_token_exp      │     │
│                                 │  • hopon_token         │     │
│ ┌─────────────┐                 └────────────────────────┘     │
│ │ טאב Base44  │                          │                    │
│ │             │                          ▼                    │
│ │ לחיצה על    │    chrome.runtime   ┌────────────────────┐   │
│ │ "הורד ויזה" │◄──messaging────────►│ background.js      │   │
│ └──────┬──────┘                     │ (service worker)   │   │
│        │                            └───┬────────────────┘   │
│        │                                │ fetch PIBA          │
│        │                                ▼ (Chrome's TLS)      │
│        │                         ┌────────────┐              │
│        │                         │ PIBA API   │ → PDF 200 OK │
│        │                         └────────────┘              │
│        │                                │                    │
│        ◄────────── PDF base64 ──────────┘                    │
│        │                                                     │
│        ▼                                                     │
│ base44.Core.UploadFile                                       │
│ employee.update(visa_doc_url)                                │
└──────────────────────────────────────────────────────────────┘
```

## הרשאות שהתוסף מבקש

- **`storage`** - לשמור את הטוקנים באחסון המקומי של התוסף (לא localStorage רגיל)
- **`tabs`** - לפתוח טאב ל-PIBA/HopOn בלחיצה
- **`scripting`** - (רק אם נרחיב פונקציונליות בעתיד)
- **Host permissions:**
  - `inforhub.piba.gov.il` - לסנכרון טוקן ולקריאות API
  - `b2b-dashboard.hopon.co` - לסנכרון טוקן HopOn
  - `api-gateway.hopon.co` - לקריאות HopOn
  - `*.base44.app`, `app.base44.com` - לגישור עם הדף של Base44

## אבטחה

- **הטוקנים נשמרים רק באחסון המקומי של Chrome** (chrome.storage.local), לא מועברים לשום שרת
- **אין תקשורת אחורה ל-Base44** מהתוסף - רק הדף של Base44 מבקש מידע מהתוסף דרך postMessage
- **הקוד פתוח** - כל הקבצים ב-JS ברור, אין obfuscation
- **אין analytics/telemetry**

## עדכון גרסאות

כשיוצא תיקון/עדכון:
1. החלף את הקבצים בתיקייה
2. ב-`chrome://extensions/` לחץ על כפתור הרענון (↻) ליד התוסף
3. אם שינו את manifest - Chrome ידרוש טעינה מחדש

## פתרון בעיות

### "אין טוקן" למרות שאתחבר ל-PIBA

- פתח את Dev Tools (F12) בטאב של PIBA → Console
- חפש לוג `[Base44 Bridge/PIBA]`
- אם לא מופיע - התוסף לא רץ שם. בדוק ב-`chrome://extensions/` שהוא פעיל

### "הטוקן פג תוקף" מיד אחרי התחברות

- הטוקן חי 30 דקות. אם עברו יותר - זו התנהגות נורמלית, התחבר מחדש
- אם זה קורה מיד - בדוק שהשעון של המחשב מכוון

### Base44 מראה "דרושה התקנה של Extension" למרות שהתקנת

- הדף של Base44 נטען לפני שהתוסף הספיק להזריק את `window.__base44Bridge`
- רענן את הדף (F5) אחרי הלחיצה על הכפתור
- וודא שהתוסף רץ באותו פרופיל של Chrome

### בפיתוח: איך לדבג

1. **Service Worker:** `chrome://extensions/` → לחץ על התוסף → "Inspect views: service worker"
2. **Content scripts:** DevTools של הטאב הרלוונטי (F12 → Console)
3. **Storage inspection:** DevTools של התוסף → Application → Storage → Extension storage

## הפצה לעובדים אחרים בתאגיד

לגרסה פנימית (עד 10 משתמשים בערך):
1. Zip של התיקייה
2. שלח קישור להורדה + הוראות התקנה
3. כל משתמש יבצע "Load unpacked"

לגרסה רשמית (Chrome Web Store):
1. רישום מפתח חינם ($5 חד-פעמי)
2. העלאת ה-zip + צילומי מסך + תיאור
3. סקירה של Google (~1-3 ימים)
4. קישור קבוע - התקנה בלחיצה

## רישיון

פנימי לתאגיד ד. יוחאי. אין להפיץ ללא אישור.
