# Base44 Bridge Native Helper

עוטף את ה-Chrome Extension עם יכולת OS-level - בדיוק כמו VBA Selenium.

## למה זה קיים

Chrome Extensions לא יכולים לגשת לדיאלוגים של מערכת ההפעלה (כמו חלון "בחר קובץ" שנפתח כשלוחצים "Document" ב-WhatsApp). WhatsApp Blaster VBA עוקף את זה דרך `Application.SendKeys` שפועלת ברמת Windows - זה מה ש-Helper הזה עושה: תוכנית Python קטנה שהExtension מפעילה, שיודעת להעתיק ל-clipboard ולשלוח Ctrl+V + Enter לכל חלון.

## התקנה (חד-פעמי, ~2 דקות)

### דרישות מוקדמות
- **Python 3.8+** מותקן ב-Windows עם "Add to PATH"
  - הורדה: https://www.python.org/downloads/
  - בהתקנה: ☑ Add Python to PATH
- **Chrome** מותקן (Google Chrome שאתה משתמש בו עכשיו)

### שלב 1: מצא את Extension ID
1. `chrome://extensions/`
2. מצא את הכרטיס "Base44 Bridge"
3. **העתק את ה-ID** (נראה משהו כמו `pgldaakahpcnofopcaglfppigpngpkol`)

### שלב 2: הרץ את ההתקנה
פתח PowerShell (לא כ-Admin - לא צריך) ותקליד:

```powershell
cd "C:\Users\liorg\Documents\Claude\Projects\חיבור להנפקת מסמך ויזה\piba-bridge-extension\native-helper"
.\install.ps1 -ExtensionId "<ID_שלך_מהשלב_הקודם>"
```

דוגמה:
```powershell
.\install.ps1 -ExtensionId "pgldaakahpcnofopcaglfppigpngpkol"
```

הסקריפט יעשה בשבילך:
1. ✓ בדיקה ש-Python מותקן
2. ✓ התקנת ספריות Python נדרשות (pywin32, pyautogui)
3. ✓ יצירת Native Messaging Manifest עם הנתיבים הנכונים
4. ✓ רישום ב-Registry של Chrome (HKCU - לא דורש Admin)

### שלב 3: רענן Chrome
1. **סגור את Chrome לגמרי** (כל החלונות) ופתח מחדש - זה חשוב! Chrome טוען Native manifests רק בהפעלה
2. `chrome://extensions/` → רענן את Base44 Bridge (↻)

### שלב 4: בדוק התקנה
בתוך Base44 app, פתח DevTools (F12) → Console, והרץ:
```javascript
chrome.runtime.sendMessage({ type: 'NATIVE_PING' }, console.log)
```
אם הכל תקין, תקבל:
```
{success: true, pong: true, version: "1.0.0", python: "3.11.0", win_ready: true}
```

---

## איך זה עובד (טכנית)

```
┌─────────────────┐  postMessage   ┌──────────────┐  Registry    ┌─────────────────┐
│ Chrome Extension│◄──────────────►│   Chrome     │ lookup HKCU  │ Native Manifest │
│ (background.js) │                │   (parent)   │◄────────────►│ (JSON)          │
└─────────────────┘                └──────┬───────┘              └─────────────────┘
                                          │ spawn child
                                          ▼
                                   ┌──────────────┐
                                   │ Helper .py   │  stdin ← JSON from Chrome
                                   │ (pywin32 +   │  stdout → JSON to Chrome
                                   │  pyautogui)  │
                                   └──────┬───────┘
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                      clipboard (CF_UNICODETEXT)  SendInput (Ctrl+V, Enter)
                                                 → focused window = WA file dialog
```

## פרוטוקול הודעות

### `ping`
```json
{"action": "ping"}
→ {"success": true, "pong": true, ...}
```

### `save_file`
```json
{"action": "save_file", "file_base64": "JVBERi0xLjc...", "filename": "visa.pdf"}
→ {"success": true, "file_path": "C:\\Users\\...\\TEMP\\base44_bridge\\visa.pdf"}
```

### `paste_path`
```json
{"action": "paste_path", "file_path": "C:\\...\\visa.pdf", "pre_delay_ms": 500}
→ {"success": true}
```
שים לב: חייבים לקרוא לזה **רק** אחרי שחלון בחירת הקובץ של WhatsApp נפתח ומוקד. ה-helper יעתיק את הנתיב ל-clipboard, יחכה 500ms, ישלח Ctrl+V, יחכה 300ms, ישלח Enter.

### `attach_full` (פעולה משולבת)
```json
{"action": "attach_full", "file_base64": "...", "filename": "visa.pdf", "wait_before_paste_ms": 800}
```
שומר + מחכה + מדביק בבת אחת.

### `cleanup`
```json
{"action": "cleanup"}
→ {"success": true, "removed": 3}
```
מוחק קבצים זמניים שנשמרו ב-TEMP.

---

## הסרת התקנה

```powershell
cd "C:\Users\liorg\Documents\Claude\Projects\חיבור להנפקת מסמך ויזה\piba-bridge-extension\native-helper"
.\uninstall.ps1
```

## פתרון בעיות

### "python לא נמצא"
התקן Python מ-https://www.python.org/downloads/ עם ☑ "Add Python to PATH".

### "NATIVE_DISCONNECTED" או "Specified native messaging host not found"
1. סגרת Chrome לגמרי ופתחת מחדש אחרי install.ps1?
2. Extension ID שעברת להתקנה תואם את ה-ID של ה-Extension שמותקן?
3. בדוק ב-Registry: `regedit → HKCU\Software\Google\Chrome\NativeMessagingHosts\com.base44.bridge`
   - הערך ברירת המחדל צריך להצביע על `%LOCALAPPDATA%\Base44Bridge\com.base44.bridge.json`

### "Permission denied" ב-pip install
פתח PowerShell כ-Administrator פעם אחת ובצע `python -m pip install --user pywin32 pyautogui`.

### לוגים של שגיאות של ה-helper
- `%TEMP%\base44_bridge_native.log` - נכתב על כל crash של ה-helper
- `%TEMP%\base44_bridge_wait_and_paste.log` - **חדש ב-v1.2.1** - לוג מפורט של כל פעולת `wait_and_paste` (זיהוי דיאלוג, SetForegroundWindow, WM_SETTEXT/Ctrl+V/typewrite, Enter). אם משלוח PDF נכשל, זה הקובץ לבדוק.

לפתיחה מהירה:
```powershell
notepad "$env:TEMP\base44_bridge_wait_and_paste.log"
```

## אבטחה

- ה-helper **רק מגיב** לפקודות מה-Extension - לא מפעיל התקפה עצמאית
- Extension ID בודק שהמקור חוקי (`allowed_origins`)
- הקבצים נשמרים ב-`%TEMP%\base44_bridge\` ונמחקים עם `cleanup`
- אין חיבור לרשת מה-helper
- הקוד פתוח בפנים (`base44_native_helper.py`) - ניתן לעיין ולבדוק

---

## תרומה/שיפורים

קובץ Python הוא קוד פתוח - ניתן לשפר/להרחיב. הארכיטקטורה תומכת בפעולות עתידיות:
- SendKeys ידני לכל חלון
- Screenshot של חלון (לבדיקה אוטומטית של מה שקורה)
- שילוב עם clipboard לטקסט ולא רק לקבצים
