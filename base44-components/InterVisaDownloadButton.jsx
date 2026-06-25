/**
 * InterVisaDownloadButton.jsx
 * ===========================
 * Button for InterviewVisas page that downloads the Inter Visa PDF
 * automatically from PIBA's public endpoint (no 2FA required).
 *
 * Flow:
 *   1. Get country numeric_code from Country entity
 *   2. Build foreignKey = "{numeric_code}_{passport_no_lowercase}"
 *   3. Call window.__base44Bridge.fetchPibaInterVisa(foreignKey)
 *   4. Receive PDF as base64
 *   5. Upload to Base44 storage via Core.UploadFile
 *   6. Save URL to InterviewVisa entity field (e.g. inter_visa_doc_url)
 *
 * Endpoint: POST https://inforhub.piba.gov.il/api/downloadPdfEnterVisa
 *           body: {"foreignKey": "140_ej6609447"}
 *
 * Required props:
 *   - interviewVisa: The InterviewVisa record (with employee_id or passport)
 *   - employee: Optional Employee record (must have passport_no, nationality_code)
 *   - countries: Array of Country records (must have code, numeric_code)
 *   - onSuccess: Callback after PDF is saved (receives the file URL)
 *
 * Usage:
 *   <InterVisaDownloadButton
 *     interviewVisa={visa}
 *     employee={employee}
 *     countries={countries}
 *     onSuccess={(url) => updateInterviewVisa({ inter_visa_doc_url: url })}
 *   />
 *
 * Requirements:
 *   - Base44 Bridge Extension v1.4.0+ installed
 *   - Country entity has numeric_code field for each ISO 2-letter code
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Core } from '@/api/integrations';

function waitForBridge(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (window.__base44Bridge) return resolve(window.__base44Bridge);
    const onReady = () => resolve(window.__base44Bridge || null);
    window.addEventListener('base44-bridge-ready', onReady, { once: true });
    setTimeout(() => resolve(window.__base44Bridge || null), timeoutMs);
  });
}

// Convert base64 to Blob (for Core.UploadFile)
function base64ToBlob(base64, mimeType = 'application/pdf') {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}

export default function InterVisaDownloadButton({
  interviewVisa,
  employee,
  countries = [],
  onSuccess = () => {},
  onError = () => {},
  className = '',
  size = 'default'
}) {
  const [status, setStatus] = useState('idle'); // idle|loading|success|error
  const [error, setError] = useState(null);

  // Resolve passport + country from props
  const passport = employee?.passport_no || interviewVisa?.passport_no || '';
  const countryCode = employee?.nationality_code || interviewVisa?.nationality_code || '';
  const country = countries.find(c => c.code === countryCode);
  const numericCode = country?.numeric_code;

  const canDownload = !!passport && !!numericCode;

  async function handleDownload() {
    setStatus('loading');
    setError(null);

    try {
      // 1. Wait for bridge
      const bridge = await waitForBridge();
      if (!bridge) {
        throw new Error('ה-Extension של Base44 Bridge לא מותקן. התקן אותו ב-Chrome.');
      }

      // 2. Build foreignKey (passport lowercased)
      const foreignKey = `${numericCode}_${String(passport).toLowerCase()}`;
      console.log('[InterVisa] Fetching with foreignKey:', foreignKey);

      // 3. Call PIBA via bridge
      const result = await bridge.fetchPibaInterVisa(foreignKey);
      console.log('[InterVisa] Response:', {
        success: result?.success,
        error_code: result?.error_code,
        byteLength: result?.byteLength,
        hasPdf: !!result?.pdf_base64
      });

      if (!result?.success) {
        throw new Error(
          result?.error_code === 'PIBA_ERROR'
            ? `PIBA דחתה: ${result.error}`
            : result?.error || 'Unknown error'
        );
      }

      // 4. Convert base64 → Blob → File
      const blob = base64ToBlob(result.pdf_base64);
      const filename = `inter_visa_${passport}.pdf`;
      const file = new File([blob], filename, { type: 'application/pdf' });

      // 5. Upload to Base44 storage
      console.log('[InterVisa] Uploading to Base44 storage...');
      const upload = await Core.UploadFile({ file });
      const fileUrl = upload?.file_url || upload?.url;
      if (!fileUrl) {
        throw new Error('העלאה ל-Base44 נכשלה - אין URL בתגובה');
      }
      console.log('[InterVisa] Uploaded:', fileUrl);

      // 6. Notify parent
      setStatus('success');
      onSuccess(fileUrl, { ...result, file_url: fileUrl, filename });
    } catch (e) {
      console.error('[InterVisa] Download failed:', e);
      setStatus('error');
      setError(e.message || String(e));
      onError(e);
    }
  }

  return (
    <div className={`inter-visa-download ${className}`} dir="rtl">
      <Button
        onClick={handleDownload}
        disabled={!canDownload || status === 'loading'}
        size={size}
        variant={status === 'success' ? 'outline' : 'default'}
      >
        {status === 'loading' && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
        {status === 'success' && <CheckCircle2 className="h-4 w-4 ml-2 text-green-600" />}
        {(status === 'idle' || status === 'error') && <Download className="h-4 w-4 ml-2" />}
        {status === 'loading' ? 'מוריד...' :
         status === 'success' ? 'הורד בהצלחה ✓' :
         'הורד אינטר ויזה מ-PIBA'}
      </Button>

      {!canDownload && (
        <p className="text-xs text-amber-600 mt-1">
          {!passport && '⚠ חסר מספר דרכון. '}
          {!numericCode && `⚠ אין numeric_code לארץ "${countryCode}". `}
          לא ניתן להוריד.
        </p>
      )}

      {status === 'error' && error && (
        <Alert variant="destructive" className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-right">{error}</AlertDescription>
        </Alert>
      )}

      {status === 'success' && (
        <Alert className="mt-2 bg-green-50 border-green-300">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-right text-green-900">
            הויזה הורדה ונשמרה בשדה הויזה.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
