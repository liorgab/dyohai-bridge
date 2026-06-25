# Troubleshooting - Base44 Bridge

מדריך לפתרון בעיות מסודר לפי תסמין.

---

## 🔴 בעיות התקנה

### "Python installer exited with code N"
**סיבות אפשריות:**
- בעיה בהורדה (אינטרנט נופל באמצע)
- כבר מותקנת גרסה ישנה שמתנגשת
- אנטי-וירוס חוסם

**פתרון:**
1. הורד ידנית מ-https://www.python.org/downloads/
2. סמן ✅ "Add Python to PATH"
3. בחר "Install for me only" (User-level)
4. הרץ שוב את `install.ps1`

---

### "winget is not recognized"
מצב נדיר ב-Windows 10 ישן.

**פתרון:**
1. עדכן Windows ל-build 1809 ומעלה
2. או התקן Winget מ-Microsoft Store: חפש "App Installer"
3. הרץ שוב את `install.ps1` - עכשיו הוא ימצא Python ב-fallback של python.org

---

### "Failed to download Chrome for Testing"
**אבחון:** `Test-NetConnection googlechromelabs.github.io -Port 443`

**אם המבחן נכשל:** Firewall/Proxy חוסם.

**פתרון:**
1. הוסף לרשימה הלבנה ב-Firewall:
   - `googlechromelabs.github.io`
   - `storage.googleapis.com`
   - `edgedl.me.gvt1.com`
2. אם אתה מאחורי proxy ארגוני - הגדר `$env:HTTP_PROXY` לפני ההרצה

---

### "ChromeDriver version mismatch"
ה-doctor מציג: `ChromeDriver v118 != Chrome Test v130`

**פתרון:**
```powershell
# שיטה 1: עדכון אוטומטי
.\install.ps1 -SkipPython -SkipChrome

# שיטה 2: ידני
Remove-Item "$env:LOCALAPPDATA\DYohaiBulkSender\chromedriver.exe" -Force
.\install.ps1
```

---

## 🟡 בעיות ריצה

### "Bridge Extension לא מותקן" במודאל
**זה לא תמיד האקסטנשן! המסר מטעה. סיבות:**

1. ה-Extension לא טעון בכלל
   - בדוק `chrome://extensions/` שיש "Base44 Bridge"
2. ה-Extension בגרסה ישנה (< v1.3.0)
   - לחץ על אייקון הריענון של ה-Extension
3. הדף שאתה בו לא תואם ל-`host_permissions` ב-manifest
   - בדוק ה-URL של Base44 - האם הוא `*.base44.app` / `app.base44.com`?
4. ה-Extension נטען אבל page-bridge.js לא הוזרק
   - F5 על Base44 ובדוק

**אבחון מדויק - הרץ ב-Console של Base44:**
```javascript
console.log('Bridge:', window.__base44Bridge);
console.log('Version:', window.__base44Bridge?.version);
console.log('Has Daemon API:', !!window.__base44Bridge?.getBulkDaemonStatus);
```
- אם `Bridge: undefined` → ה-Extension לא מוזרק
- אם יש Bridge אבל לא הdaemon API → גרסה ישנה, צריך לעדכן

---

### "Daemon לא רץ"
**אבחון:**
```powershell
.\doctor.ps1
```
או ב-Console:
```javascript
fetch('http://127.0.0.1:8765/status').then(r=>r.json()).then(console.log).catch(e=>console.log('OFF', e))
```

**פתרונות לפי תוצאה:**

| תוצאה | פתרון |
|---|---|
| `ERR_CONNECTION_REFUSED` | הדימון לא רץ. דאבל-קליק על קיצור "D.Yohai Bulk Sender" |
| `daemon: 'running'` אבל `driver_alive: false` | הדימון רץ, Chrome Test לא. הרץ `await window.__base44Bridge.openBulkWhatsApp()` |
| `wa_logged_in: false` | סרוק QR. לחץ "פתח Chrome Test לסריקת QR" בפופאפ |
| `daemon: 'running'` + `wa_logged_in: true` | הכל בסדר! הבעיה במקום אחר |

---

### ההודעה נשלחת **מפורקת לכמה שורות**
**בעיה ידועה שתוקנה בגרסה 1.0.0.**

**אבחון:** בדוק גרסת דימון:
```powershell
$daemonPy = "$env:LOCALAPPDATA\DYohaiBulkSender\wa_bulk_daemon.py"
Select-String -Path $daemonPy -Pattern "_type_with_newlines"
```
אם **אין תוצאות** → הדימון ישן.

**פתרון:**
```powershell
.\update.ps1
# או ידנית:
Copy-Item "<repo>\daemon\wa_bulk_daemon.py" "$env:LOCALAPPDATA\DYohaiBulkSender\" -Force
# אז restart לדימון
```

---

### "Request failed with status code 500" במודאל
**הסבר:** השגיאה הזאת היא **משגיאת Base44 backend**, לא מהדימון!
פורמט axios = `base44.functions.invoke()` שכשלה.

