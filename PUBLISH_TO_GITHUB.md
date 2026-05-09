# איך לדחוף את הריפו ל-GitHub פרטי - מדריך צעד-אחר-צעד

הוראות חד-פעמיות ליצירת הריפו ופרסום ראשון. אחרי השלב הזה תוכל פשוט להשתמש ב-`update.ps1` בכל פעם שיש שינויים.

---

## שלב 1: התקן GitHub CLI (אם אין)

```powershell
winget install GitHub.cli
```

סגור ופתח PowerShell חדש כדי שהפקודה `gh` תהיה זמינה.

---

## שלב 2: התחבר ל-GitHub

```powershell
gh auth login
```

תענה ל-prompts:
- **What account do you want to log into?** → `GitHub.com`
- **What is your preferred protocol?** → `HTTPS`
- **Authenticate Git with your GitHub credentials?** → `Y`
- **How would you like to authenticate?** → `Login with a web browser`

זה יציג קוד 8 תווים. תפתח את הקישור שמופיע, תזין את הקוד, ותאשר.

---

## שלב 3: יצירת הריפו ב-GitHub (פרטי)

```powershell
cd "C:\Users\liorg\Documents\Claude\Projects\חיבור להנפקת מסמך ויזה\dyohai-bridge"

# יוצר ריפו פרטי חדש ב-GitHub שלך
gh repo create dyohai-bridge --private --source=. --remote=origin --description "D.Yohai Bridge - PIBA, HopOn, WhatsApp integration for foreign workers management"
```

הפקודה יוצרת ריפו פרטי בשם `dyohai-bridge` ב-GitHub שלך, ומגדירה אותו כ-`origin` של הריפו המקומי.

---

## שלב 4: ההעלאה הראשונה

```powershell
# Initialize git (אם זה הריפו הראשון)
git init -b main

# הוסף את כל הקבצים
git add .

# בדוק מה הולך להיכנס - חשוב!
git status

# וודא שאין שם:
#   - profile/
#   - chromedriver.exe
#   - chrome-win64/
#   - config.json
#   - *.log
# (כל אלה ב-.gitignore כבר)

# צור commit ראשון
git commit -m "Initial commit - Base44 Bridge v1.0.0

- Smart installer with 3-tier Python fallback
- Bulk Sender Daemon (Python + Selenium + Chrome for Testing)
- Chrome Extension v1.4.0 with PIBA, HopOn, WhatsApp
- Base44 components for copy-paste deployment
- Doctor, update, uninstall scripts
- Multi-line message Shift+Enter fix
- Smart defaults in BulkSendModal"

# דחיפה ל-GitHub
git push -u origin main
```

---

## שלב 5: בדיקה שהכל עלה

```powershell
gh repo view --web
```

זה יפתח את הריפו ב-GitHub. ודא שאתה רואה:
- ✅ README.md מוצג בעברית
- ✅ תיקיות: `extension/`, `daemon/`, `base44-components/`, `docs/`
- ✅ סקריפטים: `install.ps1`, `update.ps1`, `doctor.ps1`, `uninstall.ps1`
- ❌ אין `profile/` או קבצי binary של ChromeDriver

---

## שלב 6: התקנה במחשב חדש

עכשיו, בכל מחשב חדש שתרצה להתקין את המערכת:

```powershell
# חד-פעמי במחשב החדש: התקן + התחבר
winget install GitHub.cli
gh auth login

# clone + install
gh repo clone <YOUR_GH_USERNAME>/dyohai-bridge $HOME\dyohai-bridge
cd $HOME\dyohai-bridge
.\install.ps1
```

---

## אופציה: יצירת PAT לאוטומציה מלאה (ללא gh)

אם אתה רוצה התקנה ב"פקודה אחת" ללא `gh auth`:

### 1. צור PAT ב-GitHub
1. לך ל-https://github.com/settings/tokens
2. "Generate new token" → "Generate new token (classic)"
3. שם: "dyohai-bridge installer"
4. Expiration: לפי הצורך (90 days / no expiration)
5. סמן רק את ה-scope: ✅ `repo` (Full control of private repositories)
6. צור והעתק את הטוקן (`ghp_xxxxxxxxxx...`) - **זה יוצג רק פעם אחת!**

### 2. שמור את הטוקן במקום בטוח
```powershell
# שמור ב-Windows Credential Manager (מומלץ)
cmdkey /generic:"github-dyohai-bridge" /user:"<YOUR_GH_USERNAME>" /pass:"ghp_xxx..."

# או בקובץ מקומי (פחות מאובטח)
"ghp_xxx..." | Set-Content "$HOME\.github_token" -Encoding UTF8
```

### 3. התקנה אוטומטית במחשב חדש (פקודה אחת)

```powershell
$user  = "<YOUR_GH_USERNAME>"
$token = "ghp_xxx..."   # או קרא מ-Credential Manager
$dest  = "$HOME\dyohai-bridge"
git clone "https://${token}@github.com/${user}/dyohai-bridge.git" $dest
cd $dest
.\install.ps1
```

---

## עדכון הריפו בעתיד (אחרי שינויים)

אחרי שעשיתי לך תיקון/שיפור - אני אערוך את הקבצים בתיקייה. אז אתה:

```powershell
cd "C:\Users\liorg\Documents\Claude\Projects\חיבור להנפקת מסמך ויזה\dyohai-bridge"

# עדכן את VERSION (לדוגמה מ-1.0.0 ל-1.0.1)
# (אם אני לא עדכנתי כבר)

git add .
git status   # תראה מה השתנה
git commit -m "Fix: WhatsApp single-send caption typing for multi-line"
git push
```

ואז על כל מחשב שמותקנת המערכת:

```powershell
cd $HOME\dyohai-bridge
.\update.ps1
```

---

## עצות מקצועיות

**1. Tags לגרסאות מובנות:**
```powershell
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```
אז ב-GitHub תוכל לראות "Releases" ולשחזר גרסאות ישנות.

**2. Commit conventions:**
- `feat: ...` - תכונה חדשה
- `fix: ...` - תיקון באג
- `docs: ...` - שינוי בתיעוד
- `refactor: ...` - ניקוי קוד ללא שינוי התנהגות

**3. אל תשכח לעדכן את `VERSION` כשיש שינוי משמעותי** - ה-`update.ps1` משווה לפי קובץ זה.

**4. גיבוי:** הריפו ב-GitHub הוא הגיבוי שלך. אם המחשב נשרף - clone במחשב חדש והכל חוזר.

---

## פתרון בעיות - GitHub CLI

| שגיאה | פתרון |
|---|---|
| `gh: command not found` | סגור ופתח PowerShell חדש אחרי `winget install` |
| `authentication failed` | `gh auth status` ואז `gh auth refresh` |
| `repository name already exists` | יש לך כבר ריפו בשם הזה. שנה את השם ב-`gh repo create` |
| `git push` rejected | `git pull --rebase` ראשון, אז push שוב |
| 401 Unauthorized | ה-PAT שפג. צור חדש ועדכן |
