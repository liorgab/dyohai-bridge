# דחיפת D.Yohai Bridge ל-GitHub פרטי

מדריך חד-פעמי. אחרי השלמתו - תוכל לעדכן בעתיד עם `git push` רגיל, ולהתקין על מחשב חדש דרך `git clone` + `install.ps1`.

---

## שלב 1: התקן GitHub CLI (אם אין)

```powershell
winget install GitHub.cli
```

**חשוב:** סגור את כל חלונות PowerShell ופתח חדש כדי שהפקודה `gh` תהיה זמינה.

בדוק שעובד:
```powershell
gh --version
```

---

## שלב 2: התחבר ל-GitHub

```powershell
gh auth login
```

ענה ל-prompts:
- **What account?** → `GitHub.com`
- **Preferred protocol?** → `HTTPS`
- **Authenticate Git with your GitHub credentials?** → `Y`
- **How would you like to authenticate?** → `Login with a web browser`

תקבל קוד 8 תווים → תפתח את הקישור → תזין את הקוד → אישור.

בדיקה:
```powershell
gh auth status
```
צריך להראות `Logged in to github.com as <username>`.

---

## שלב 3: נווט לריפו

```powershell
cd "C:\Users\liorg\Documents\Claude\Projects\visa-bridge\dyohai-bridge"
```

**ודא שאתה ב-`dyohai-bridge` (לא ב-`visa-bridge`):** `pwd` או `Get-Location`. הריפו ל-GitHub הוא רק התיקייה הפנימית `dyohai-bridge`, לא כל ה-`visa-bridge` (שמכיל גם dev tools, components של Base44 וכו').

---

## שלב 4: אתחל git ו-commit ראשון

```powershell
# Initialize git
git init -b main

# הוסף את כל הקבצים (לפי .gitignore יסונן profile/, *.log, וכו')
git add .

# *** חשוב: בדוק לפני commit ***
git status

# ודא שלא נכנסו לקטלוג:
#   - profile/   (פרופיל Chrome - יציר אחרי install)
#   - chromedriver.exe
#   - chrome-win64/
#   - config.json
#   - *.log
# כל אלה כבר ב-.gitignore - לא אמורים להופיע

# Commit ראשון
git commit -m "Initial release: D.Yohai Bridge v1.4.1

Components:
- Chrome Extension v1.4.0 (PIBA, HopOn, WhatsApp)
- Bulk Sender Daemon v2.0 (Python + Selenium + Chrome for Testing)
  * Search-based navigation (75% performance improvement)
  * Per-employee message override (locale-first support)
  * Paste via clipboard (10x faster than typing)
  * pyperclip integration
  * Pause/Resume with auto-stop after 30min
  * Configurable XPath selectors via config.json
  * Multi-attachment per recipient
  * Stop/pause control endpoints
- Smart installer (Python + CfT + ChromeDriver, no admin needed)
- Doctor script - portable, auto-fixes issues
- Auto-start at Windows login (Task Scheduler)
- Base44 components for copy-paste deployment
- Native Messaging helper for PDF dialog automation"
```

---

## שלב 5: צור ריפו פרטי ב-GitHub ודחוף

```powershell
gh repo create dyohai-bridge --private --source=. --remote=origin --description "D.Yohai Bridge - PIBA + HopOn + WhatsApp integration for foreign workers management. Multi-component (Chrome Extension + Python Daemon)." --push
```

הפלאג `--push` ידחוף את ה-commit מיידית. אם לא עובד, הרץ ידנית:
```powershell
git push -u origin main
```

---

## שלב 6: בדיקה

```powershell
gh repo view dyohai-bridge
```
או פתח ב-browser:
```powershell
gh repo view dyohai-bridge --web
```

תראה את הריפו הפרטי שלך עם כל הקבצים.

---

## העתקה למחשב חדש (אחרי שיש ריפו ב-GitHub)

מעכשיו, כל מחשב חדש מתקין כך:

```powershell
# בכל מקום שתבחר (למשל)
cd "C:\Users\<USER>\Documents"

# הצריך GitHub CLI מותקן ומחובר
gh repo clone dyohai-bridge

# או דרך URL ישיר אם כבר יש לך אישור git:
git clone https://github.com/<your-username>/dyohai-bridge.git

# הרץ את ההתקנה
cd dyohai-bridge
powershell -ExecutionPolicy Bypass -File install.ps1
```

---

## עדכון לגרסה חדשה

### במחשב הפיתוח (כאן)

```powershell
cd "C:\Users\liorg\Documents\Claude\Projects\visa-bridge\dyohai-bridge"

# סנכרן daemon/extension החדשים מ-bulk-sender ו-piba-bridge-extension
# (לפי הצורך, אם נעשו שינויים)

# עדכן VERSION
echo "1.5.0" > VERSION

git add .
git commit -m "v1.5.0 - Document Service Plugins + ..."
git push
```

### במחשבי הייצור

```powershell
cd "C:\Users\<USER>\Documents\dyohai-bridge"
.\update.ps1
```

`update.ps1` עושה: `git pull` + סנכרון הדימון ל-LOCALAPPDATA + שיפעול Doctor.

---

## אבטחה

- הריפו **פרטי** - רק אתה רואה אותו
- אל תוסיף collaborators בלי שיקול
- אל תייצא secrets לקוד (כמו tokens) - השתמש ב-`.env` שלא נדחף
- אם יש credentials נדחפו בטעות - מחק את הריפו ויצור חדש

---

## תקלות נפוצות

### "git: 'gh' is not a git command"
GitHub CLI לא מותקן או לא ב-PATH. סגור ופתח PowerShell.

### "Permission denied (publickey)"
לא חיברת את GitHub:
```powershell
gh auth login
```

### "fatal: refusing to merge unrelated histories"
הריפו ב-GitHub כבר מכיל commits. השתמש ב-rebase:
```powershell
git pull --rebase origin main
git push -u origin main
```

### Commit נכשל בגלל קבצים גדולים
בדוק שאין `chromedriver.exe`, `chrome-win64/` וכו' בריפו:
```powershell
git ls-files | Select-String -Pattern "chromedriver|chrome-win64"
```
אם יש - עדכן `.gitignore` ועשה `git rm --cached <file>`.
