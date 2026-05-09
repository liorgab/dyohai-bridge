// components/employees/SendWhatsAppButton.jsx - v2 (with media attachment support)
// Opens a WhatsApp Web chat for the given employee with a user-composed message
// and optional file attachment. Uses the Base44 Bridge Chrome Extension v1.2.0+.

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { MessageCircle, Loader2, Send, AlertCircle, Puzzle, Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Waits up to timeoutMs for the extension bridge to be available. */
function waitForBridge(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (window.__base44Bridge) return resolve(window.__base44Bridge);
    const onReady = () => resolve(window.__base44Bridge || null);
    window.addEventListener('base44-bridge-ready', onReady, { once: true });
    setTimeout(() => resolve(window.__base44Bridge || null), timeoutMs);
  });
}

/**
 * Replaces {{placeholder}} tokens with actual employee values.
 */
function applyTemplate(template, employee) {
  if (!template) return '';
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    const value = employee?.[trimmed];
    return value != null ? String(value) : match; // leave unresolved tokens as-is
  });
}

const TEMPLATE_SUGGESTIONS = [
  { label: 'שם פרטי', token: '{{first_name_he}}' },
  { label: 'שם מלא', token: '{{full_name}}' },
  { label: 'שם דירה', token: '{{apartment_name}}' },
  { label: 'תוקף ויזה', token: '{{visa_expiry}}' },
  { label: 'מספר דרכון', token: '{{passport_no}}' }
];

