// background.js - Service worker
// Handles cross-origin PIBA fetches using user's Chrome TLS fingerprint (which works,
// unlike server-side TLS from Base44's Deno runtime which gets blocked).

const PIBA_BASE = 'https://inforhub.piba.gov.il';
const HOPON_API_BASE = 'https://api-gateway.hopon.co';
const WA_BASE = 'https://web.whatsapp.com';
const NATIVE_HOST = 'com.base44.bridge';

// ─── Native Messaging helper ──────────────────────────────────────
function callNativeHelper(payload, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let port;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { port && port.disconnect(); } catch (_) {}
      resolve(result);
    };

    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (e) {
      finish({ success: false, error_code: 'NATIVE_NOT_INSTALLED', error: 'Native helper לא מותקן: ' + e.message });
      return;
    }

    port.onMessage.addListener((msg) => finish(msg));
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      finish({
        success: false,
        error_code: 'NATIVE_DISCONNECTED',
        error: err?.message || 'Native helper disconnected',
        hint: 'ודא שהרצת install.ps1 ושה-Extension ID תואם'
      });
    });

    setTimeout(() => finish({ success: false, error_code: 'NATIVE_TIMEOUT', error: 'Native helper timeout' }), timeoutMs);

    try {
      port.postMessage(payload);
    } catch (e) {
      finish({ success: false, error_code: 'NATIVE_SEND_FAILED', error: e.message });
    }
  });
}

// ─── WhatsApp rate limiting ─────────────────────────────────────────
const WA_RATE = {
  per_minute: 3,      // max messages per minute
  per_day: 150,       // max messages per day
  min_gap_ms: 15_000  // min delay between messages
};

async function checkWhatsAppRate() {
  const { wa_history = [] } = await chrome.storage.local.get(['wa_history']);
  const now = Date.now();
  const fresh = wa_history.filter(t => now - t < 86_400_000); // keep last 24h
  const lastMin = fresh.filter(t => now - t < 60_000);
  const lastMs = fresh.length ? now - fresh[fresh.length - 1] : Infinity;

  if (fresh.length >= WA_RATE.per_day) return { ok: false, reason: 'DAILY_LIMIT', count: fresh.length };
  if (lastMin.length >= WA_RATE.per_minute) return { ok: false, reason: 'MINUTE_LIMIT', count: lastMin.length };
  if (lastMs < WA_RATE.min_gap_ms) return { ok: false, reason: 'TOO_FAST', waitMs: WA_RATE.min_gap_ms - lastMs };

  return { ok: true, today: fresh.length, in_last_minute: lastMin.length };
}

async function recordWhatsAppSend() {
  const { wa_history = [] } = await chrome.storage.local.get(['wa_history']);
  const now = Date.now();
  const fresh = wa_history.filter(t => now - t < 86_400_000);
  fresh.push(now);
  await chrome.storage.local.set({ wa_history: fresh });
}

// ─── WhatsApp: find/open tab & open chat ────────────────────────────
async function findWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: `${WA_BASE}/*` });
  return tabs[0] || null;
}

function sendMessageToTab(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { success: false, error: 'Empty response' });
      }
    });
  });
}

/**
 * Ensure the WhatsApp content script is running in the given tab.
 * If not responding to ping, re-inject it via chrome.scripting.
 * This handles the case where the extension was reloaded while a WA tab was open.
 */
async function ensureWAContentScript(tabId) {
  // First, try a ping
  const pingResp = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'WHATSAPP_PING' }, (r) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    } catch (e) {
      clearTimeout(timer);
      resolve(null);
    }
  });

  if (pingResp?.pong) {
    return { ready: true, injected: false, loggedIn: pingResp.loggedIn };
  }

  // Ping failed - inject content script
  console.log('[Base44 Bridge] WA content script missing, injecting...');
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-whatsapp.js']
    });
    // Give it a moment to register its listeners
    await new Promise(r => setTimeout(r, 800));

    // Verify it's now responsive
    const retryPing = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500);
      chrome.tabs.sendMessage(tabId, { type: 'WHATSAPP_PING' }, (r) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    });

    if (retryPing?.pong) {
      return { ready: true, injected: true, loggedIn: retryPing.loggedIn };
    }
    return { ready: false, error: 'Content script unresponsive after injection' };
  } catch (e) {
    return { ready: false, error: e.message };
  }
}

