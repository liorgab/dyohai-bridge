# Base44 Components - הוראות העתקה

## מטרת התיקייה

הקבצים בתיקייה זו הם **רכיבי React** שחיים בתוך אפליקציית Base44 SaaS שלך.
Base44 לא מאפשרת התקנה אוטומטית של רכיבים מבחוץ - חייבים להעתיק כל קובץ ידנית
דרך עורך הקוד שלהם.

> **למה זה לא אוטומטי?** Base44 הוא SaaS סגור. אין להם API פתוח להעלאת קוד.

---

## הקבצים בתיקייה

| קובץ | יעד ב-Base44 | מטרה |
|------|--------------|------|
| `BulkSendModal.jsx` | `src/components/work-schedule/BulkSendModal.jsx` | **המודאל המשודרג** של שליחה המונית בסידור - עם תמיכה ב-Daemon, smart defaults, אזהרות עלות. **הקובץ העיקרי שנוצר בעדכון הזה.** |
| `SendWhatsAppButton.jsx` | `src/components/employees/SendWhatsAppButton.jsx` | כפתור שליחה יחידה לעובד בודד - עובד דרך ה-Extension בכרום הרגיל |
| `DownloadVisaButton_v3_extension.jsx` | `src/components/employees/DownloadVisaButton.jsx` | הורדת ויזת מעסיק (PIBA) - דרך 2FA |
| `InterVisaDownloadButton.jsx` | `src/components/employees/InterVisaDownloadButton.jsx` | הורדת אינטר ויזה (PIBA) - public endpoint |
| `BulkWhatsAppDialog.jsx` | (legacy - לא להעתיק אם יש BulkSendModal) | הגרסה הישנה של הדיאלוג - **לא מומלץ להשתמש** |
| `piba_countries.json` | `src/data/piba_countries.json` | מיפוי 176 מדינות → numeric_codes של PIBA |

---

## איך מעתיקים קובץ ל-Base44 (צעד-אחר-צעד)

1. **פתח את Base44** בדפדפן והיכנס לאפליקציית "ד.יוחאי" (או הפרויקט שלך)
2. בתפריט העליון: **Code Editor** (או "עורך קוד")
3. נווט בעץ הקבצים בצד שמאל לנתיב היעד שמופיע בטבלה למעלה
4. אם הקובץ **קיים**: פתח אותו → סמן הכל (Ctrl+A) → מחק → הדבק את התוכן החדש
5. אם הקובץ **לא קיים**: לחץ "New File" → תן את השם המתאים → הדבק את התוכן
6. **שמור** (Ctrl+S)
7. עבור לקובץ הבא ותחזור על התהליך

---

## סדר ההעתקה המומלץ (אם זה התקנה ראשונה)

עשה את זה בסדר הזה, כי יש תלויות:

### שלב 1: מבני נתונים בסיסיים
1. `piba_countries.json` → קובץ נתונים, קודם

### שלב 2: רכיבי שליחה יחידה (Single send via Extension)
2. `SendWhatsAppButton.jsx`
3. `DownloadVisaButton_v3_extension.jsx`
4. `InterVisaDownloadButton.jsx`

### שלב 3: רכיב שליחה המונית (Bulk via Daemon) - **המודאל המשודרג**
5. `BulkSendModal.jsx`

### שלב 4: בדיקה
- רענן את Base44 (F5)
- פתח את DevTools (F12) → Console
- בדוק שאין errors אדומים
- נסה להפעיל את המודאל "שליחה המונית" - אמור להופיע ה-UI החדש

---

## תלויות (אם משהו לא עובד)

הרכיבים מסתמכים על:

### Imports שצריכים להיות קיימים ב-Base44:
```javascript
import { base44 } from '@/api/base44Client';                    // ה-SDK של Base44
import { Dialog, DialogContent, ... } from '@/components/ui/dialog';   // shadcn/ui
import { Button, Card, Badge, Alert, ... } from '@/components/ui/...';
import { Send, CheckCircle, ... } from 'lucide-react';          // אייקונים
import { format } from 'date-fns';                              // ספריית תאריכים
import { toast } from 'sonner';                                 // הודעות
```

### Service files שאמורים להתקיים:
- `@/services/sendWorkScheduleViaDaemon.js` - השירות שמכין payload לדימון

### Backend functions שצריכות להיות deployed:
- `sendWorkScheduleMessages` - שליחה דרך Twilio
- (השירות לדימון לא דורש backend function - רץ ישירות מול הדימון בלוקאל)

### Entities שצריכות להכיל את השדות:
- `Employee`: `phone_whatsapp_e164`, `employee_language`, `employee_external_id`
- `WorkSchedule`: `sending_log` (text field)
- `WorkScheduleRow`: `notify_worker`, `message_template_id`, `message_status`, `message_language`

---

## עדכון רכיב קיים

כשמגיע עדכון חדש, ה-`update.ps1` יציג לך diff. אבל באופן ידני:

1. הורד את הגרסה החדשה של הקובץ מ-`base44-components/`
2. השווה לגרסה הקיימת ב-Base44 (לדוגמה: דרך VS Code "Compare Files")
3. החלט אם יש שינויים מקומיים שביצעת ב-Base44 שאתה רוצה לשמר
4. הדבק את הגרסה החדשה (או מיזוג ידני אם יש שינויים מקומיים)
5. שמור + רענן + בדוק

---

## פתרון בעיות נפוצות

**❌ "import error: ... not found"**
→ ספריית UI חסרה. ודא ש-shadcn/ui מותקן ב-Base44 או החלף את ה-imports בערכים חלופיים.

**❌ "window.__base44Bridge is not defined"**
→ ה-Extension לא טעון או הדף לא ב-base44.app/.com domain. בדוק ב-`chrome://extensions/`.

**❌ "Daemon לא מחובר" במודאל**
→ ה-Daemon לא רץ. הפעל את הקיצור "D.Yohai Bulk Sender" על שולחן העבודה. או בדוק `doctor.ps1`.

**❌ ההודעה נשלחת מפורקת לכמה שורות**
→ באג ידוע שתוקן בגרסה 1.0.0+. ודא שהדימון מעודכן (`update.ps1`).