export default function SendWhatsAppButton({ employee, size = 'default', variant = 'default' }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [waStatus, setWaStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [autoSend, setAutoSend] = useState(false);
  // attachment: { url, filename, mimeType, source: 'visa'|'upload' }
  const [attachment, setAttachment] = useState(null);

  const phone = employee?.phone_whatsapp_e164 || employee?.phone_whatsapp || '';
  const hasPhone = !!phone;
  const renderedPreview = applyTemplate(message, employee);

  // Load WA status when dialog opens
  useEffect(() => {
    if (!open) return;
    (async () => {
      const bridge = await waitForBridge();
      if (!bridge) {
        setBridgeMissing(true);
        return;
      }
      setBridgeMissing(false);
      try {
        const status = await bridge.getWhatsAppStatus();
        setWaStatus(status);
      } catch (e) {
        console.warn('getWhatsAppStatus failed', e);
      }
    })();
  }, [open]);

  const handleOpen = async () => {
    if (!hasPhone) {
      toast.error('אין מספר WhatsApp לעובד');
      return;
    }
    // Pre-fill message with a friendly default
    if (!message) {
      const greeting = employee?.first_name_he ? `שלום ${employee.first_name_he}, ` : 'שלום, ';
      setMessage(greeting);
    }
    setOpen(true);
  };

  const handleSend = async () => {
    const finalMessage = renderedPreview.trim();
    if (!finalMessage) {
      toast.error('ההודעה ריקה');
      return;
    }

    setSending(true);
    try {
      const bridge = await waitForBridge();
      if (!bridge) {
        setBridgeMissing(true);
        return;
      }

      // Pass autoSend + optional attachment - extension handles fetching, attaching & clicking
      const result = await bridge.openWhatsAppChat(phone, finalMessage, autoSend, attachment ? {
        attachmentUrl: attachment.url,
        attachmentFilename: attachment.filename
      } : {});

      if (!result?.success) {
        if (result?.error_code === 'RATE_LIMIT') {
          toast.error(result.error, { duration: 8000 });
        } else if (result?.error_code === 'INVALID_NUMBER') {
          toast.error('המספר לא רשום ב-WhatsApp', { description: phone });
        } else if (result?.error_code === 'CONTACT_NOT_FOUND') {
          toast.error(result.error, {
            description: 'המספר לא שמור - ננסה דרך URL (טעינה מחדש)',
            duration: 6000
          });
        } else {
          toast.error(result?.error || 'פתיחת WhatsApp נכשלה', {
            description: result?.error_code ? `קוד: ${result.error_code}` : undefined
          });
        }
        return;
      }

      // Success path - result.sent tells us if extension auto-sent
      if (result.sent) {
        toast.success('ההודעה נשלחה ✉️', {
          description: result.mode === 'in_place' ? 'ללא טעינה מחדש' : undefined
        });
      } else {
        toast.success('WhatsApp פתוח עם ההודעה', {
          description: 'לחץ "שלח" בחלון של WhatsApp כדי להשלים',
          duration: 6000
        });
      }

      setOpen(false);
      setMessage('');
      setAutoSend(false);
      setAttachment(null);
    } catch (e) {
      console.error('SendWhatsApp failed', e);
      toast.error('שגיאה: ' + (e.message || 'unknown'));
    } finally {
      setSending(false);
    }
  };

  const insertToken = (token) => {
    setMessage(prev => prev + token);
  };

  return (
    <>
      <Button
        onClick={handleOpen}
        disabled={!hasPhone}
        size={size}
        variant={variant}
        title={hasPhone ? 'שלח WhatsApp' : 'חסר מספר WhatsApp'}
      >
        <MessageCircle className="h-4 w-4 ml-2" />
        שלח WhatsApp
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>שליחת WhatsApp ל-{employee?.full_name || 'עובד'}</DialogTitle>
            <DialogDescription>
              נסח את ההודעה ולחץ "פתח ב-WhatsApp". לאחר מכן לחץ שלח בחלון של WhatsApp.
            </DialogDescription>
          </DialogHeader>

          {bridgeMissing && (
            <Alert variant="destructive">
              <Puzzle className="h-4 w-4" />
              <AlertDescription>
                דרושה התקנה של Base44 Bridge Extension. ראה הוראות התקנה במסמכי הפרויקט.
              </AlertDescription>
            </Alert>
          )}

          {waStatus && !waStatus.logged_in && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                לא מזוהה חיבור ל-WhatsApp Web.{' '}
                <button
                  className="underline text-blue-600"
                  onClick={() => window.__base44Bridge?.openWhatsApp()}
                >
                  פתח ו-התחבר
                </button>
                {' '}ונסה שוב.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>מספר</Label>
              <Input value={phone} readOnly dir="ltr" className="font-mono text-sm" />
            </div>

            <div className="space-y-1">
              <Label>הודעה</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="הקלד את הודעתך..."
                className="min-h-[120px]"
                dir="rtl"
              />
            </div>

            <div className="flex flex-wrap gap-1 text-xs">
              <span className="text-slate-500 ml-1">הוסף:</span>
              {TEMPLATE_SUGGESTIONS.map(s => (
                <button
                  key={s.token}
                  type="button"
                  onClick={() => insertToken(s.token)}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
                >
                  {s.label}
                </button>
              ))}
            </div>

            {message && renderedPreview !== message && (
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">תצוגה מקדימה:</Label>
                <div className="p-3 bg-green-50 rounded border border-green-200 text-sm whitespace-pre-wrap">
                  {renderedPreview}
                </div>
              </div>
            )}

            {waStatus && (
              <div className="text-xs text-slate-500 flex justify-between">
                <span>נשלחו היום: {waStatus.sent_today}/{waStatus.daily_limit}</span>
                <span>{waStatus.logged_in ? '🟢 WhatsApp מחובר' : '🔴 לא מחובר'}</span>
              </div>
            )}

            {/* Attachment section */}
            <div className="space-y-2">
              <Label className="text-sm">צירוף קובץ (אופציונלי)</Label>
              {attachment ? (
                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200">
                  {attachment.mimeType?.startsWith('image/')
                    ? <ImageIcon className="h-4 w-4 text-blue-600" />
                    : <FileText className="h-4 w-4 text-blue-600" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{attachment.filename}</div>
                    <div className="text-xs text-slate-500">
                      {attachment.source === 'visa' ? 'ויזה מ-PIBA' : 'קובץ מועלה'}
                      {' · '}{attachment.mimeType || 'לא ידוע'}
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAttachment(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {employee?.visa_doc_url && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAttachment({
                        url: employee.visa_doc_url,
                        filename: `visa_${employee.passport_no || 'employee'}.pdf`,
                        mimeType: 'application/pdf',
                        source: 'visa'
                      })}
                    >
                      <FileText className="h-4 w-4 ml-1" />
                      צרף ויזה
                    </Button>
                  )}
                  <label className="inline-flex">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <span>
                        <Paperclip className="h-4 w-4 ml-1" />
                        צרף קובץ אחר
                      </span>
                    </Button>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,video/*,application/pdf,.doc,.docx"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        // Upload to Base44 first so extension can fetch via URL
                        try {
                          const { file_url } = await window.base44?.integrations?.Core?.UploadFile?.({ file }) || {};
                          if (!file_url) {
                            toast.error('העלאת הקובץ נכשלה');
                            return;
                          }
                          setAttachment({
                            url: file_url,
                            filename: file.name,
                            mimeType: file.type || 'application/octet-stream',
                            source: 'upload'
                          });
                        } catch (err) {
                          toast.error('שגיאה בהעלאה: ' + err.message);
                        }
                        e.target.value = ''; // reset input
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-50 rounded border border-amber-200">
              <Checkbox
                id="autoSend"
                checked={autoSend}
                onCheckedChange={setAutoSend}
                className="mt-0.5"
              />
              <div className="flex-1">
                <Label
                  htmlFor="autoSend"
                  className="text-sm font-medium cursor-pointer"
                >
                  שלח אוטומטית
                </Label>
                <p className="text-xs text-slate-600 mt-0.5">
                  ההודעה תישלח אוטומטית אחרי 2-5 שניות. סמן רק כשאתה בטוח בתוכן.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              ביטול
            </Button>
            <Button onClick={handleSend} disabled={sending || !message.trim() || bridgeMissing}>
              {sending ? (
                <><Loader2 className="h-4 w-4 ml-2 animate-spin" />{autoSend ? 'שולח...' : 'פותח...'}</>
              ) : (
                <><Send className="h-4 w-4 ml-2" />{autoSend ? 'שלח עכשיו' : 'פתח ב-WhatsApp'}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