// ─── Fetch attachment from Base44 CDN and convert to base64 ─────
async function fetchAttachmentAsBase64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
    const blob = await resp.blob();
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Chunked base64 encode (large files)
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    return {
      success: true,
      base64,
      mimeType: blob.type || 'application/octet-stream',
      size: bytes.length
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function openWhatsAppChat(phoneE164, text, autoSend = false, attachment = null) {
  const phone = String(phoneE164).replace(/^\+/, '').replace(/\D/g, '');
  if (!phone) return { success: false, error_code: 'BAD_PHONE', error: 'מספר טלפון לא תקין' };

  let tab = await findWhatsAppTab();
  const tabExists = !!tab;

  // ─── Strategy 1: Tab exists AND logged in → send in place (no reload) ─
  if (tabExists) {
    // Ensure tab is loaded
    if (tab.status === 'loading') {
      await new Promise(r => setTimeout(r, 2000));
      tab = await chrome.tabs.get(tab.id);
    }

    // Focus the tab so user sees what's happening
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    // Ensure content script is loaded (auto-inject if extension was reloaded)
    const csCheck = await ensureWAContentScript(tab.id);
    if (!csCheck.ready) {
      console.warn('[Base44 Bridge] Cannot load content script in WA tab:', csCheck.error);
      // Fall through to URL method
    } else {
      // Try the in-place send (ESC + search + click)
      const inPlaceResult = await sendMessageToTab(tab.id, {
        type: 'WHATSAPP_SEND_IN_PLACE',
        phone,
        message: text,
        autoSend,
        attachment  // {base64, mimeType, filename} or null
      });

    if (inPlaceResult?.success) {
      return {
        success: true,
        tab_id: tab.id,
        mode: 'in_place',
        via: inPlaceResult.via,
        sent: inPlaceResult.sent,
        log: inPlaceResult.log
      };
    }

      // Fall through to URL method for these recoverable errors
      const fallbackCodes = ['CONTACT_NOT_FOUND', 'SEARCH_NOT_FOUND', 'IN_PLACE_FAILED',
                             'NEW_CHAT_BTN_NOT_FOUND', 'NEW_CHAT_SEARCH_NOT_FOUND',
                             'NO_RESULT_AFTER_TYPE', 'MSG_INPUT_NOT_FOUND'];
      if (fallbackCodes.includes(inPlaceResult?.error_code)) {
        console.log('[Base44 Bridge] In-place failed (', inPlaceResult?.error_code, '), falling back to URL');
      } else {
        // Unrecoverable error
        return {
          success: false,
          error_code: inPlaceResult?.error_code || 'IN_PLACE_FAILED',
          error: inPlaceResult?.error || 'שליחה נכשלה',
          tab_id: tab.id,
          log: inPlaceResult?.log,
          details: inPlaceResult
        };
      }
    } // end else (csCheck.ready)
  } // end if (tabExists)

  // ─── Strategy 2: URL-based (new tab or fallback) ────────────────
  const url = `${WA_BASE}/send?phone=${phone}&text=${encodeURIComponent(text)}`;
  if (tabExists) {
    await chrome.tabs.update(tab.id, { url, active: true });
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }

  // Wait for content script to be ready
  await new Promise(r => setTimeout(r, 2000));

  // Ask content script to wait for chat ready + optionally auto-send
  const prepResult = await new Promise((resolve) => {
    const tryRequest = (attempts = 6) => {
      chrome.tabs.sendMessage(tab.id, { type: 'WHATSAPP_PREPARE_URL_SEND', autoSend }, (resp) => {
        if (chrome.runtime.lastError) {
          if (attempts > 0) setTimeout(() => tryRequest(attempts - 1), 1000);
          else resolve({ success: false, error_code: 'TAB_UNAVAILABLE', error: 'לא ניתן לתקשר עם הטאב' });
          return;
        }
        resolve(resp || { success: false, error: 'Empty response' });
      });
    };
    tryRequest();
  });

  if (prepResult?.success) {
    return { success: true, tab_id: tab.id, mode: 'url', sent: prepResult.sent };
  }

  return {
    success: false,
    error_code: prepResult?.error_code || 'URL_PREP_FAILED',
    error: prepResult?.error || 'הטאב לא מוכן',
    tab_id: tab.id,
    details: prepResult
  };
}

async function autoSendWhatsApp(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'WHATSAPP_CLICK_SEND' }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: !!resp?.sent, ...resp });
      }
    });
  });
}

