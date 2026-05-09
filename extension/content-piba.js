// content-piba.js
// Runs on inforhub.piba.gov.il - syncs authToken from localStorage to chrome.storage

(function () {
  'use strict';

  const SYNC_INTERVAL_MS = 5000;
  let lastToken = null;

  function decodeJwt(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      return null;
    }
  }

  async function syncToken() {
    const token = localStorage.getItem('authToken');

    if (token && token !== lastToken) {
      const payload = decodeJwt(token);
      if (!payload?.exp) {
        console.warn('[Base44 Bridge/PIBA] Token missing exp claim');
        return;
      }
      lastToken = token;
      await chrome.storage.local.set({
        piba_token: token,
        piba_token_exp: payload.exp * 1000,
        piba_token_updated_at: Date.now()
      });
      const remainingMin = Math.round((payload.exp * 1000 - Date.now()) / 60000);
      console.log(`[Base44 Bridge/PIBA] Token synced (${remainingMin} min remaining)`);
    } else if (!token && lastToken) {
      lastToken = null;
      await chrome.storage.local.remove(['piba_token', 'piba_token_exp', 'piba_token_updated_at']);
      console.log('[Base44 Bridge/PIBA] Token cleared');
    }
  }

  // Initial sync + periodic
  syncToken();
  setInterval(syncToken, SYNC_INTERVAL_MS);

  // Also sync when localStorage is changed by the page (login/logout)
  window.addEventListener('storage', (e) => {
    if (e.key === 'authToken') syncToken();
  });

  console.log('[Base44 Bridge/PIBA] Content script loaded');
})();
