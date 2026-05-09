// components/employees/DownloadVisaButton.jsx - v2
// Updated: treats the function response as always-200 with success/error in body

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, FileCheck } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import PibaTokenDialog, { getValidPibaToken, clearPibaToken } from '@/components/shared/PibaTokenDialog';

export default function DownloadVisaButton({ employee, size = 'default', variant = 'default' }) {
  const [loading, setLoading] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const qc = useQueryClient();

  const missingPrereqs = [];
  if (!employee?.passport_no) missingPrereqs.push('מספר דרכון');
  if (!employee?.nationality_code) missingPrereqs.push('מדינת מוצא');

  const doDownload = async (token) => {
    setLoading(true);
    try {
      const resp = await base44.functions.invoke('downloadPibaVisa', {
        employee_id: employee.id,
        piba_token: token
      });

      // Base44 wraps response under .data
      const data = resp?.data || resp;

      console.log('[DownloadVisa] Full response:', data);

      // Check for success explicitly
      if (data?.success === true) {
        toast.success('הויזה הופקה בהצלחה ונשמרה ברשומת העובד');
        qc.invalidateQueries({ queryKey: ['employee', employee.id] });
        qc.invalidateQueries({ queryKey: ['employees-list'] });
        if (data.file_url) {
          window.open(data.file_url, '_blank', 'noopener');
        }
        return;
      }

      // Failure path - read structured error
      const errorCode = data?.error_code;
      const errorMsg = data?.error || 'שגיאה לא ידועה';

      if (errorCode === 'TOKEN_EXPIRED') {
        clearPibaToken();
        toast.error('הטוקן פג תוקף. נא להתחבר מחדש ל-PIBA');
        setTokenDialogOpen(true);
        return;
      }

      // Log detailed diag for debugging
      if (data?.diag) {
        console.error('[DownloadVisa] Function diagnostic:', data.diag);
      }
      if (data?.piba_status) {
        console.error('[DownloadVisa] PIBA status:', data.piba_status, 'body:', data.piba_body);
      }

      toast.error(errorMsg, {
        description: errorCode ? `קוד שגיאה: ${errorCode}` : undefined,
        duration: 8000
      });
    } catch (e) {
      // Only reached if the function itself crashed with non-200 (shouldn't happen with v2)
      console.error('[DownloadVisa] Invoke failed', e);
      toast.error('שגיאת מערכת: ' + (e.message || 'לא ידוע'));
    } finally {
      setLoading(false);
    }
  };

  const handleClick = async () => {
    if (missingPrereqs.length) {
      toast.error(`חסרים פרטים: ${missingPrereqs.join(', ')}`);
      return;
    }
    const token = getValidPibaToken();
    if (!token) {
      setTokenDialogOpen(true);
      return;
    }
    await doDownload(token);
  };

  const handleTokenSaved = (token) => {
    doDownload(token);
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

      <PibaTokenDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        onTokenSaved={handleTokenSaved}
      />
    </>
  );
}