// ─── Helper: get valid stored PIBA token ──────────────────────────────
async function getValidPibaToken() {
  const { piba_token, piba_token_exp } = await chrome.storage.local.get(['piba_token', 'piba_token_exp']);
  if (!piba_token) return { error: 'NO_TOKEN', msg: 'אין טוקן PIBA. פתח את אתר PIBA והתחבר.' };
  if (!piba_token_exp || piba_token_exp < Date.now() + 30_000) {
    return { error: 'TOKEN_EXPIRED', msg: 'טוקן PIBA פג תוקף. פתח את אתר PIBA והתחבר מחדש.' };
  }
  return { token: piba_token, exp: piba_token_exp };
}

async function getValidHopOnToken() {
  const { hopon_token, hopon_token_updated_at } = await chrome.storage.local.get(['hopon_token', 'hopon_token_updated_at']);
  if (!hopon_token) return { error: 'NO_TOKEN', msg: 'אין טוקן HopOn.' };
  return { token: hopon_token, updated_at: hopon_token_updated_at };
}

// ─── PIBA: fetch visa PDF for a single foreignKey ─────────────────────
async function fetchPibaVisa(foreignKey) {
  const tok = await getValidPibaToken();
  if (tok.error) return { success: false, error_code: tok.error, error: tok.msg };

  try {
    const url = `${PIBA_BASE}/api/employers/viewPdfVisaEmployer?foreignKey=${encodeURIComponent(foreignKey)}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tok.token}`,
        'Accept': 'application/pdf, application/json'
      }
    });

    const ct = resp.headers.get('content-type') || '';

    if (resp.status === 401 || resp.status === 403) {
      return { success: false, error_code: 'TOKEN_EXPIRED', error: 'הטוקן נדחה ע"י PIBA. התחבר מחדש.' };
    }

    if (!resp.ok) {
      const text = await resp.text();
      let msg = text.substring(0, 200);
      try { const j = JSON.parse(text); msg = j.error || j.message || msg; } catch {}
      return { success: false, error_code: 'PIBA_ERROR', error: msg, piba_status: resp.status };
    }

    if (ct.includes('application/pdf')) {
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length < 100) {
        return { success: false, error_code: 'PDF_TOO_SMALL', error: 'הקובץ שהתקבל קטן מדי', byteLength: bytes.length };
      }
      const magic = String.fromCharCode(...bytes.slice(0, 4));
      if (magic !== '%PDF') {
        return { success: false, error_code: 'NOT_PDF', error: `הקובץ לא PDF (magic=${magic})` };
      }
      // Convert to base64 for postMessage transport
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      const pdf_base64 = btoa(binary);
      return { success: true, pdf_base64, byteLength: bytes.length, foreignKey };
    }

    if (ct.includes('application/json')) {
      const json = await resp.json();
      const base64 = json.pdf || json.pdfBase64 || json.data || json.base64 || json.file;
      if (!base64) {
        return { success: false, error_code: 'NO_PDF_IN_JSON', error: 'JSON בלי PDF', keys: Object.keys(json) };
      }
      const cleaned = base64.replace(/^data:application\/pdf;base64,/, '');
      return { success: true, pdf_base64: cleaned, foreignKey, metadata: json };
    }

    const sample = await resp.text();
    return {
      success: false,
      error_code: 'UNKNOWN_RESPONSE_TYPE',
      error: `PIBA החזיר ${ct}`,
      sample: sample.substring(0, 500)
    };
  } catch (e) {
    return { success: false, error_code: 'FETCH_ERROR', error: e.message };
  }
}