**אבחון:**
1. F12 → Network tab → סנן Fetch/XHR
2. נסה לשלוח שוב
3. מצא את הבקשה האדומה (status 500)
4. הסתכל ב-Response - שם השגיאה האמיתית מה-backend

**סיבות נפוצות:**
- חסרה פונקציית backend ב-Base44 (`prepareWorkScheduleDaemonPayload`?)
- בעיה ב-template rendering (placeholders חסרים)
- בעיית הרשאות לקריאת employees

---

### Chrome Test נפתח אבל מציג QR למרות שכבר סרקת
הסשן פג. WhatsApp מנתק אחרי כמה ימים של חוסר פעילות.

**פתרון:** סרוק שוב. הסשן יישמר בפרופיל ל-30+ ימים.

**מניעה לעתיד:** השאר את הדימון פעיל לפחות פעם בשבוע. אם אוטו-סטארט מופעל - זה אוטומטי.

---

### "Profile is in use" שגיאה בעת הפעלת Chrome Test
שתי instances של Chrome Test ניסו לטעון את אותו profile.

**פתרון אוטומטי:** הדימון יורג orphans בעלייה. אם זה קורה למרות זאת:
```powershell
# הרוג את כל ה-Chrome Test
Get-Process chrome | Where-Object { $_.Path -like "*DYohaiChromeTest*" } | Stop-Process -Force
# מחק את LOCK file (אם קיים)
Remove-Item "$env:LOCALAPPDATA\DYohaiBulkSender\profile\Singleton*" -Force -ErrorAction SilentlyContinue
# הפעל מחדש את הדימון
```

---

## 🟢 בעיות UI

### הקלף "Bulk Sender" בפופאפ אדום למרות שהדימון רץ
**אבחון:**
1. בדוק ידנית: `fetch('http://127.0.0.1:8765/status').then(r=>r.json()).then(console.log)` ב-DevTools של ה-popup
2. אם הfetch מחזיר 200 אבל הקלף עדיין אדום → באג ב-render

**פתרון זמני:** פתח את הפופאפ מחדש (סגור ופתח). הוא מרענן כל 2 שניות.

---

### הודעות לוג של השליחה לא נשמרות בסידור
**סיבה:** שדה `sending_log` לא קיים בישות `WorkSchedule` ב-Base44.

**פתרון:** ב-Base44 → Entity editor → WorkSchedule → הוסף שדה:
- שם: `sending_log`
- סוג: `text` (long text)
- שמור

---

## 🔧 כלי אבחון

### Doctor
```powershell
.\doctor.ps1               # בדיקה מלאה
.\doctor.ps1 -BriefMode    # סיכום בלבד
```

### Console commands ב-Base44
```javascript
// בדוק את ה-Bridge
window.__base44Bridge

// בדוק את הדימון
await window.__base44Bridge.getBulkDaemonStatus()

// פתח Chrome Test ידנית
await window.__base44Bridge.openBulkWhatsApp()

// בדוק WA single-send status
await window.__base44Bridge.getWhatsAppStatus()

// בדוק PIBA token
await window.__base44Bridge.getStatus()
```

### לוגים
| מערכת | נתיב |
|---|---|
| Installer | `%TEMP%\dyohai_install.log` |
| Daemon | `%TEMP%\dyohai_bulk_daemon.log` |
| WA preview | `%TEMP%\dyohai_bridge_wait_and_paste.log` |
| Chrome Test | `%TEMP%\chrome-for-testing.log` (אם קיים) |

---

## 🆘 כשכלום לא עובד - reset מלא

```powershell
# 1. הסרה מלאה (כולל סשן WA)
.\uninstall.ps1 -PurgeProfile

# 2. וודא שאין שאריות
Remove-Item "$env:LOCALAPPDATA\DYohaiBridge" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\DYohaiBulkSender" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\DYohaiChromeTest" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\DYohaiNativeHelper" -Recurse -Force -ErrorAction SilentlyContinue

# 3. הסר את ה-Extension ידנית מ-chrome://extensions/

# 4. התקנה נקייה
.\install.ps1

# 5. סרוק QR מחדש
```

---

## 📞 איסוף מידע לדיווח

אם בעיה לא נפתרת, אסוף:

```powershell
# צור תיקיית debug
$debug = "$env:USERPROFILE\Desktop\base44_debug"
New-Item -ItemType Directory -Path $debug -Force

# העתק לוגים
Copy-Item "$env:TEMP\base44_*.log" $debug -ErrorAction SilentlyContinue

# הרץ doctor ושמור פלט
.\doctor.ps1 > "$debug\doctor_output.txt" 2>&1

# screenshot של popup + modal

# צור zip
Compress-Archive -Path "$debug\*" -DestinationPath "$debug.zip"
```

תשלח את ה-zip יחד עם תיאור התקלה.
