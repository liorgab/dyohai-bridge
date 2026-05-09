// components/employees/DownloadVisaButton.jsx - v3 (Extension-based)
// Uses the "Base44 Bridge" Chrome Extension to fetch PIBA visas
// (bypasses TLS fingerprint/IP blocks that affect Deno backend calls)

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, FileCheck, Puzzle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

const EXTENSION_INFO_URL = '#'; // replace with GitHub/Drive link if you publish the extension

/**
 * Waits up to `timeoutMs` for window.__base44Bridge to be injected by the extension.
 */
function waitForBridge(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (window.__base44Bridge) return resolve(window.__base44Bridge);
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const onReady = () => finish(window.__base44Bridge || null);
    window.addEventListener('base44-bridge-ready', onReady, { once: true });
    setTimeout(() => finish(window.__base44Bridge || null), timeoutMs);
  });
}

/**
 * Converts base64 string to File object (for Core.UploadFile).
 */
function base64ToFile(base64, fileName) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  return new File([blob], fileName, { type: 'application/pdf' });
}

export default function DownloadVisaButton({ employee, size = 'default', variant = 'default' }) {
  const [loading, setLoading] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [tokenStatus, setTokenStatus] = useState(null);
  const qc = useQueryClient();

  const missingPrereqs = [];
  if (!employee?.passport_no) missingPrereqs.push('מספר דרכון');
  if (!employee?.nationality_code) missingPrereqs.push('מדינת מוצא');

  const handleClick = async () => {
    if (missingPrereqs.length) {
      toast.error(`חסרים פרטים: ${missingPrereqs.join(', ')}`);
      return;
    }

    setLoading(true);
    try {
      // 1. Detect extension
      const bridge = await waitForBridge();
      if (!bridge) {
        setInstallDialogOpen(true);
        return;
      }

      // 2. Check token status
      const status = await bridge.getStatus();
      setTokenStatus(status);
      if (!status?.piba?.valid) {
        setLoginDialogOpen(true);
        return;
      }

      // 3. Load country numeric_code for foreignKey
      const countries = await base44.entities.Country.filter({ code: employee.nationality_code });
      const country = countries?.[0];
      if (!country?.numeric_code) {
        toast.error(`לא נמצא קוד PIBA למדינה ${employee.nationality_code}`);
        return;
      }

      const foreignKey = `${country.numeric_code}_${employee.passport_no}`;

      // 4. Fetch PDF via extension
      const result = await bridge.fetchPibaVisa(foreignKey);

      if (!result?.success) {
        if (result?.error_code === 'TOKEN_EXPIRED' || result?.error_code === 'NO_TOKEN') {
          setLoginDialogOpen(true);
          return;
        }
        console.error('[DownloadVisa] bridge error', result);
        toast.error(result?.error || 'הפקת הויזה נכשלה', {
          description: result?.error_code ? `קוד: ${result.error_code}` : undefined
        });
        return;
      }

      // 5. Upload PDF to Base44
      const fileName = `visa_${employee.passport_no}_${Date.now()}.pdf`;
      const file = base64ToFile(result.pdf_base64, fileName);
      const uploadResult = await base44.integrations.Core.UploadFile({ file });
      const fileUrl = uploadResult?.file_url;
      if (!fileUrl) {
        toast.error('העלאת הקובץ ל-Base44 נכשלה');
        return;
      }

      // 6. Update employee record
      await base44.entities.Employee.update(employee.id, { visa_doc_url: fileUrl });

      toast.success('הויזה הופקה בהצלחה ונשמרה ברשומת העובד');
      qc.invalidateQueries({ queryKey: ['employee', employee.id] });
      qc.invalidateQueries({ queryKey: ['employees-list'] });

      window.open(fileUrl, '_blank', 'noopener');
    } catch (e) {
      console.error('[DownloadVisa] unexpected', e);
      toast.error('שגיאה לא צפויה: ' + (e.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={loading}
        size={size}
        variant={variant}
        title={missingPrereqs.length ? `חסר: ${missingPrereqs.join(', ')}` : 'הורד ויזה עדכנית מ-PIBA'}
      >
        {loading ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> :
         employee?.visa_doc_url ? <FileCheck className="h-4 w-4 ml-2" /> :
         <Download className="h-4 w-4 ml-2" />}
        {employee?.visa_doc_url ? 'עדכן ויזה מ-PIBA' : 'הורד ויזה מ-PIBA'}
      </Button>

      {/* Extension not installed */}
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Puzzle className="h-5 w-5" /> דרושה התקנה של Extension
            </DialogTitle>
            <DialogDescription>
              כדי להפיק ויזות ישירות מ-PIBA יש להתקין את התוסף "Base44 Bridge".
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2 text-right">
                <p><b>למה זה דרוש?</b></p>
                <p className="text-sm">
                  אתר PIBA חוסם קריאות משרתי Base44 (בדיקת TLS fingerprint).
                  התוסף מפעיל את הקריאה מהדפדפן שלך - איפה שהחסימה לא חלה.
                </p>
              </div>
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>סגור</Button>
            <Button onClick={() => window.open(EXTENSION_INFO_URL, '_blank')}>
              הוראות התקנה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token expired / missing */}
      <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>צריך להתחבר ל-PIBA</DialogTitle>
            <DialogDescription>
              {tokenStatus?.piba?.error === 'TOKEN_EXPIRED'
                ? 'הטוקן פג תוקף (חי 30 דקות). יש להתחבר מחדש.'
                : 'טרם התחברת ל-PIBA. לאחר ההתחברות, התוסף יסנכרן את הטוקן אוטומטית.'}
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertDescription className="text-right">
              לחיצה על "פתח את PIBA" תפתח טאב חדש. התחבר שם (כולל 2FA), חזור לכאן ונסה שוב.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoginDialogOpen(false)}>ביטול</Button>
            <Button onClick={() => {
              window.__base44Bridge?.openPiba();
              setLoginDialogOpen(false);
            }}>
              פתח את PIBA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
