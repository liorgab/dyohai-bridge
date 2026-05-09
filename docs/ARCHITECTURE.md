# Architecture - Base44 Bridge

מסמך זה מתאר את הארכיטקטורה הטכנית המלאה של המערכת.
לקריאה מהירה ראה [README הראשי](../README.md).

---

## 1. סקירה - 3 שכבות נפרדות

המערכת בנויה כשלוש שכבות עצמאיות:

| שכבה | פלטפורמה | תפקיד |
|---|---|---|
| **A. Base44** (SaaS) | React app בענן | UI, Database, מקור האמת |
| **B. Chrome Extension** | Chrome רגיל של המשתמש | גשר Base44↔PIBA/HopOn/WA + שליחה יחידה |
| **C. Bulk Daemon** | Python+Selenium+CfT לוקאלי | שליחה המונית אוטומטית מלאה |

---

## 2. למה 3 שכבות ולא 1?

### למה לא לעשות הכל ב-Base44 backend?
- **TLS Fingerprinting**: PIBA חוסם בקשות מ-Deno/server (JA3/JA4 fingerprint). חייב Chrome אמיתי.
- **WhatsApp Web**: דורש סשן מתמשך עם cookies. לא מתאים ל-stateless backend.
- **Cost**: WhatsApp דרך Twilio = ~₪0.18/הודעה. WA Web automation = חינם.

### למה לא לעשות הכל ב-Extension?
- **User activation barrier**: Chrome חוסם `<input type=file>` programmatic clicks. חייב לחיצה אנושית.
- **Concurrent sessions**: רוצים לשלוח 150 הודעות ברקע בלי שהמשתמש יראה.
- **Anti-detection**: Chrome רגיל מזוהה ע"י WA כ-automation אם משחקים יותר מדי עם DOM.

### הפתרון - Chrome for Testing
Google מספקת build נפרד של Chrome **מותר עבור automation**:
- אבטחת user-activation **מרוככת רשמית**
- `file_input.send_keys(path)` עובד בלי דיאלוג OS
- בנוי במיוחד ל-Selenium

זה הסוד מאחורי שליחה המונית של PDF בלי לחיצות ידניות.

---

## 3. Component A - Chrome Extension

### מבנה
```
extension/
├── manifest.json              MV3, host_permissions לכל הדומיינים
├── background.js              Service Worker - 700+ שורות
├── content-piba.js            רץ על inforhub.piba.gov.il - sync 2FA token
├── content-hopon.js           רץ על b2b-dashboard.hopon.co - sync token
├── content-whatsapp.js        v4.10 - keyboard nav + native helper for PDF
├── content-base44.js          גשר בין Base44 ל-background
├── page-bridge.js             מוזרק למיין-world של Base44
├── popup.html / popup.js      ממשק סטטוס (4 כרטיסיות)
├── icons/                     16/48/128
└── native-helper/             תת-מערכת ל-Native Messaging (PDF dialog)
```

### API חשוף ל-Base44 (`window.__base44Bridge`)

```javascript
// PIBA Employer Visa (with 2FA)
await window.__base44Bridge.fetchPibaVisa(foreignKey)
// foreignKey = `${country.numeric_code}_${employee.passport_no}`

// PIBA Inter Visa (no auth!)
await window.__base44Bridge.fetchPibaInterVisa(foreignKey)

// HopOn
await window.__base44Bridge.getHopOnToken()

// WhatsApp single send (1 manual click for PDF)
await window.__base44Bridge.openWhatsAppChat(phone, message, autoSend, options)

// Bulk Sender (forwards to localhost daemon)
await window.__base44Bridge.getBulkDaemonStatus()
await window.__base44Bridge.openBulkWhatsApp()
await window.__base44Bridge.startBulkSend(payload)
window.__base44Bridge.subscribeBulkProgress(jobId, onEvent, onComplete)
await window.__base44Bridge.stopBulkSend(jobId)
```

### Communication flow

```
Base44 React code
       ↓ window.postMessage
page-bridge.js (MAIN world, has access to window)
       ↓ window.postMessage
content-base44.js (ISOLATED world)
       ↓ chrome.runtime.sendMessage
background.js (Service Worker)
       ↓ chrome.tabs.sendMessage / fetch
content-whatsapp.js / fetch to localhost:8765
       ↓
WhatsApp Web / PIBA / HopOn / Daemon
```

---

## 4. Component B - Bulk Sender Daemon

