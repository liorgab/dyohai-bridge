# התקנת D.Yohai Bridge על מחשב חדש

## מה מקבלים בסוף
- ✅ הדימון רץ אוטומטית כל הפעלת מחשב
- ✅ Bridge Extension טעון ב-Chrome
- ✅ קיצור-דרך "D.Yohai Doctor" לתחזוקה (אחרי עדכוני Windows)
- ✅ עוטף בערך 250MB דיסק

---

## הוראות (5 דקות)

### צעד 1 - העתק את התיקייה
העתק את התיקייה `dyohai-bridge\` מ-USB / OneDrive / GitHub אל המחשב החדש, למשל:
```
C:\Users\<שם-משתמש>\Documents\dyohai-bridge\
```

### צעד 2 - הרץ install.ps1
פתח **PowerShell as Administrator** (לחיצה ימנית על מקש Win → "Windows PowerShell (Admin)")
ובצע (החלף את הנתיב לפי המקום שבו הנחת את התיקייה):
```powershell
cd "C:\Users\<שם-משתמש>\Documents\dyohai-bridge"
powershell -ExecutionPolicy Bypass -File install.ps1
```

ההתקנה תרוץ ~5 דקות. תראה התקדמות במסך.
בסוף תקבל הוראה לטעון את ה-Extension.

### צעד 3 - טען את ה-Extension
1. נווט ב-Chrome ל-`chrome://extensions/`
2. הפעל "Developer mode" (toggle ימין-עליון)
3. "Load unpacked" → בחר את התיקייה `extension\` שבתוך dyohai-bridge
4. ✅ רואים: "D.Yohai Bridge"

### צעד 4 - סריקת QR
1. דאבל-קליק על "D.Yohai Bulk Daemon" בשולחן העבודה
2. ייפתח Chrome for Testing - סרוק QR
3. מעתה הדימון מחובר

---

## בדיקה שהכל עובד

ב-PowerShell:
```powershell
Invoke-RestMethod http://127.0.0.1:8765/status
```

תקבל JSON עם `daemon: "running"` ו-`wa_logged_in: true`.

ב-Base44 → MessagingHub → Step 4 → "WhatsApp Web (Daemon)" צריך להיות **🟢 מוכן**.

---

## תקלות?

תריץ doctor:
- דאבל-קליק על "D.Yohai Doctor" בשולחן העבודה
- או: `powershell -ExecutionPolicy Bypass -File doctor.ps1`

הוא יבדוק ויתקן אוטומטית רוב הבעיות.
