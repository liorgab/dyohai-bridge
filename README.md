# Base44 Bridge

**מערכת אינטגרציה היברידית לאפליקציית ניהול עובדים זרים ב-Base44**
המערכת מחברת את Base44 לרשות האוכלוסין (PIBA), HopOn, ו-WhatsApp Web (יחיד + המוני).

---

## מה יש בפנים

| רכיב | מה הוא עושה |
|---|---|
| **Chrome Extension** (`extension/`) | גשר בין Base44 ל-PIBA/HopOn/WhatsApp רגיל. שליחה יחידה + הורדת ויזות. |
| **Bulk Sender Daemon** (`daemon/`) | שרת Python עם Selenium + Chrome for Testing לשליחה המונית של עד 150 הודעות ביום, חינם, אנטי-באן. |
| **Base44 Components** (`base44-components/`) | קבצי `.jsx` להעתקה ידנית לעורך הקוד של Base44 - מודאל שליחה המונית, כפתורי ויזה וכו'. |
| **Smart Installer** (`install.ps1`) | מתקין Python + Chrome + Chrome for Testing + ChromeDriver + הדימון - הכל אוטומטי. |

---

## דרישות מערכת

- **Windows 10 (build 1809+) או Windows 11**
- חיבור אינטרנט להורדה הראשונית (~250MB)
- חשבון WhatsApp פעיל (לסריקת QR פעם אחת)
- חשבון Base44 עם גישה לאפליקציה שלך

> **לא צריך הרשאות מנהל!** ההתקנה כולה ברמת משתמש (ללא UAC prompts).

---

## התקנה - מחשב חדש

### שלב א': הורדת הריפו (חד-פעמי)

יש 2 דרכים. בחר אחת:

**שיטה 1 - GitHub CLI (מומלץ):**
```powershell
# התקן GitHub CLI אם אין לך
winget install GitHub.cli

# התחבר (פעם אחת בחיים)
gh auth login

# clone את הריפו
gh repo clone <YOUR_GITHUB_USER>/dyohai-bridge $HOME\dyohai-bridge
cd $HOME\dyohai-bridge
```

**שיטה 2 - Personal Access Token (PAT):**
```powershell
# צור PAT ב-GitHub: Settings → Developer settings → Tokens (classic) → Generate new
# סמן הרשאת 'repo' בלבד
# העתק את הטוקן

$token = "ghp_YourTokenHere"
git clone "https://$token@github.com/<YOUR_GITHUB_USER>/dyohai-bridge.git" "$HOME\dyohai-bridge"
cd $HOME\dyohai-bridge
```

### שלב ב': הרצת ה-Installer

```powershell
.\install.ps1
```

ה-Installer יעבור 9 שלבים:

```
[1/9] בדיקת Python 3.8+         ✅ אוטומטי (winget → python.org → manual)
[2/9] חבילות Python              ✅ אוטומטי (selenium, flask, ...)
[3/9] Google Chrome              ✅ אוטומטי (winget → manual)
[4/9] Chrome for Testing         ✅ אוטומטי (download + extract)
[5/9] Bulk Sender Daemon         ✅ אוטומטי (copy + config + shortcut)
[6/9] Auto-start בעלייה          ❓ שאלה: כן/לא
[7/9] Native Helper (PDF)        ✅ אוטומטי
[8/9] שמירת metadata             ✅ אוטומטי
[9/9] הוראות סיום ידניות         ⚠️ פעולות שלך (Extension + Components)
```

### שלב ג': 3 הפעולות הידניות בסוף ההתקנה

**1. טעינת ה-Extension לכרום**
ה-Installer יפתח את `chrome://extensions/`:
- הפעל "Developer mode" בפינה הימנית-עליונה
- "Load unpacked" → בחר את `dyohai-bridge\extension`

**2. סריקת QR ל-WhatsApp**
- פתח את Base44 בכרום
- לחץ על אייקון ה-Extension למעלה
- בקלף "Bulk Sender" → "פתח Chrome Test לסריקת QR"
- סרוק QR בטלפון
- הסשן יישמר לתמיד

**3. העתקת קומפוננטות ל-Base44**
ה-Installer יפתח את `base44-components/`. קרא את ה-README בתיקייה ועקוב אחר הוראות ההעתקה.

---

## פקודות שימושיות

### בדיקת תקינות
```powershell
.\doctor.ps1                    # בדיקה מלאה של כל הרכיבים
.\doctor.ps1 -BriefMode         # סיכום בלבד
```

### עדכון לגרסה חדשה
```powershell
.\update.ps1                    # מושך מ-GitHub ועדכון מלא
.\update.ps1 -Check             # רק בודק אם יש עדכון, לא מתקין
.\update.ps1 -Force             # עדכון מאולץ גם אם אותה גרסה
```

### הסרה
```powershell
.\uninstall.ps1                 # הסרה מלאה (משאיר את ה-WA session)
.\uninstall.ps1 -PurgeProfile   # הסרה מלאה כולל QR session
```

---

## Architecture - סקירה מהירה

```
                  ┌─────────────────────────────────┐
                  │    Base44 (UI + Source of Truth) │
                  │  React app at *.base44.app       │
                  └─────────────────────────────────┘
                          ↓                       ↓
          ┌───────────────────────────┐  ┌─────────────────────┐
          │   Chrome Extension v1.4.0  │  │  Bulk Sender Daemon │
          │   (in user's regular       │  │  (Python+Flask+    │
          │    Chrome)                 │  │   Selenium+CfT)    │
          │                            │  │                    │
          │   • PIBA Visa fetch        │  │  • localhost:8765 │
          │   • HopOn token sync       │←→│  • Chrome Test     │
          │   • WhatsApp single send   │  │    isolated        │
          │   • Bulk forwarder         │  │  • SSE progress    │
          │                            │  │  • file send_keys  │
          │   exposes window.          │  │  • ~30s/msg        │
          │   __base44Bridge           │  │  • 150/day cap     │
          └───────────────────────────┘  └─────────────────────┘
```

לפרטים מלאים: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## פתרון בעיות מהיר

| תסמין | פתרון |
|---|---|
| "Bridge Extension לא מותקן" במודאל | רענן Extension ב-`chrome://extensions/` + F5 ב-Base44 |
| "Daemon לא רץ" | הפעל את הקיצור "D.Yohai Bulk Sender" על שולחן העבודה |
| הודעה נשלחת מפורקת לשורות | עדכן את הדימון: `.\update.ps1` |
| WhatsApp דורש סריקת QR שוב | הסשן פג. לחץ "פתח Chrome Test" וסרוק |
| ה-Installer נכשל באמצע | ראה לוג ב-`%TEMP%\dyohai_install.log` |

מדריך מלא: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## גרסאות

ראה [docs/RELEASES.md](docs/RELEASES.md) ל-changelog מלא.

**גרסה נוכחית:** ראה קובץ [VERSION](VERSION).

---

## רישיון

קוד פרטי - שימוש פנימי בלבד עבור עסק "ד.יוחאי".
לא ניתן להפצה ללא אישור מפורש מליאור גבאי.

---

## תמיכה

- **לוג installer:** `%TEMP%\dyohai_install.log`
- **לוג דימון:** `%TEMP%\dyohai_bulk_daemon.log`
- **בעיה במערכת:** הרץ `.\doctor.ps1` והעתק את הפלט