### Stack
- **Python 3.8+** - runtime
- **Flask** - HTTP server על `localhost:8765`
- **flask-cors** - CORS permissive (localhost-only, לא נחשף לאינטרנט)
- **Selenium** - automation
- **Chrome for Testing** - browser
- **ChromeDriver** - WebDriver bridge

### Endpoints

| Method | Path | תפקיד |
|---|---|---|
| GET | `/status` | סטטוס דימון + WA login state |
| POST | `/open_whatsapp` | פתיחת Chrome Test (לסריקת QR ראשונית) |
| POST | `/bulk_send` | התחלת job של שליחה המונית - returns job_id |
| GET | `/progress/<job_id>` | SSE stream של התקדמות |
| POST | `/stop/<job_id>` | עצירת job פעיל |
| POST | `/shutdown` | סגירה מסודרת של הדימון + Chrome Test |

### State management
- **Persistent profile**: `%LOCALAPPDATA%\DYohaiBulkSender\profile\` - WA session נשמר
- **Singleton driver**: רק instance אחד של Chrome Test בו-זמנית
- **Job lock**: רק bulk job אחד יכול לרוץ בזמן נתון
- **Orphan kill**: לפני יצירת driver חדש, הורג Chrome Test יתום (אחרי restart של דימון)

### File handling
לקבצים מצורפים (PDF):
1. Base64 מגיע ב-payload של `/bulk_send`
2. הדימון מפענח ושומר ל-`%TEMP%\dyohai_bulk\{filename}`
3. `selenium.find_element('input[type=file]').send_keys(path)` - **ללא דיאלוג**
4. אחרי השליחה הקובץ נשאר עד restart (cleanup ב-temp)

### Anti-ban features
- השהיה אקראית 20-40 שניות בין הודעות (configurable)
- Daily cap של 150 הודעות
- זיהוי מספר לא תקף (popup detection)
- שמירת number_invalid כ-failed (לא עוצר את הbatch)

### Multi-line message fix (v1.0.0)
**הבעיה הקריטית שתוקנה:** `\n` בטקסט = Enter ב-WA = שליחה. ההודעה התפרקה.

**הפתרון:** Helper function `_type_with_newlines` שמפצלת את הטקסט לפי `\n` ובין כל שורה שולחת **Shift+Enter** (=שורה חדשה רכה ללא שליחה). בסוף Enter יחיד שמשגר את ההודעה השלמה.

```python
def _type_with_newlines(driver, text):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    lines = text.split('\n')
    actions = ActionChains(driver)
    for i, line in enumerate(lines):
        if line:
            actions.send_keys(line)
        if i < len(lines) - 1:
            actions.key_down(Keys.SHIFT).send_keys(Keys.ENTER).key_up(Keys.SHIFT)
    actions.perform()
```

---

## 5. Component C - Base44 Components

### עץ הקבצים שצריך להיות ב-Base44

```
src/
├── components/
│   ├── work-schedule/
│   │   └── BulkSendModal.jsx           ★ העיקרי - שליחה המונית
│   ├── employees/
│   │   ├── SendWhatsAppButton.jsx      ★ שליחה יחידה
│   │   ├── DownloadVisaButton.jsx      ★ ויזה רגילה (2FA)
│   │   └── InterVisaDownloadButton.jsx ★ אינטר ויזה (public)
│   └── ui/                              shadcn/ui components
├── services/
│   └── sendWorkScheduleViaDaemon.js    Service ש-Modal קורא לו
├── data/
│   └── piba_countries.json             176 מדינות
└── api/
    └── base44Client.js                 ה-SDK של Base44
```

### Smart defaults במודאל
ב-v1.0.0 שונתה ברירת המחדל של מנוע השליחה:
1. אם הדימון רץ + מחובר → ברירת מחדל = `wa_daemon` (חינם)
2. אם הדימון לא זמין → ברירת מחדל = `twilio` (~₪0.18/הודעה)
3. אם > 100 הודעות + הדימון לא זמין → אזהרת עלות בולטת
4. כפתור "פתח Chrome Test לסריקת QR" מופיע אוטומטית כשהדימון רץ אבל לא מחובר

---

## 6. Data structures (Base44 entities)

### Employee
```javascript
{
  passport_no: "FA0313274",          // → PIBA visa lookup
  nationality_code: "UZ",            // ISO 2-letter → Country.code
  phone_whatsapp_e164: "+972...",    // WA send target
  phone_whatsapp: "0529454547",      // backup
  visa_doc_url: null,                // Employer visa PDF
  inter_visa_doc_url: null,          // Inter Visa PDF
  inter_visa_downloaded_at: null,
  visa_issue_date, visa_expiry, visa_type,
  first_name_he, last_name_he, full_name, apartment_name,
  employee_language: "he|en|si|th|hi|zh|uz|ro",
  employee_external_id: "101"
}
```

### Country
```javascript
{
  code: "IN",           // ISO 2-letter
  numeric_code: 110     // PIBA's numeric (NOT ISO 3166)
}
```

### WorkSchedule + WorkScheduleRow
```javascript
WorkSchedule: {
  id, period_start, period_end,
  sending_log: "free text - לוג של השליחה האחרונה"
}

