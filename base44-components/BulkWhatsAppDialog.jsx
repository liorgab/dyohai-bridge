/**
 * BulkWhatsAppDialog.jsx
 * =======================
 * Bulk WhatsApp sender dialog for Base44.
 *
 * Flow:
 *  1. User selects employees (checkbox list)
 *  2. User picks template (or writes free text)
 *  3. User optionally attaches a file (PDF, etc.)
 *  4. Dialog shows preview for each employee
 *  5. User clicks "Start" - extension forwards to local daemon
 *  6. Progress bar updates live via Server-Sent Events
 *  7. User can Stop mid-run
 *
 * Requirements:
 *  - Base44 Bridge Extension v1.3.0+ installed in Chrome
 *  - Bulk Sender daemon running (desktop shortcut)
 *  - Chrome for Testing logged into WhatsApp (one-time QR scan)
 *
 * Usage in your employee list page:
 *   <BulkWhatsAppDialog
 *     selectedEmployees={selected}   // array of Employee rows
 *     open={showBulkDialog}
 *     onClose={() => setShow(false)}
 *   />
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Send, Square, AlertCircle, CheckCircle2, XCircle,
  Clock, FileText, Loader2
} from 'lucide-react';

// Wait for the extension's window.__base44Bridge to be injected
function waitForBridge(timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (window.__base44Bridge) return resolve(window.__base44Bridge);
    const onReady = () => resolve(window.__base44Bridge || null);
    window.addEventListener('base44-bridge-ready', onReady, { once: true });
    setTimeout(() => resolve(window.__base44Bridge || null), timeoutMs);
  });
}

// Render a template with employee fields (e.g. "שלום {{first_name_he}}")
function renderTemplate(template, employee) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => String(employee?.[key] ?? ''));
}

// Convert a URL to base64 (for attachment)
async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Convert a File object to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const DEFAULT_TEMPLATE = `שלום {{first_name_he}},

הויזה שלך בתוקף עד {{visa_expiry}}.
מצורף העתק של הויזה.

בברכה,
ד.יוחאי`;

export default function BulkWhatsAppDialog({
  selectedEmployees = [],
  open = false,
  onClose = () => {}
}) {
  const [bridge, setBridge] = useState(null);
  const [daemonStatus, setDaemonStatus] = useState(null); // 'checking'|'offline'|'online'
  const [daemonInfo, setDaemonInfo] = useState(null);

  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [delayMin, setDelayMin] = useState(20);
  const [delayMax, setDelayMax] = useState(40);
  const [attachment, setAttachment] = useState(null); // { file, base64, filename }
  const [useEmployeeVisa, setUseEmployeeVisa] = useState(true);

  const [job, setJob] = useState(null); // { id, total, state, events[] }
  const [unsubFn, setUnsubFn] = useState(null);

  // Employees that actually have phones + visa (filtered)
  const eligibleEmployees = useMemo(() =>
    selectedEmployees.filter(e => {
      const phone = e.phone_whatsapp_e164 || e.phone_whatsapp || '';
      return !!String(phone).replace(/\D/g, '');
    })
  , [selectedEmployees]);

  // ─── Check bridge + daemon on open ────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function init() {
      const b = await waitForBridge();
      if (cancelled) return;
      setBridge(b);

      if (!b) {
        setDaemonStatus('no_extension');
        return;
      }

      setDaemonStatus('checking');
      try {
        const st = await b.getBulkDaemonStatus();
        if (cancelled) return;
        if (st?.daemon === 'running') {
          setDaemonStatus('online');
          setDaemonInfo(st);
        } else {
          setDaemonStatus('offline');
          setDaemonInfo(st);
        }
      } catch (e) {
        if (!cancelled) setDaemonStatus('offline');
      }
    }
    init();
    return () => { cancelled = true; };
  }, [open]);

  // ─── Close / cleanup ──────────────────────────────────────────
  const handleClose = useCallback(() => {
    if (unsubFn) {
      try { unsubFn(); } catch (_) {}
    }
    onClose();
  }, [unsubFn, onClose]);

  // ─── Start bulk send ──────────────────────────────────────────
  async function handleStart() {
    if (!bridge) return;
    if (eligibleEmployees.length === 0) return;

    // Build payload
    let attachmentB64 = null;
    let attachmentFilename = null;

    if (attachment?.base64) {
      attachmentB64 = attachment.base64;
      attachmentFilename = attachment.filename;
    }

    // If useEmployeeVisa, each employee has their own visa - we send in a loop
    // but the daemon accepts only ONE attachment per batch. So we need to
    // either batch-per-employee (slower) OR send without attachment here.
    // For v1: single common attachment. Per-employee visa is a future enhancement.

    // Build employees array with flat fields the template can reference
    const employeesPayload = eligibleEmployees.map(e => ({
      phone: e.phone_whatsapp_e164 || e.phone_whatsapp,
      name: e.full_name || e.first_name_he || e.full_name_en,
      first_name_he: e.first_name_he || '',
      last_name_he: e.last_name_he || '',
      full_name: e.full_name || '',
      full_name_en: e.full_name_en || '',
      passport_no: e.passport_no || '',
      visa_expiry: e.visa_expiry || '',
      apartment_name: e.apartment_name || '',
      employee_id: e.id,
    }));

    setJob({
      id: null, total: employeesPayload.length, state: 'starting', events: []
    });

    let response;
    try {
      response = await bridge.startBulkSend({
        employees: employeesPayload,
        template,
        attachment_base64: attachmentB64,
        attachment_filename: attachmentFilename,
        delay_min_s: delayMin,
        delay_max_s: delayMax
      });
    } catch (e) {
      setJob(prev => ({ ...prev, state: 'error', error: e.message }));
      return;
    }

    if (!response?.success) {
      setJob(prev => ({ ...prev, state: 'error', error: response?.error || 'daemon rejected the job' }));
      return;
    }

    // Subscribe to progress SSE
    setJob(prev => ({ ...prev, id: response.job_id, state: 'running' }));

    const unsub = bridge.subscribeBulkProgress(
      response.job_id,
      (event) => {
        setJob(prev => prev && {
          ...prev,
          events: [...prev.events, event],
          lastEvent: event
        });
      },
      (finalEvent) => {
        setJob(prev => prev && {
          ...prev,
          state: finalEvent.type === 'complete' ? 'complete' :
                 finalEvent.type === 'stopped' ? 'stopped' : 'error',
          finalEvent
        });
      }
    );
    setUnsubFn(() => unsub);
  }

  async function handleStop() {
    if (!job?.id || !bridge) return;
    try { await bridge.stopBulkSend(job.id); } catch (_) {}
  }

  // ─── Derived UI state ─────────────────────────────────────────
  const sentCount = job?.events?.filter(e => e.type === 'sent').length || 0;
  const failedCount = job?.events?.filter(e => e.type === 'failed').length || 0;
  const processedCount = sentCount + failedCount;
  const progress = job ? (processedCount / job.total) * 100 : 0;
  const isRunning = job?.state === 'running' || job?.state === 'starting';
  const canStart = daemonStatus === 'online'
                   && daemonInfo?.wa_logged_in
                   && eligibleEmployees.length > 0
                   && !isRunning
                   && !!template.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">שליחה מרוכזת ב-WhatsApp</DialogTitle>
        </DialogHeader>

        {/* Daemon status */}
        {daemonStatus === 'no_extension' && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Extension של Base44 Bridge לא מותקן. התקן אותו בקרום כדי לשלוח.
            </AlertDescription>
          </Alert>
        )}
        {daemonStatus === 'offline' && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              ה-Bulk Sender Daemon לא פועל. לחץ על קיצור "Base44 Bulk Sender" בשולחן העבודה.
            </AlertDescription>
          </Alert>
        )}
        {daemonStatus === 'online' && daemonInfo && !daemonInfo.wa_logged_in && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>Chrome Test לא מחובר ל-WhatsApp.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bridge.openBulkWhatsApp()}
              >
                פתח Chrome Test לסריקת QR
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {daemonStatus === 'online' && daemonInfo?.wa_logged_in && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>
              ✓ Daemon פועל, WhatsApp מחובר. מוכן לשליחה.
            </AlertDescription>
          </Alert>
        )}

        {/* Recipients summary */}
        <div className="space-y-2">
          <div className="text-sm text-gray-700">
            <strong>{eligibleEmployees.length}</strong> עובדים נבחרים
            (מתוך {selectedEmployees.length} ששמאת - אחרים חסרים מספר טלפון)
          </div>
          {eligibleEmployees.length > 10 && (
            <Alert variant="default" className="bg-yellow-50 border-yellow-300">
              <AlertCircle className="h-4 w-4 text-yellow-700" />
              <AlertDescription className="text-yellow-900">
                ⚠ שליחה גדולה. השהיה ממוצעת: {delayMin}-{delayMax}s.
                זמן כולל משוער: ~{Math.ceil((eligibleEmployees.length * (delayMin + delayMax)) / 2 / 60)} דקות.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Template */}
        <div>
          <label className="text-sm font-medium">תבנית הודעה</label>
          <Textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={6}
            dir="rtl"
            disabled={isRunning}
            placeholder="כתב הודעה. השתמש ב-{{שם שדה}} כדי להכניס ערכים, למשל {{first_name_he}}"
          />
          <div className="text-xs text-gray-500 mt-1">
            שדות זמינים: {'{{first_name_he}}'}, {'{{full_name}}'}, {'{{visa_expiry}}'}, {'{{passport_no}}'}, {'{{apartment_name}}'}
          </div>
        </div>

        {/* Attachment */}
        <div>
          <label className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            קובץ מצורף (אופציונלי)
          </label>
          <Input
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) { setAttachment(null); return; }
              const b64 = await fileToBase64(f);
              setAttachment({ file: f, base64: b64, filename: f.name });
            }}
            disabled={isRunning}
          />
          {attachment && (
            <div className="text-sm text-gray-600 mt-1">
              ✓ {attachment.filename} ({Math.round(attachment.file.size / 1024)} KB)
            </div>
          )}
        </div>

        {/* Delays */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">השהיה מינ' (שניות)</label>
            <Input type="number" value={delayMin} onChange={e => setDelayMin(+e.target.value)}
                   min={10} max={120} disabled={isRunning} />
          </div>
          <div>
            <label className="text-sm font-medium">השהיה מקס' (שניות)</label>
            <Input type="number" value={delayMax} onChange={e => setDelayMax(+e.target.value)}
                   min={10} max={300} disabled={isRunning} />
          </div>
        </div>

        {/* Progress */}
        {job && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
                <span className="font-medium">
                  {processedCount} / {job.total}
                </span>
                <Badge variant="outline" className="bg-green-50">
                  <CheckCircle2 className="h-3 w-3 text-green-600 mr-1" />
                  {sentCount} נשלחו
                </Badge>
                {failedCount > 0 && (
                  <Badge variant="outline" className="bg-red-50">
                    <XCircle className="h-3 w-3 text-red-600 mr-1" />
                    {failedCount} נכשלו
                  </Badge>
                )}
              </div>
              {job.lastEvent?.type === 'delay' && (
                <span className="flex items-center text-xs text-gray-500">
                  <Clock className="h-3 w-3 mr-1" />
                  ממתין {Math.round(job.lastEvent.seconds)}s...
                </span>
              )}
            </div>
            <Progress value={progress} className="h-2" />
            {job.state === 'complete' && (
              <div className="text-sm text-green-700 font-medium">
                ✓ השליחה הסתיימה - {sentCount} נשלחו, {failedCount} נכשלו
              </div>
            )}
            {job.state === 'error' && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{job.error || job.finalEvent?.message}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {!isRunning ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                סגור
              </Button>
              <Button onClick={handleStart} disabled={!canStart}>
                <Send className="h-4 w-4 ml-1" />
                התחל לשלוח ({eligibleEmployees.length})
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={handleStop}>
              <Square className="h-4 w-4 ml-1" />
              עצור
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
