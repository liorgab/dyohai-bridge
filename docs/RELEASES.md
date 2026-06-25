# Releases - Base44 Bridge

## v1.0.0 (2026-04-27) - Initial Public Installer

**גרסה ראשונה של מערכת ההתקנה האחודה.**

### הוספות
- ✨ `install.ps1` חכם עם 3-tier fallback להתקנת Python (winget → python.org → manual)
- ✨ התקנה אוטומטית של Chrome רגיל (אם חסר) דרך winget
- ✨ הורדה אוטומטית של Chrome for Testing + ChromeDriver מתאים
- ✨ אופציה ל-auto-start של הדימון בעלייה ל-Windows (Task Scheduler + VBS hidden)
- ✨ `doctor.ps1` עם 11 בדיקות תקינות מקיפות
- ✨ `update.ps1` עם git pull + diff מתאים
- ✨ `uninstall.ps1` עם אופציה לשמירת WA session
- ✨ Native Messaging Helper installer לטיפול בדיאלוג PDF (legacy)
- ✨ Popup חדש של Extension עם קלף 4 ל-Bulk Sender (סטטוס + כפתור QR)

### תיקוני באגים בקוד
- 🐛 **Multi-line message split bug**: הודעות עם `\n` נשלחו כמספר הודעות נפרדות. תיקון: Shift+Enter בין שורות.
- 🐛 הטקסט המטעה "Bridge Extension לא מותקן" במודאל - שונה ל-3 הודעות מדויקות לפי המצב.
- 🐛 ברירת המחדל של מנוע השליחה ב-`BulkSendModal` - הייתה Twilio. עכשיו: Daemon אם זמין, Twilio fallback.
- 🐛 popup.html הציג "v1.1.0" hardcoded למרות שה-manifest v1.4.0. עודכן.

### הוספות UX
- 🎨 Smart default: כשהדימון מוכן - הוא נבחר אוטומטית עם תג "מומלץ"
- 🎨 כפתור "פתח Chrome Test וסרוק QR" מופיע אוטומטית כשהדימון רץ אבל לא מחובר
- 🎨 הצגת עלות משוערת של Twilio בכל בחירה (~₪0.18/הודעה × N)
- 🎨 אזהרה בולטת אם > 100 הודעות והדימון לא זמין
- 🎨 כפתור "🔄 רענן סטטוס" ידני במודאל

### Architecture
- ארגון מחדש לתיקיות: `extension/`, `daemon/`, `base44-components/`, `docs/`
- Install metadata ב-`%LOCALAPPDATA%\DYohaiBridge\install.json`
- כל הסקריפטים מועתקים ל-`DYohaiBridge\` כדי לא לדרוש שמירת ריפו

---

## גרסאות קודמות (לפני אחיזת ה-installer)

### Extension v1.4.0
- הוספת `fetchPibaInterVisa` (public endpoint, ללא auth)
- API ל-Bulk Daemon: `getBulkDaemonStatus`, `openBulkWhatsApp`, `startBulkSend`, `subscribeBulkProgress`, `stopBulkSend`

### Extension v1.3.0
- הוספת bridge handlers ב-background.js להעברת בקשות לדימון

### Extension v1.2.0
- WhatsApp single send עם 1 קליק ידני (Native Helper)
- DPI awareness, MOUSEMOVE+click

### Extension v1.1.0
- WhatsApp single send (טקסט בלבד, ללא PDF)

### Extension v1.0.0
- PIBA Employer Visa fetch via Chrome Extension
- HopOn token sync

### Daemon v1.0.0 (לפני התיקון של multi-line)
- Bulk send via Chrome for Testing + Selenium
- Persistent profile, anti-ban delays
- SSE progress streaming
- File attachment via send_keys (no dialog)

---

## Roadmap (לא מומש עדיין)

- [ ] Activity Log: לוג של כל הודעה ב-CaseComment
- [ ] PhoneDirectory unified: לקוחות + ספקים, לא רק עובדים
- [ ] WhatsAppTemplate entity: טמפלטים שמורים רב-לשוניים
- [ ] Spintext: `[[א|ב|ג]]` לrandomization
- [ ] Scheduled messages: cron-like ב-Base44
- [ ] Read receipts: DOM observer ל-delivery status
- [ ] System tray icon לדימון (PyInstaller + tkinter)
- [ ] Auto-update notification: Windows toast כשיש גרסה חדשה
