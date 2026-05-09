// content-base44.js
// Runs on Base44 app - injects page bridge script + relays messages between
// the page (isolated world) and the extension background (has cross-origin powers)

(function () {
  'use strict';

  // 1. Inject page-bridge.js into the page's main world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-bridge.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  /**
   * Check if the extension context is still valid.
   * After extension reload, chrome.runtime.id becomes undefined in stale content scripts.
   */
  function isExtensionContextValid() {
    try {
      return !!(chrome?.runtime?.id);
    } catch (e) {
      return false;
    }
  }

  /**
   * Safe sendMessage wrapper that handles invalidated extension context
   * (happens when user updates/reloads the extension while tab is open).
   */
  function safeSendMessage(requestId, payload) {
    // Fast path: context invalid → return clear error
    if (!isExtensionContextValid()) {
      window.postMessage({
        type: 'BASE44_BRIDGE_RESPONSE',
        requestId,
        response: {
          success: false,
          error: 'התוסף רוענן - יש לרענן את דף Base44 (F5)',
          error_code: 'EXT_RELOADED'
        }
      }, window.location.origin);
      return;
    }

    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const err = chrome.runtime.lastError;
        window.postMessage({
          type: 'BASE44_BRIDGE_RESPONSE',
          requestId,
          response: err
            ? { success: false, error: err.message, error_code: 'EXT_COMM_ERROR' }
            : (response || { success: false, error: 'Empty response', error_code: 'EMPTY_RESPONSE' })
        }, window.location.origin);
      });
    } catch (e) {
      // Context might have been invalidated between the check and the call
      const isContextErr = /Extension context invalidated|Receiving end does not exist/i.test(e.message);
      window.postMessage({
        type: 'BASE44_BRIDGE_RESPONSE',
        requestId,
        response: {
          success: false,
          error: isContextErr
            ? 'התוסף רוענן - יש לרענן את דף Base44 (F5)'
            : e.message,
          error_code: isContextErr ? 'EXT_RELOADED' : 'EXT_THROW'
        }
      }, window.location.origin);
    }
  }

  // 2. Listen for bridge requests from the page and forward to background
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'BASE44_BRIDGE_REQUEST') return;

    const { requestId, action, payload } = data;
    safeSendMessage(requestId, { type: action, ...(payload || {}) });
  });

  // 3. Announce extension presence after page-bridge.js loads
  window.addEventListener('base44-bridge-injected', () => {
    window.postMessage({ type: 'BASE44_BRIDGE_READY', version: '1.1.0' }, window.location.origin);
  });

  console.log('[Base44 Bridge] Content script loaded on Base44 app');
})();