// ─── PIBA: fetch INTER VISA PDF (no auth required - public endpoint) ─
// Different endpoint, NO 2FA token. POST with {foreignKey} body.
// Same foreignKey format: {country_numeric_code}_{passport_no_lowercase}
async function fetchPibaInterVisa(foreignKey) {
  if (!foreignKey || typeof foreignKey !== 'string') {
    return { success: false, error_code: 'BAD_FOREIGN_KEY', error: 'foreignKey is required' };
  }
  // Normalize: lowercase passport part (PIBA expects lowercase)
  // foreignKey format: "{numeric_code}_{passport}"
  const parts = foreignKey.split('_');
  if (parts.length === 2) {
    foreignKey = parts[0] + '_' + parts[1].toLowerCase();
  }

  try {
    const url = `${PIBA_BASE}/api/downloadPdfEnterVisa`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Origin': PIBA_BASE,
        'Referer': `${PIBA_BASE}/foreign-enter-visa`
      },
      body: JSON.stringify({ foreignKey })
    });

    const ct = resp.headers.get('content-type') || '';

    if (!resp.ok) {
      const text = await resp.text();
      let msg = text.substring(0, 300);
      try { const j = JSON.parse(text); msg = j.error || j.message || j.errorMessage || msg; } catch {}
      return {
        success: false,
        error_code: 'PIBA_ERROR',
        error: msg,
        piba_status: resp.status,
        foreignKey
      };
    }

    // Response is usually JSON with PDF base64 inside, OR raw PDF stream
    if (ct.includes('application/pdf')) {
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length < 100) {
        return { success: false, error_code: 'PDF_TOO_SMALL', error: 'PDF received but too small', byteLength: bytes.length };
      }
      const magic = String.fromCharCode(...bytes.slice(0, 4));
      if (magic !== '%PDF') {
        return { success: false, error_code: 'NOT_PDF', error: `Not a PDF (magic=${magic})` };
      }
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return { success: true, pdf_base64: btoa(binary), byteLength: bytes.length, foreignKey };
    }

    if (ct.includes('application/json') || ct.includes('text/plain')) {
      const text = await resp.text();
      let json;
      try { json = JSON.parse(text); } catch (e) {
        return { success: false, error_code: 'NOT_JSON', error: 'Response is not JSON', sample: text.substring(0, 300) };
      }

      // Look for PDF base64 under common keys
      const pdf_b64 = json.pdf || json.pdfBase64 || json.data || json.base64 || json.file ||
                     json.fileBase64 || json.pdfData || json.content;

      // ─── NEW (24/06/2026): Handle PIBA's async pattern ───────────
      // PIBA sometimes returns { jobId, signedUrl, message } INSTEAD of PDF
      // inline. The signedUrl points to a CDN where the PDF lives. We must
      // make a second fetch to actually get the PDF. This pattern appears
      // when PIBA's PDF generation is slow / not cached.
      if (!pdf_b64) {
        const signedUrl = json.signedUrl || json.signed_url || json.url ||
                          json.pdfUrl || json.downloadUrl || json.fileUrl;
        if (signedUrl && typeof signedUrl === 'string' && signedUrl.startsWith('http')) {
          try {
            const r2 = await fetch(signedUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/pdf, */*',
                'Referer': `${PIBA_BASE}/foreign-enter-visa`
              }
            });
            if (!r2.ok) {
              return {
                success: false,
                error_code: 'SIGNED_URL_FETCH_FAILED',
                error: `Failed to fetch signedUrl (HTTP ${r2.status})`,
                signed_url: signedUrl
              };
            }
            const buf2 = await r2.arrayBuffer();
            const bytes2 = new Uint8Array(buf2);
            if (bytes2.length < 100) {
              return { success: false, error_code: 'PDF_TOO_SMALL', error: 'PDF too small from signedUrl', byteLength: bytes2.length };
            }
            if (String.fromCharCode(...bytes2.slice(0, 4)) !== '%PDF') {
              return { success: false, error_code: 'NOT_PDF', error: 'signedUrl did not return a PDF' };
            }
            let bin2 = '';
            const chunk2 = 8192;
            for (let i = 0; i < bytes2.length; i += chunk2) {
              bin2 += String.fromCharCode.apply(null, bytes2.subarray(i, i + chunk2));
            }
            return {
              success: true,
              pdf_base64: btoa(bin2),
              byteLength: bytes2.length,
              foreignKey,
              fetched_via: 'signed_url',
              job_id: json.jobId
            };
          } catch (e2) {
            return {
              success: false,
              error_code: 'SIGNED_URL_FETCH_ERROR',
              error: e2.message,
              signed_url: signedUrl
            };
          }
        }
        // Neither inline PDF nor signed URL — true failure
        return {
          success: false,
          error_code: 'NO_PDF_IN_JSON',
          error: 'JSON without PDF or signed URL',
          keys: Object.keys(json),
          sample: JSON.stringify(json).substring(0, 300)
        };
      }
      const cleaned = String(pdf_b64).replace(/^data:application\/pdf;base64,/, '');

      // Verify it decodes to a real PDF
      try {
        const head = atob(cleaned.substring(0, 100));
        if (!head.startsWith('%PDF')) {
          return {
            success: false,
            error_code: 'NOT_PDF_BASE64',
            error: `Decoded base64 does not start with %PDF (got "${head.substring(0, 10)}")`
          };
        }
      } catch (e) {
        return { success: false, error_code: 'BAD_BASE64', error: e.message };
      }

      return {
        success: true,
        pdf_base64: cleaned,
        foreignKey,
        metadata: { ...json, pdf: undefined, data: undefined, file: undefined, content: undefined }
      };
    }

    const sample = await resp.text();
    return {
      success: false,
      error_code: 'UNKNOWN_RESPONSE_TYPE',
      error: `PIBA returned ${ct}`,
      sample: sample.substring(0, 500)
    };
  } catch (e) {
    return { success: false, error_code: 'FETCH_ERROR', error: e.message };
  }
}


// ─── Message router ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg?.type;

  if (type === 'PIBA_FETCH_VISA') {
    fetchPibaVisa(msg.foreignKey).then(sendResponse);
    return true;
  }

  if (type === 'PIBA_FETCH_INTER_VISA') {
    fetchPibaInterVisa(msg.foreignKey).then(sendResponse);
    return true;
  }

  if (type === 'GET_BRIDGE_STATUS') {
    Promise.all([getValidPibaToken(), getValidHopOnToken()]).then(([piba, hopon]) => {
      sendResponse({
        piba: piba.error
          ? { valid: false, error: piba.error }
          : { valid: true, expiresAt: piba.exp, remainingMinutes: Math.round((piba.exp - Date.now()) / 60000) },
        hopon: hopon.error
          ? { valid: false, error: hopon.error }
          : { valid: true, updatedAt: hopon.updated_at }
      });
    });
    return true;
  }

  if (type === 'GET_HOPON_TOKEN') {
    getValidHopOnToken().then((res) => {
      if (res.error) sendResponse({ success: false, error_code: res.error, error: res.msg });
      else sendResponse({ success: true, token: res.token, updated_at: res.updated_at });
    });
    return true;
  }

  if (type === 'OPEN_PIBA') {
    chrome.tabs.create({ url: PIBA_BASE + '/employer_info' });
    sendResponse({ success: true });
    return false;
  }

  if (type === 'OPEN_HOPON') {
    chrome.tabs.create({ url: 'https://b2b-dashboard.hopon.co' });
    sendResponse({ success: true });
    return false;
  }

  // ─── WhatsApp handlers ────────────────────────────────────────────
  if (type === 'WHATSAPP_OPEN_CHAT') {
    (async () => {
      // Check rate limit
      const rate = await checkWhatsAppRate();
      if (!rate.ok) {
        sendResponse({
          success: false,
          error_code: 'RATE_LIMIT',
          reason: rate.reason,
          error: rate.reason === 'DAILY_LIMIT' ? `הגעת למגבלה יומית (${rate.count}/${WA_RATE.per_day})` :
                 rate.reason === 'MINUTE_LIMIT' ? `מהר מדי (${rate.count} בדקה האחרונה)` :
                 `חכה עוד ${Math.ceil(rate.waitMs / 1000)} שניות לפני הודעה נוספת`,
          ...rate
        });
        return;
      }
      // If attachment URL provided, fetch it first
      let attachment = null;
      if (msg.attachmentUrl) {
        const fetchResult = await fetchAttachmentAsBase64(msg.attachmentUrl);
        if (!fetchResult.success) {
          sendResponse({
            success: false,
            error_code: 'ATTACHMENT_FETCH_FAILED',
            error: 'שגיאה בהורדת הקובץ: ' + fetchResult.error
          });
          return;
        }
        attachment = {
          base64: fetchResult.base64,
          mimeType: fetchResult.mimeType,
          filename: msg.attachmentFilename || 'file'
        };
      }


      const result = await openWhatsAppChat(msg.phone, msg.message, msg.autoSend || false, attachment);
      if (result.success) {
        await recordWhatsAppSend();
      }
      sendResponse({ ...result, rate });
    })();
    return true;
  }

  if (type === 'WHATSAPP_AUTO_SEND') {
    (async () => {
      if (!msg.tab_id) {
        sendResponse({ success: false, error: 'Missing tab_id' });
        return;
      }
      const result = await autoSendWhatsApp(msg.tab_id);
      sendResponse(result);
    })();
    return true;
  }

  if (type === 'WHATSAPP_GET_STATUS') {
    (async () => {
      const { whatsapp_logged_in, whatsapp_status_updated_at, wa_history = [] } = await chrome.storage.local.get([
        'whatsapp_logged_in', 'whatsapp_status_updated_at', 'wa_history'
      ]);
      const now = Date.now();
      const today = wa_history.filter(t => now - t < 86_400_000).length;
      sendResponse({
        logged_in: !!whatsapp_logged_in,
        status_updated_at: whatsapp_status_updated_at,
        sent_today: today,
        daily_limit: WA_RATE.per_day
      });
    })();
    return true;
  }

  if (type === 'OPEN_WHATSAPP') {
    chrome.tabs.create({ url: WA_BASE });
    sendResponse({ success: true });
    return false;
  }

  // ─── Native Messaging handlers (for PDF attachments) ─────────────
  if (type === 'NATIVE_PING') {
    callNativeHelper({ action: 'ping' }, 3000).then(sendResponse);
    return true;
  }

  if (type === 'NATIVE_SAVE_FILE') {
    callNativeHelper({
      action: 'save_file',
      file_base64: msg.file_base64,
      filename: msg.filename
    }, 30000).then(sendResponse);
    return true;
  }

  if (type === 'NATIVE_PASTE_PATH') {
    callNativeHelper({
      action: 'paste_path',
      file_path: msg.file_path,
      pre_delay_ms: msg.pre_delay_ms || 500
    }, 15000).then(sendResponse);
    return true;
  }

  if (type === 'NATIVE_WAIT_AND_PASTE') {
    const timeoutS = msg.timeout_s || 15;
    callNativeHelper({
      action: 'wait_and_paste',
      file_path: msg.file_path