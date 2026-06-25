// page-bridge.js
// Runs in the page's MAIN world (via web_accessible_resources + injection).
// Exposes window.__base44Bridge to Base44 React code.

(function () {
  'use strict';

  const TIMEOUT_MS = 30_000;

  function sendRequest(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        window.removeEventListener('message', listener);
        reject(new Error('Bridge request timed out'));
      }, TIMEOUT_MS);

      function listener(event) {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.type !== 'BASE44_BRIDGE_RESPONSE') return;
        if (d.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        resolve(d.response);
      }
      window.addEventListener('message', listener);

      window.postMessage({
        type: 'BASE44_BRIDGE_REQUEST',
        requestId,
        action,
        payload
      }, window.location.origin);
    });
  }

  window.__base44Bridge = {
    isInstalled: true,
    version: '1.3.0',

    /**
     * Fetch a visa PDF from PIBA (Employer Visa - requires 2FA token).
     * @param {string} foreignKey - Format: "{country_numeric_code}_{passport_no}"
     * @returns {Promise<{success, pdf_base64?, byteLength?, error_code?, error?}>}
     */
    fetchPibaVisa(foreignKey) {
      return sendRequest('PIBA_FETCH_VISA', { foreignKey });
    },

    /**
     * Fetch an INTER VISA PDF from PIBA (no auth required - public endpoint).
     * Different page: https://inforhub.piba.gov.il/foreign-enter-visa
     * @param {string} foreignKey - Format: "{country_numeric_code}_{passport_no}"
     *                              (passport will be lowercased automatically)
     * @returns {Promise<{success, pdf_base64?, byteLength?, error_code?, error?}>}
     */
    fetchPibaInterVisa(foreignKey) {
      return sendRequest('PIBA_FETCH_INTER_VISA', { foreignKey });
    },

    /** Get current bridge/token status */
    getStatus() {
      return sendRequest('GET_BRIDGE_STATUS');
    },

    /** Get HopOn token (for use from Base44's existing HopOn flows) */
    getHopOnToken() {
      return sendRequest('GET_HOPON_TOKEN');
    },

    /** Open PIBA login page in new tab */
    openPiba() {
      return sendRequest('OPEN_PIBA');
    },

    /** Open HopOn login page in new tab */
    openHopOn() {
      return sendRequest('OPEN_HOPON');
    },

    /** Open WhatsApp Web in new tab */
    openWhatsApp() {
      return sendRequest('OPEN_WHATSAPP');
    },

    /**
     * Open a WhatsApp chat with pre-filled message (and optional attachment).
     * @param {string} phone - E.164 format (+972...) or digits only
     * @param {string} message - The message text (used as caption if attachment provided)
     * @param {boolean} autoSend - If true, extension clicks Send after 2-5s random delay
     * @param {object} [options]
     * @param {string} [options.attachmentUrl] - URL of file to attach (extension will fetch it)
     * @param {string} [options.attachmentFilename] - Desired filename (e.g. "visa.pdf")
     * @returns {Promise<{success, tab_id?, sent?, attached?, mode?, error_code?, error?, rate?}>}
     */
    openWhatsAppChat(phone, message, autoSend = false, options = {}) {
      return sendRequest('WHATSAPP_OPEN_CHAT', {
        phone,
        message,
        autoSend,
        attachmentUrl: options.attachmentUrl,
        attachmentFilename: options.attachmentFilename
      });
    },

    /**
     * Click the Send button in the current WhatsApp tab (after openWhatsAppChat).
     * Has a built-in 2-5 second random delay. Use with caution.
     * @param {number} tab_id - Returned from openWhatsAppChat
     */
    autoSendWhatsApp(tab_id) {
      return sendRequest('WHATSAPP_AUTO_SEND', { tab_id });
    },

    /** Get WhatsApp login status + daily send count */
    getWhatsAppStatus() {
      return sendRequest('WHATSAPP_GET_STATUS');
    },

    // ─── Bulk Sender (Python daemon + Chrome Test) ───────────────
    // Returns daemon status, whether WA logged-in in Chrome Test
    getBulkDaemonStatus() {
      return sendRequest('BULK_DAEMON_STATUS');
    },
    // Launch Chrome Test with WA (for first-time QR scan)
    openBulkWhatsApp() {
      return sendRequest('BULK_OPEN_WHATSAPP');
    },

    /**
     * Start a bulk WhatsApp send job. Returns immediately with job_id.
     * @param {object} payload
     * @param {Array} payload.employees - each has `phone` + optional template fields
     * @param {string} payload.template - message template with {{fieldName}} placeholders
     * @param {string} [payload.attachment_base64] - optional file base64
     * @param {string} [payload.attachment_filename] - filename for the attachment
     * @param {number} [payload.delay_min_s=20] - min delay between sends (seconds)
     * @param {number} [payload.delay_max_s=40] - max delay between sends (seconds)
     * @returns {Promise<{success, job_id, sse_url, total}>}
     */
    startBulkSend(payload) {
      return sendRequest('BULK_SEND_START', { payload });
    },

    stopBulkSend(job_id) {
      return sendRequest('BULK_SEND_STOP', { job_id });
    },

    /**
     * Subscribe to progress events for a running bulk job.
     * Calls onEvent for each update, onComplete when done.
     * Returns an unsubscribe function.
     */
    subscribeBulkProgress(job_id, onEvent, onComplete) {
      const es = new EventSource('http://127.0.0.1:8765/progress/' + encodeURIComponent(job_id));
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (typeof onEvent === 'function') onEvent(data);
          if (data.type === 'complete' || data.type === 'stopped' || data.type === 'error') {
            es.close();
            if (typeof onComplete === 'function') onComplete(data);
          }
        } catch (e) {
          console.error('bulk progress parse error', e, ev.data);
        }
      };
      es.onerror = (e) => {
        console.error('bulk progress SSE error', e);
        es.close();
        if (typeof onComplete === 'function') onComplete({ type: 'error', message: 'SSE disconnected' });
      };
      return () => es.close();
    }
  };

  // Signal that the bridge is ready so content-base44.js can broadcast
  window.dispatchEvent(new CustomEvent('base44-bridge-injected'));
  // Also emit an event the React app can listen for
  window.dispatchEvent(new CustomEvent('base44-bridge-ready', {
    detail: { version: '1.3.0' }
  }));
})();
