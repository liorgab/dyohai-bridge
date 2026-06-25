import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Pause,
  Play,
  StopCircle,
  Loader2,
  AlertTriangle,
  Info,
  Download,
  Smartphone,
  Zap,
  QrCode,
  RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { sendWorkScheduleViaDaemon } from '@/services/sendWorkScheduleViaDaemon';

export default function BulkSendModal({
  isOpen,
  onClose,
  scheduleId,
  rowsToSend,
  employees,
  templates,
  onComplete
}) {
  const [status, setStatus] = useState('idle'); // idle, running, paused, completed, stopped
  const [stats, setStats] = useState({
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    remaining: 0
  });
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedFinishTime, setEstimatedFinishTime] = useState(null);
  const [logEntries, setLogEntries] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const stopRequested = useRef(false);
  const pauseRequested = useRef(false);
  const [isSavingLog, setIsSavingLog] = useState(false);

  // ─── Engine selection + Daemon health ────────────────────────────
  // deliveryEngine: 'twilio' | 'wa_daemon'
  // daemonStatus shape:
  //   null            → bridge extension not injected on page (extension missing/old)
  //   { extension_missing: true } → same, explicit
  //   { daemon: 'offline' }   → bridge OK, daemon process not running
  //   { daemon: 'running', driver_alive, wa_logged_in, ... } → all live
  const [deliveryEngine, setDeliveryEngine] = useState('twilio');
  const [daemonStatus, setDaemonStatus] = useState(null);
  const [isLaunchingChromeTest, setIsLaunchingChromeTest] = useState(false);
  const [isCheckingDaemon, setIsCheckingDaemon] = useState(false);
  const userOverrodeEngineRef = useRef(false);

  // Helper: is the daemon fully ready to send?
  const isDaemonReady = (s) =>
    !!s && s.daemon === 'running' && s.wa_logged_in === true;

  // Check daemon status on mount + when modal reopens
  const checkDaemon = async (markUserOverride = false) => {
    setIsCheckingDaemon(true);
    try {
      if (!window.__base44Bridge?.getBulkDaemonStatus) {
        // Extension not installed or too old
        setDaemonStatus({ extension_missing: true });
        return;
      }
      const s = await window.__base44Bridge.getBulkDaemonStatus();
      setDaemonStatus(s);

      // Smart default: if daemon is fully ready and user hasn't manually overridden,
      // auto-prefer the daemon for bulk sending (free vs Twilio's ~₪0.18/msg).
      if (!markUserOverride && !userOverrodeEngineRef.current && isDaemonReady(s)) {
        setDeliveryEngine('wa_daemon');
      }
    } catch (_) {
      setDaemonStatus({ daemon: 'offline' });
    } finally {
      setIsCheckingDaemon(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      userOverrodeEngineRef.current = false; // reset on each open
      checkDaemon();
    }
  }, [isOpen]);

  // Ask daemon to launch Chrome for Testing (first-time QR scan)
  const handleLaunchChromeTest = async () => {
    if (!window.__base44Bridge?.openBulkWhatsApp) {
      toast.error('Bridge Extension לא מותקן או ישן (דרוש v1.3+)');
      return;
    }
    setIsLaunchingChromeTest(true);
    try {
      await window.__base44Bridge.openBulkWhatsApp();
      toast.success('Chrome Test נפתח - סרוק את ה-QR ולחץ "רענן סטטוס"');
      // Poll until logged_in becomes true (or user gives up)
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        await checkDaemon();
        if (tries >= 60) { // ~3 min @ 3s
          clearInterval(poll);
          setIsLaunchingChromeTest(false);
        }
      }, 3000);
      // Stop polling once wa_logged_in is true (handled inside checkDaemon → state change re-renders)
    } catch (e) {
      toast.error('שגיאה בפתיחת Chrome Test: ' + (e?.message || e));
      setIsLaunchingChromeTest(false);
    }
  };

  // Stop polling animation once daemon goes ready
  useEffect(() => {
    if (isLaunchingChromeTest && isDaemonReady(daemonStatus)) {
      setIsLaunchingChromeTest(false);
    }
  }, [daemonStatus, isLaunchingChromeTest]);

  // Manual engine selection — remember user override so we don't overwrite it on next refresh
  const handleEngineChange = (val) => {
    userOverrodeEngineRef.current = true;
    setDeliveryEngine(val);
  };

  useEffect(() => {
    if (isOpen) {
      setStats({
        total: rowsToSend.length,
        sent: 0,
        failed: 0,
        skipped: 0,
        remaining: rowsToSend.length
      });
      setLogEntries([]);
      setCurrentIndex(0);
      setStartTime(null);
      setElapsedTime(0);
      setEstimatedFinishTime(null);
      setStatus('idle');
      stopRequested.current = false;
      pauseRequested.current = false;
    }
  }, [isOpen, rowsToSend]);

  // Timer for elapsed time
  useEffect(() => {
    if (status === 'running' && startTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedTime(elapsed);

        if (stats.sent > 0) {
          const avgTimePerMessage = elapsed / stats.sent;
          const remainingTime = avgTimePerMessage * stats.remaining;
          const estimatedFinish = new Date(Date.now() + remainingTime * 1000);
          setEstimatedFinishTime(estimatedFinish);
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [status, startTime, stats.sent, stats.remaining]);

  const formatElapsedTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const addLogEntry = (entry) => {
    setLogEntries(prev => [...prev, {
      ...entry,
      timestamp: new Date()
    }]);
  };

  const handleStart = async () => {
    if (rowsToSend.length === 0) {
      toast.error('אין הודעות לשליחה');
      return;
    }

    setStatus('running');
    setStartTime(Date.now());
    stopRequested.current = false;
    pauseRequested.current = false;

    if (deliveryEngine === 'wa_daemon') {
      addLogEntry({
        type: 'info',
        message: `מתחיל שליחה דרך WA Web Daemon ל-${rowsToSend.length} עובדים (השהיה 20-40s בין הודעות)...`
      });
      await processDaemonSending();
    } else {
      addLogEntry({
        type: 'info',
        message: `מתחיל שליחה דרך Twilio ל-${rowsToSend.length} עובדים...`
      });
      await processSending();
    }
  };

  const processDaemonSending = async () => {
    try {
      const allRowIds = rowsToSend.map(r => r.id);
      const result = await sendWorkScheduleViaDaemon({
        schedule_id: scheduleId,
        row_ids: allRowIds,
        delay_min_s: 20,
        delay_max_s: 40,
        onEvent: (event) => {
          if (event.type === 'sent') {
            const emp = rowsToSend[event.index];
            const employee = emp ? employees.get(emp.employee_id) : null;
            addLogEntry({
              type: 'success',
              employeeId: employee?.employee_external_id || '',
              employeeExternalId: employee?.employee_external_id || '',
              employeeName: employee?.full_name || event.name || '',
              language: getLanguageLabel(emp?.message_language || employee?.employee_language),
              message: `נשלח בהצלחה (WA Web) [${(event.index || 0) + 1}/${allRowIds.length}]`,
              success: true
            });
            setStats(prev => ({
              ...prev,
              sent: prev.sent + 1,
              remaining: prev.remaining - 1
            }));
          } else if (event.type === 'failed') {
            const emp = rowsToSend[event.index];
            const employee = emp ? employees.get(emp.employee_id) : null;
            addLogEntry({
              type: 'error',
              employeeId: employee?.employee_external_id || '',
              employeeExternalId: employee?.employee_external_id || '',
              employeeName: employee?.full_name || '',
              language: getLanguageLabel(emp?.message_language || employee?.employee_language),
              message: event.error || 'שגיאת Daemon',
              success: false
            });
            setStats(prev => ({
              ...prev,
              failed: prev.failed + 1,
              remaining: prev.remaining - 1
            }));
          } else if (event.type === 'delay') {
            addLogEntry({
              type: 'info',
              message: `⏳ ממתין ${Math.round(event.seconds || 30)} שניות (anti-ban)...`
            });
          } else if (event.type === 'skipped') {
            addLogEntry({
              type: 'skip',
              employeeId: '',
              employeeExternalId: '',
              employeeName: '',
              language: '-',
              message: event.reason || 'דולג',
              success: false
            });
            setStats(prev => ({
              ...prev,
              skipped: prev.skipped + 1,
              remaining: prev.remaining - 1
            }));
          }
        },
        onComplete: (final, summary) => {
          addLogEntry({
            type: 'info',
            message: `השליחה הסתיימה (WA Web)! נשלחו ${summary.sent} הודעות, נכשלו ${summary.failed}`
          });
          setStatus('completed');
          if (onComplete) onComplete();
        }
      });

      if (result.skipped?.length > 0) {
        addLogEntry({
          type: 'info',
          message: `${result.skipped.length} שורות דולגו בשלב ההכנה (ללא תבנית/כבר נשלח/ללא טלפון)`
        });
        setStats(prev => ({
          ...prev,
          skipped: prev.skipped + result.skipped.length,
          remaining: prev.remaining - result.skipped.length
        }));
      }

      if (result.total_messages === 0) {
        setStatus('completed');
        addLogEntry({ type: 'info', message: 'אין שורות לשליחה - הכל דולג' });
        if (onComplete) onComplete();
      }
    } catch (err) {
      addLogEntry({
        type: 'error',
        employeeId: '',
        employeeExternalId: '',
        employeeName: '',
        language: '-',
        message: `שגיאת Daemon: ${err.message}`,
        success: false
      });
      toast.error(err.message);
      setStatus('stopped');
    }
  };

  const processSending = async () => {
    let currentSent = stats.sent;
    let currentFailed = stats.failed;
    let currentSkipped = stats.skipped;
    let currentRemaining = stats.remaining;

    for (let i = currentIndex; i < rowsToSend.length; i++) {
      if (stopRequested.current) {
        setStatus('stopped');
        addLogEntry({ type: 'warning', message: 'השליחה הופסקה על ידי המשתמש' });
        return;
      }

      if (pauseRequested.current) {
        setStatus('paused');
        setCurrentIndex(i);
        addLogEntry({ type: 'info', message: 'השליחה הושהתה' });
        return;
      }

      const row = rowsToSend[i];
      const employee = employees.get(row.employee_id);

      if (!employee) {
        addLogEntry({
          type: 'error',
          employeeId: row.employee_id,
          employeeExternalId: 'לא ידוע',
          language: '-',
          message: 'עובד לא נמצא במערכת',
          success: false
        });
        currentFailed++; currentRemaining--;
        setStats(prev => ({ ...prev, failed: prev.failed + 1, remaining: prev.remaining - 1 }));
        continue;
      }

      if (row.notify_worker === false) {
        addLogEntry({
          type: 'skip',
          employeeId: employee.employee_external_id,
          employeeExternalId: employee.employee_external_id,
          employeeName: employee.full_name,
          language: employee.employee_language || 'en',
          message: 'לא סומן לשליחת הודעה',
          success: false
        });
        currentSkipped++; currentRemaining--;
        setStats(prev => ({ ...prev, skipped: prev.skipped + 1, remaining: prev.remaining - 1 }));
        continue;
      }

      if (!row.message_template_id) {
        addLogEntry({
          type: 'skip',
          employeeId: employee.employee_external_id,
          employeeExternalId: employee.employee_external_id,
          employeeName: employee.full_name,
          language: employee.employee_language || 'en',
          message: 'לא נבחרה תבנית הודעה',
          success: false
        });
        currentSkipped++; currentRemaining--;
        setStats(prev => ({ ...prev, skipped: prev.skipped + 1, remaining: prev.remaining - 1 }));
        continue;
      }

      if (row.message_status === 'Sent' || row.message_status === 'Delivered' || row.message_status === 'Read') {
        addLogEntry({
          type: 'skip',
          employeeId: employee.employee_external_id,
          employeeExternalId: employee.employee_external_id,
          employeeName: employee.full_name,
          language: employee.employee_language || 'en',
          message: 'ההודעה כבר נשלחה',
          success: false
        });
        currentSkipped++; currentRemaining--;
        setStats(prev => ({ ...prev, skipped: prev.skipped + 1, remaining: prev.remaining - 1 }));
        continue;
      }

      if (!employee.phone_whatsapp_e164) {
        addLogEntry({
          type: 'error',
          employeeId: employee.employee_external_id,
          employeeExternalId: employee.employee_external_id,
          employeeName: employee.full_name,
          language: employee.employee_language || 'en',
          message: 'אין מספר WhatsApp',
          success: false
        });
        currentFailed++; currentRemaining--;
        setStats(prev => ({ ...prev, failed: prev.failed + 1, remaining: prev.remaining - 1 }));
        continue;
      }

      try {
        const response = await base44.functions.invoke('sendWorkScheduleMessages', {
          schedule_id: scheduleId,
          row_ids: [row.id]
        });

        if (response.data.success && response.data.results.sent > 0) {
          const template = templates.get(row.message_template_id);
          const languageLabel = getLanguageLabel(row.message_language || employee.employee_language);

          addLogEntry({
            type: 'success',
            employeeId: employee.employee_external_id,
            employeeExternalId: employee.employee_external_id,
            employeeName: employee.full_name,
            language: languageLabel,
            templateKey: template?.key || 'לא ידוע',
            message: 'נשלח בהצלחה',
            success: true
          });
          currentSent++; currentRemaining--;
          setStats(prev => ({ ...prev, sent: prev.sent + 1, remaining: prev.remaining - 1 }));
        } else if (response.data.results.skipped > 0) {
          addLogEntry({
            type: 'skip',
            employeeId: employee.employee_external_id,
            employeeExternalId: employee.employee_external_id,
            employeeName: employee.full_name,
            language: getLanguageLabel(row.message_language || employee.employee_language),
            message: 'דולג',
            success: false
          });
          currentSkipped++; currentRemaining--;
          setStats(prev => ({ ...prev, skipped: prev.skipped + 1, remaining: prev.remaining - 1 }));
        } else {
          addLogEntry({
            type: 'error',
            employeeId: employee.employee_external_id,
            employeeExternalId: employee.employee_external_id,
            employeeName: employee.full_name,
            language: getLanguageLabel(row.message_language || employee.employee_language),
            message: response.data.message || 'שגיאה לא ידועה',
            success: false
          });
          currentFailed++; currentRemaining--;
          setStats(prev => ({ ...prev, failed: prev.failed + 1, remaining: prev.remaining - 1 }));
        }
      } catch (error) {
        console.error('Error sending message:', error);
        addLogEntry({
          type: 'error',
          employeeId: employee.employee_external_id,
          employeeExternalId: employee.employee_external_id,
          employeeName: employee.full_name,
          language: getLanguageLabel(row.message_language || employee.employee_language),
          message: error.message || 'שגיאה בשליחה',
          success: false
        });
        currentFailed++; currentRemaining--;
        setStats(prev => ({ ...prev, failed: prev.failed + 1, remaining: prev.remaining - 1 }));
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setStatus('completed');
    addLogEntry({
      type: 'info',
      message: `השליחה הסתיימה! נשלחו ${currentSent} הודעות, נכשלו ${currentFailed}, דולגו ${currentSkipped}`
    });

    if (onComplete) onComplete();
  };

  const handlePause = () => {
    pauseRequested.current = true;
    addLogEntry({ type: 'info', message: 'מבקש השהיית שליחה...' });
  };

  const handleResume = () => {
    pauseRequested.current = false;
    setStatus('running');
    addLogEntry({ type: 'info', message: 'ממשיך שליחה...' });
    processSending();
  };

  const handleStop = () => {
    stopRequested.current = true;
    addLogEntry({ type: 'warning', message: 'מבקש עצירת שליחה...' });
  };

  const handleSaveLog = async () => {
    if (!scheduleId) {
      toast.error('אין מזהה סידור');
      return;
    }

    setIsSavingLog(true);
    try {
      const logText = logEntries.map((entry) => {
        const timeStr = entry.timestamp.toLocaleString('he-IL', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: 'Asia/Jerusalem'
        });

        if (entry.type === 'info')    return `[${timeStr}] ℹ️ ${entry.message}`;
        if (entry.type === 'warning') return `[${timeStr}] ⚠️ ${entry.message}`;
        if (entry.type === 'success') return `[${timeStr}] ✅ עובד ${entry.employeeExternalId} (${entry.employeeName}) - שפה: ${entry.language} - ${entry.message}`;
        if (entry.type === 'error')   return `[${timeStr}] ❌ עובד ${entry.employeeExternalId} (${entry.employeeName || 'לא ידוע'}) - שפה: ${entry.language} - שגיאה: ${entry.message}`;
        if (entry.type === 'skip')    return `[${timeStr}] ⏭️ עובד ${entry.employeeExternalId} (${entry.employeeName}) - שפה: ${entry.language} - ${entry.message}`;
        return '';
      }).join('\n');

      await base44.entities.WorkSchedule.update(scheduleId, { sending_log: logText });
      toast.success('הלוג נשמר בהצלחה בסידור');
    } catch (error) {
      console.error('Error saving log:', error);
      toast.error('שגיאה בשמירת הלוג');
    } finally {
      setIsSavingLog(false);
    }
  };

  const handleClose = () => {
    if (status === 'running') {
      toast.error('לא ניתן לסגור בזמן שליחה. עצור את השליחה תחילה.');
      return;
    }
    onClose();
  };

  const getLanguageLabel = (code) => {
    const labels = {
      'he': 'עברית', 'en': 'אנגלית', 'si': 'סינהלית', 'th': 'תאילנדית',
      'hi': 'הינדי', 'zh': 'סינית', 'uz': 'אוזבקית', 'ro': 'רומנית'
    };
    return labels[code] || code;
  };

  const getProgressPercentage = () => {
    if (stats.total === 0) return 0;
    const processed = stats.sent + stats.failed + stats.skipped;
    return Math.round((processed / stats.total) * 100);
  };

  // ─── Render daemon status hint inside the WA Web option ──────────
  // This replaces the misleading "Bridge Extension לא מותקן" / "Daemon לא פועל" texts
  // with accurate, action-oriented messages.
  const renderDaemonHint = () => {
    if (isCheckingDaemon && !daemonStatus) {
      return <span className="text-xs text-slate-500 block mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> בודק סטטוס Daemon...</span>;
    }
    if (!daemonStatus || daemonStatus.extension_missing) {
      return (
        <span className="text-xs text-red-600 block mt-1">
          ❌ Bridge Extension לא מוזרק לדף — וודא שהאקסטנשן מותקן (v1.3+) ורענן את הדף
        </span>
      );
    }
    if (daemonStatus.daemon !== 'running') {
      return (
        <span className="text-xs text-red-600 block mt-1">
          ❌ ה-Daemon לא רץ — הפעל את הקיצור "Base44 Bulk Sender" על שולחן העבודה
        </span>
      );
    }
    if (!daemonStatus.wa_logged_in) {
      return (
        <span className="text-xs text-amber-700 block mt-1">
          ⚠️ Chrome Test לא מחובר ל-WhatsApp — לחץ "פתח Chrome Test וסרוק QR" למטה
        </span>
      );
    }
    return (
      <span className="text-xs text-green-700 block mt-1">
        ✅ Daemon מוכן · Chrome Test מחובר
      </span>
    );
  };

  // Should we show the "Open Chrome Test" call-to-action button?
  const showChromeTestCTA =
    daemonStatus?.daemon === 'running' && !daemonStatus?.wa_logged_in;

  // Should we show a strong warning that Twilio costs money when daemon is unavailable?
  const showTwilioCostWarning =
    deliveryEngine === 'twilio' &&
    !isDaemonReady(daemonStatus) &&
    rowsToSend.length > 100;

  const estimatedTwilioCost = (rowsToSend.length * 0.18).toFixed(2);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Send className="w-6 h-6" />
            שליחה המונית של הודעות WhatsApp
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Status Summary */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                <div className="text-center">
                  <p className="text-sm text-slate-600 mb-1">סה"כ הודעות</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-600 mb-1">נשלחו</p>
                  <p className="text-2xl font-bold text-green-600">{stats.sent}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-600 mb-1">נכשלו</p>
                  <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-600 mb-1">דולגו</p>
                  <p className="text-2xl font-bold text-yellow-600">{stats.skipped}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-600 mb-1">נותרו</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.remaining}</p>
                </div>
              </div>

              <Progress value={getProgressPercentage()} className="h-3 mb-4" />
              <p className="text-center text-sm text-slate-600 mb-4">
                התקדמות: {getProgressPercentage()}%
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-600">זמן התחלה:</span>
                  <span className="font-medium">
                    {startTime ? format(new Date(startTime), 'HH:mm:ss') : '-'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-600">זמן שחלף:</span>
                  <span className="font-medium">{formatElapsedTime(elapsedTime)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-600">צפוי להסתיים:</span>
                  <span className="font-medium">
                    {estimatedFinishTime ? format(estimatedFinishTime, 'HH:mm:ss') : '-'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Engine Selector */}
          {status === 'idle' && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold text-sm">מנוע שליחה:</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => checkDaemon(true)}
                    disabled={isCheckingDaemon}
                  >
                    <RefreshCw className={`w-3 h-3 ml-1 ${isCheckingDaemon ? 'animate-spin' : ''}`} />
                    רענן סטטוס
                  </Button>
                </div>

                <RadioGroup value={deliveryEngine} onValueChange={handleEngineChange} dir="rtl" className="space-y-2">
                  {/* WA Daemon - now first, as recommended option */}
                  <div className={`flex items-start gap-2 p-2 rounded-lg border hover:bg-slate-50 ${
                    isDaemonReady(daemonStatus)
                      ? 'border-green-300 bg-green-50'
                      : 'border-slate-200 opacity-80'
                  }`}>
                    <RadioGroupItem
                      value="wa_daemon"
                      id="eng-daemon"
                      disabled={!isDaemonReady(daemonStatus)}
                      className="mt-1"
                    />
                    <Label htmlFor="eng-daemon" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Smartphone className="w-4 h-4 text-green-600" />
                        <span className="font-medium">WhatsApp Web (Daemon)</span>
                        <span className="text-xs text-slate-500">חינם · מקס 150/יום · השהיות 20-40s</span>
                        {isDaemonReady(daemonStatus) && (
                          <Badge className="bg-green-600 text-white text-xs">מומלץ</Badge>
                        )}
                      </div>
                      {renderDaemonHint()}
                    </Label>
                  </div>

                  {/* Twilio */}
                  <div className="flex items-start gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                    <RadioGroupItem value="twilio" id="eng-twilio" className="mt-1" />
                    <Label htmlFor="eng-twilio" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Zap className="w-4 h-4 text-blue-600" />
                        <span className="font-medium">Twilio</span>
                        <span className="text-xs text-slate-500">ערוץ רשמי · ~₪0.18 להודעה · ללא מגבלה יומית</span>
                      </div>
                      {rowsToSend.length > 0 && (
                        <span className="text-xs text-slate-500 block mt-1">
                          עלות משוערת: ~₪{estimatedTwilioCost} ({rowsToSend.length} הודעות)
                        </span>
                      )}
                    </Label>
                  </div>
                </RadioGroup>

                {/* CTA: Open Chrome Test for QR scan (only when daemon running but not logged in) */}
                {showChromeTestCTA && (
                  <Button
                    onClick={handleLaunchChromeTest}
                    disabled={isLaunchingChromeTest}
                    variant="outline"
                    className="w-full border-amber-300 text-amber-800 hover:bg-amber-50"
                  >
                    {isLaunchingChromeTest ? (
                      <>
                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        ממתין לסריקת QR...
                      </>
                    ) : (
                      <>
                        <QrCode className="w-4 h-4 ml-2" />
                        פתח Chrome Test וסרוק QR
                      </>
                    )}
                  </Button>
                )}

                {/* Warning: Twilio costs money when daemon is unavailable + many messages */}
                {showTwilioCostWarning && (
                  <Alert className="bg-amber-50 border-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 text-sm">
                      <strong>שים לב לעלות:</strong> אתה עומד לשלוח {rowsToSend.length} הודעות דרך Twilio
                      בעלות משוערת של <strong>~₪{estimatedTwilioCost}</strong>.
                      עדיף להפעיל את ה-Daemon (חינם) לחיסכון.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Warning: WA Web daily limit */}
                {deliveryEngine === 'wa_daemon' && rowsToSend.length > 150 && (
                  <Alert className="bg-amber-50 border-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 text-sm">
                      <strong>שים לב:</strong> יש {rowsToSend.length} הודעות אבל WA Web מוגבל ל-150 ליום.
                      מומלץ להשתמש ב-Twilio עבור כמויות גדולות.
                    </AlertDescription>
                  </Alert>
                )}

                {deliveryEngine === 'wa_daemon' && rowsToSend.length > 0 && rowsToSend.length <= 150 && (
                  <div className="text-xs text-slate-500 text-center">
                    זמן משוער: ~{Math.round(rowsToSend.length * 30 / 60)} דקות ({rowsToSend.length} הודעות × ~30s ממוצע)
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 justify-center flex-wrap">
            {status === 'idle' && (
              <Button
                onClick={handleStart}
                className={deliveryEngine === 'wa_daemon' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}
                size="lg"
                disabled={deliveryEngine === 'wa_daemon' && !isDaemonReady(daemonStatus)}
              >
                <Play className="w-5 h-5 ml-2" />
                {deliveryEngine === 'wa_daemon' ? 'התחל שליחה (WA Web)' : 'התחל שליחה (Twilio)'}
              </Button>
            )}

            {status === 'running' && (
              <>
                <Button onClick={handlePause} variant="outline" size="lg">
                  <Pause className="w-5 h-5 ml-2" />השהה
                </Button>
                <Button onClick={handleStop} variant="destructive" size="lg">
                  <StopCircle className="w-5 h-5 ml-2" />עצור
                </Button>
              </>
            )}

            {status === 'paused' && (
              <>
                <Button onClick={handleResume} className="bg-green-600 hover:bg-green-700" size="lg">
                  <Play className="w-5 h-5 ml-2" />המשך
                </Button>
                <Button onClick={handleStop} variant="destructive" size="lg">
                  <StopCircle className="w-5 h-5 ml-2" />עצור
                </Button>
              </>
            )}

            {(status === 'completed' || status === 'stopped') && (
              <>
                <Button onClick={handleSaveLog} disabled={isSavingLog} className="bg-blue-600 hover:bg-blue-700" size="lg">
                  {isSavingLog ? <Loader2 className="w-5 h-5 ml-2 animate-spin" /> : <Download className="w-5 h-5 ml-2" />}
                  שמור לוג בסידור
                </Button>
                <Button onClick={handleClose} variant="outline" size="lg">סגור</Button>
              </>
            )}
          </div>

          {/* Status Badge */}
          {status !== 'idle' && (
            <div className="flex justify-center">
              {status === 'running' && (
                <Badge className="bg-blue-100 text-blue-800 text-sm py-1 px-3">
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />שולח הודעות...
                </Badge>
              )}
              {status === 'paused' && (
                <Badge className="bg-yellow-100 text-yellow-800 text-sm py-1 px-3">
                  <Pause className="w-4 h-4 ml-2" />מושהה
                </Badge>
              )}
              {status === 'completed' && (
                <Badge className="bg-green-100 text-green-800 text-sm py-1 px-3">
                  <CheckCircle className="w-4 h-4 ml-2" />הושלם
                </Badge>
              )}
              {status === 'stopped' && (
                <Badge className="bg-red-100 text-red-800 text-sm py-1 px-3">
                  <StopCircle className="w-4 h-4 ml-2" />הופסק
                </Badge>
              )}
            </div>
          )}

          {/* Log Section */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Info className="w-4 h-4" />
                לוג התקדמות מפורט
              </h3>
              <div
                className="bg-slate-50 border rounded-lg p-3 h-64 overflow-y-auto font-mono text-xs"
                style={{ direction: 'ltr', textAlign: 'left' }}
              >
                {logEntries.length === 0 ? (
                  <p className="text-slate-400 text-center" style={{ direction: 'rtl' }}>
                    לחץ על "התחל שליחה" כדי להתחיל
                  </p>
                ) : (
                  logEntries.map((entry, idx) => {
                    const timeStr = entry.timestamp.toLocaleString('he-IL', {
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                      timeZone: 'Asia/Jerusalem'
                    });

                    if (entry.type === 'info') {
                      return <div key={idx} className="mb-1 text-blue-600">[{timeStr}] ℹ️ {entry.message}</div>;
                    }
                    if (entry.type === 'warning') {
                      return <div key={idx} className="mb-1 text-yellow-600">[{timeStr}] ⚠️ {entry.message}</div>;
                    }
                    if (entry.type === 'success') {
                      return (
                        <div key={idx} className="mb-1 text-green-600">
                          [{timeStr}] ✅ עובד {entry.employeeExternalId} ({entry.employeeName}) - שפה: {entry.language} - {entry.message}
                        </div>
                      );
                    }
                    if (entry.type === 'error') {
                      return (
                        <div key={idx} className="mb-1 text-red-600">
                          [{timeStr}] ❌ עובד {entry.employeeExternalId} ({entry.employeeName || 'לא ידוע'}) - שפה: {entry.language} - שגיאה: {entry.message}
                        </div>
                      );
                    }
                    if (entry.type === 'skip') {
                      return (
                        <div key={idx} className="mb-1 text-slate-500">
                          [{timeStr}] ⏭️ עובד {entry.employeeExternalId} ({entry.employeeName}) - שפה: {entry.language} - {entry.message}
                        </div>
                      );
                    }
                    return null;
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Warning Alert */}
          {status === 'idle' && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {deliveryEngine === 'wa_daemon' ? (
                  <>
                    <strong>שליחה דרך WA Web:</strong> התהליך עשוי לקחת זמן רב (20-40 שניות בין הודעות).
                    אל תסגור את הדפדפן, ה-Daemon, או Chrome for Testing במהלך השליחה.
                    מומלץ להפעיל כשאין שימוש אחר ב-WhatsApp Web.
                  </>
                ) : (
                  <>
                    <strong>לידיעתך:</strong> תהליך השליחה עשוי לקחת מספר דקות.
                    אנא אל תסגור את המודאל או הדפדפן במהלך השליחה.
                    השליחה מתבצעת עם עיכוב של 0.5 שניות בין כל הודעה למניעת חסימת API.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