WorkScheduleRow: {
  id, schedule_id, employee_id,
  notify_worker: true,
  message_template_id, message_language,
  message_status: 'Draft|Sent|Delivered|Read|Failed'
}
```

---

## 7. Local file system layout

אחרי התקנה מלאה:

```
%LOCALAPPDATA%\
├── DYohaiBridge\                    Install metadata + helper scripts
│   ├── install.json
│   ├── update.ps1
│   ├── doctor.ps1
│   └── uninstall.ps1
│
├── DYohaiBulkSender\                Daemon
│   ├── wa_bulk_daemon.py
│   ├── chromedriver.exe
│   ├── config.json
│   ├── start_daemon.bat
│   ├── start_daemon_hidden.vbs
│   └── profile\                     Chrome Test profile (WA session)
│
└── DYohaiChromeTest\                Chrome for Testing
    └── chrome-win64\
        └── chrome.exe

%APPDATA%\
└── DYohaiNativeHelper\              Native Messaging Helper (PDF dialog)
    ├── base44_native_helper.py
    └── manifest.json

%TEMP%\
├── dyohai_install.log
├── dyohai_bulk_daemon.log
└── dyohai_bulk\                     שמירת מצורפים בזמן ריצה
    └── {filename}.pdf
```

---

## 8. Security model

### Network exposure
- **הדימון מאזין רק על 127.0.0.1** - לא נחשף לאינטרנט
- CORS מאופשר לכל ה-origins כי בכל מקרה רק localhost יכול להגיע
- WA session cookies נשמרים בפרופיל מקומי בלבד

### Permissions
- ה-Extension מבקש `nativeMessaging` - רק לטיפול בדיאלוג של PDF (legacy)
- אין שמירה של credentials ב-localStorage או sync storage
- PIBA token נשמר ב-`chrome.storage.session` - מתאפס בכל הפעלה של הדפדפן
- HopOn token משוכפל אוטומטית כשנכנסים לדף

### What's NOT in this repo
- אין API keys, אין סודות, אין credentials
- אין נתוני משתמש (Employee data חי ב-Base44 ענן)
- ה-WA session cookies לא מועברים ל-git (`.gitignore` מסנן את `profile/`)

---

## 9. Performance characteristics

| פעולה | זמן | הערות |
|---|---|---|
| התקנה ראשונית | 3-5 דק' | רובו הורדה (~250MB) |
| הפעלת דימון | <2 שניות | בלי Chrome Test |
| הפעלת Chrome Test | 5-8 שניות | פעם ראשונה איטית יותר |
| שליחה יחידה (טקסט) | ~3 שניות | פלוס 0.5s לכל \n |
| שליחה יחידה (PDF) | ~6 שניות | upload ל-WA |
| שליחה המונית 50 איש | ~25 דקות | ~30s/הודעה ממוצע |
| שליחה המונית 150 איש | ~75 דקות | מקסימום יומי |

### RAM
- דימון בלבד: ~50MB
- + Chrome Test: ~250MB
- + 1 טאב WA Web: ~350MB סה"כ

---

## 10. Failure modes & recovery

| כשל | תוצאה | התאוששות |
|---|---|---|
| הדימון קורס | בקשות חדשות מקבלות 500 | restart דרך הקיצור |
| Chrome Test נסגר | `driver_alive: false` | `openBulkWhatsApp()` יפתח שוב |
| WA logout | `wa_logged_in: false` | סריקת QR מחדש (פעולה ידנית) |
| מספר לא תקף | event=failed, ממשיך לבא | רושם ב-progress, לא עוצר |
| Internet down | timeout בשליחה | retry על הודעה הבאה (TODO) |
| Daily cap מוגע | `/bulk_send` מחזיר 400 | להשתמש ב-Twilio או לחכות 24h |

---

## 11. גרסאות עתידיות (Roadmap)

ראה [README הראשי](../README.md#עתיד-roadmap-לא-בקוד) - לא מתועד כאן כדי לא לכפול.
