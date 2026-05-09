// popup.js

function renderPiba(piba) {
  const el = document.getElementById('pibaStatus');
  if (!piba || !piba.valid) {
    el.className = 'status error';
    el.innerHTML = piba?.error === 'TOKEN_EXPIRED'
      ? '⚠️ הטוקן פג תוקף<span class="small">פתח את PIBA והתחבר מחדש</span>'
      : '❌ אין טוקן<span class="small">פתח את PIBA והתחבר</span>';
  } else {
    const mins = piba.remainingMinutes;
    const cls = mins < 5 ? 'warn' : 'ok';
    el.className = `status ${cls}`;
    el.innerHTML = `✅ טוקן תקף<span class="small">נותרו ${mins} דקות</span>`;
  }
}

function renderHopOn(hopon) {
  const el = document.getElementById('hoponStatus');
  if (!hopon || !hopon.valid) {
    el.className = 'status error';
    el.innerHTML = '❌ אין טוקן<span class="small">פתח את HopOn והתחבר</span>';
  } else {
    const minsAgo = Math.round((Date.now() - hopon.updatedAt) / 60000);
    el.className = 'status ok';
    el.innerHTML = `✅ טוקן מסונכרן<span class="small">עודכן לפני ${minsAgo} דקות</span>`;
  }
}

function renderWhatsApp(wa) {
  const el = document.getElementById('waStatus');
  if (!wa) {
    el.className = 'status error';
    el.innerHTML = '❓ לא ידוע<span class="small">פתח את WhatsApp Web</span>';
    return;
  }
  if (!wa.logged_in) {
    el.className = 'status error';
    el.innerHTML = '❌ לא מחובר<span class="small">פתח WhatsApp Web וסרוק QR</span>';
    return;
  }
  const count = wa.sent_today || 0;
  const limit = wa.daily_limit || 150;
  const pct = count / limit;
  const cls = pct > 0.8 ? 'warn' : 'ok';
  el.className = `status ${cls}`;
  el.innerHTML = `✅ מחובר<span class="small">נשלחו היום: ${count}/${limit}</span>`;
}

function renderBulkDaemon(s) {
  const el = document.getElementById('bulkStatus');
  const btn = document.getElementById('openBulkWA');

  // Daemon not running at all
  if (!s || s.daemon !== 'running') {
    el.className = 'status error';
    el.innerHTML = '❌ Daemon לא רץ<span class="small">הפעל את הקיצור "D.Yohai Bulk Sender" על שולחן העבודה</span>';
    btn.disabled = true;
    btn.textContent = 'Daemon לא רץ';
    return;
  }

  // Daemon running but Chrome Test session not logged in
  if (!s.wa_logged_in) {
    el.className = 'status warn';
    el.innerHTML = '⚠️ Daemon רץ - WA לא מחובר<span class="small">לחץ למטה לפתיחת Chrome Test וסריקת QR</span>';
    btn.disabled = false;
    btn.textContent = 'פתח Chrome Test לסריקת QR';
    return;
  }

  // All good
  el.className = 'status ok';
  el.innerHTML = `✅ מוכן לשליחה המונית<span class="small">Daemon v${s.version || '?'} · Chrome Test מחובר</span>`;
  btn.disabled = false;
  btn.textContent = 'פתח Chrome Test (לבדיקה)';
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'GET_BRIDGE_STATUS' }, (resp) => {
    renderPiba(resp?.piba);
    renderHopOn(resp?.hopon);
  });
  chrome.runtime.sendMessage({ type: 'WHATSAPP_GET_STATUS' }, (resp) => {
    renderWhatsApp(resp);
  });
  chrome.runtime.sendMessage({ type: 'BULK_DAEMON_STATUS' }, (resp) => {
    renderBulkDaemon(resp);
  });
}

document.getElementById('openPiba').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_PIBA' });
  window.close();
});

document.getElementById('openHopOn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_HOPON' });
  window.close();
});

document.getElementById('openWhatsApp').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_WHATSAPP' });
  window.close();
});

document.getElementById('openBulkWA').addEventListener('click', () => {
  const btn = document.getElementById('openBulkWA');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'פותח Chrome Test...';
  chrome.runtime.sendMessage({ type: 'BULK_OPEN_WHATSAPP' }, (resp) => {
    if (chrome.runtime.lastError || !resp || resp.error) {
      btn.disabled = false;
      btn.textContent = 'נכשל - נסה שוב';
      console.error('BULK_OPEN_WHATSAPP failed:', chrome.runtime.lastError || resp);
      return;
    }
    // Success - close popup, user will see Chrome Test window
    window.close();
  });
});

refresh();
setInterval(refresh, 2000);
