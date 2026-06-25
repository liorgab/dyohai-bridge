# D.Yohai Bridge

**מערכת אינטגרציה היברידית לאפליקציית ניהול עובדים זרים ב-Base44**
מחבר את Base44 לרשות האוכלוסין (PIBA), HopOn, ו-WhatsApp Web (יחיד + המוני).

**גרסה נוכחית:** 1.4.1
**תאריך עדכון:** 09/05/2026

---

## מה יש בפנים

| רכיב | מה הוא עושה |
|---|---|
| **`extension/`** | Chrome Extension - גשר בין Base44 ל-PIBA/HopOn/WhatsApp רגיל. שליחה יחידה + הורדת ויזות. |
| **`daemon/`** | Python Daemon - שרת מקומי על port 8765 עם Selenium + Chrome for Testing לשליחה המונית של עד 150 הודעות ביום, חינם. |
| **`base44-components/`** | קבצי `.jsx` להעתקה לעורך הקוד של Base44 - מודאל שליחה המונית, כפתורי ויזה וכו'. |
| **`install.ps1`** | מתקין Python + Chrome for Testing + ChromeDriver + הדימון - הכל אוטומטי, ללא הרשאות מנהל. |
| **`doctor.ps1`** | סקריפט אבחון + תיקון אוטומטי. **מומלץ להריץ אחרי כל עדכון Windows.** |
| **`update.ps1`** | משיכת גרסה חדשה מ-GitHub + עדכון מקומי. |
| **`uninstall.ps1`** | הסרה נקייה. |

---

## דרישות מערכת

- Windows 10 (build 1809+) או Windows 11
- חיבור אינטרנט להתקנה הראשונית (~250MB הורדה)
- חשבון WhatsApp פעיל (לסריקת QR פעם אחת בלבד)
- חשבון Base44 עם גישה לאפליקציה

> ⚠️ **לא צריך הרשאות מנהל** ברוב המקרים. רק auto-start ב-Task Scheduler עשוי לדרוש Administrator (אבל ירוץ גם בלי).

---

## התקנה על מחשב חדש - 3 צעדים

### 1️⃣ העתק את התיקייה למחשב היעד

העתק את התיקייה `dyohai-bridge` (גודל ~1.5MB ללא תלויות חיצוניות) למחשב החדש.
מקומות מומלצים:
```
C:\Users\<USER>\Documents\dyohai-bridge\
```
או:
```
C:\Tools\dyohai-bridge\
```

### 2️⃣ הרץ את ההתקנה

לחץ ימני על `install.ps1` → **"Run with PowerShell"**.
או בטרמינל:
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

ההתקנה תבצע אוטומטית:
- ✅ התקנת Python 3.12 (אם חסר)
- ✅ התקנת חבילות Python (selenium, flask, flask-cors, requests, pyperclip)
- ✅ הורדת Chrome for Testing + ChromeDriver
- ✅ העתקת הדימון ל-`%LOCALAPPDATA%\Base44BulkSender\`
- ✅ יצירת קיצור-דרך בשולחן העבודה
- ✅ רישום auto-start ב-Task Scheduler (הדימון יעלה אוטומטית בכל login)
- ✅ פתיחת חלון הוראות לטעינת Chrome Extension

זמן התקנה: כ-5 דקות (תלוי במהירות אינטרנט).

### 3️⃣ טען את ה-Extension ל-Chrome (פעם אחת, ידני)

ההתקנה תפתח את `chrome://extensions/` עם הוראות. עקוב:

1. הפעל **"מצב מפתח" / "Developer mode"** (toggle בפינה ימין-עליון)
2. לחץ **"Load unpacked"**
3. בחר את התיקייה: `dyohai-bridge\extension\`
4. תראה: **D.Yohai Bridge - PIBA, HopOn & WhatsApp** ✅

### 4️⃣ סרוק QR לחיבור WhatsApp (פעם אחת)

- לחץ Double-click על "D.Yohai Bulk Daemon" בשולחן העבודה (או חכה 30 שניות מ-login)
- ייפתח Chrome for Testing עם WhatsApp Web
- סרוק את ה-QR מהטלפון
- מעתה אילך - WhatsApp יישאר מחובר

---

## תחזוקה שוטפת

### אחרי כל עדכון Windows
**הרץ פעם אחת:** Double-click על "D.Yohai Doctor" בשולחן העבודה.
הוא יבדוק 7 דברים ויתקן את מה שניתן אוטומטית (חבילות Python שנמחקו, קיצור-דרך שנעלם וכו').

### אחרי בעיה בלתי צפויה
1. תריץ "D.Yohai Doctor"
2. אם נשארו פעולות ידניות - הוא יציג אותן בצבע סגול עם הוראה ברורה
3. אם זה לא פותר - בדוק `docs/TROUBLESHOOTING.md`

### עדכון לגרסה חדשה
- אם משתמש ב-GitHub: הרץ `update.ps1` (יבצע git pull ויסנכרן)
- אם לא: העתק את התיקייה החדשה ידנית והרץ doctor.ps1

---

## הסרת המערכת

הרץ `uninstall.ps1` (לחיצה ימנית → Run with PowerShell).
הוא יסיר:
- הדימון מ-`%LOCALAPPDATA%\Base44BulkSender\`
- הקיצורי-דרך
- ה-Task Scheduler entry
- (לא נוגע ב-Python או Chrome עצמם)

לאחר מכן:
- הסר את ה-Extension מ-Chrome ידנית (`chrome://extensions/` → Remove)
- מחק את התיקייה `dyohai-bridge\` ידנית

---

## מבנה תיקיות מותקנות (לאחר התקנה)

| תיקייה | תוכן |
|---|---|
| `%LOCALAPPDATA%\Base44BulkSender\` | הדימון Python שרץ + ChromeDriver |
| `%LOCALAPPDATA%\Base44ChromeTest\` | Chrome for Testing + פרופיל WhatsApp |
| `%TEMP%\base44_bulk_daemon.log` | לוג הדימון (לדיאגנוסטיקה) |
| `Desktop\D.Yohai Bulk Daemon.lnk` | קיצור-דרך להפעלה ידנית |
| `Desktop\D.Yohai Doctor.lnk` | קיצור-דרך לתחזוקה |

---

## ארכיטקטורה

ראה `docs/ARCHITECTURE.md` לתיאור מלא.

**בקצרה:** המערכת היא 2 רכיבים:
- **Chrome Extension** - על Chrome הרגיל של המשתמש. מטפל בPIBA + HopOn + WhatsApp שליחה יחידה.
- **Python Daemon** - על Chrome for Testing נפרד. מטפל בשליחה המונית בלי דיאלוגי משתמש.

הכרום הרגיל (עם Bridge Extension) **שולח HTTP ל-localhost:8765** של הדימון לבקשות שליחה המונית.

---

## תיעוד נוסף

- `docs/ARCHITECTURE.md` - ארכיטקטורה טכנית מלאה
- `docs/TROUBLESHOOTING.md` - פתרונות לבעיות נפוצות
- `docs/RELEASES.md` - היסטוריית גרסאות
- `PUBLISH_TO_GITHUB.md` - הוראות לדחיפה לריפו פרטי
- `base44-components/README.md` - איך להעתיק את הרכיבים ל-Base44

---

## תמיכה

מי שמתחזק את המערכת: ליאור גבאי (`liorgab@gmail.com`)
פרויקט פנימי, לא להפצה ציבורית.
