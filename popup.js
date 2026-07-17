/*
  CHRONA - POPUP CONTROLLER (popup.js)
  A sparse, responsive controller updating today's metrics, current site focus, and top 3 sites.
*/

document.addEventListener('DOMContentLoaded', () => {
  const pulsingDot = document.getElementById('pulsing-dot');
  const trackingStatus = document.getElementById('tracking-status');
  const totalTimeText = document.getElementById('total-time-today');
  const activeSiteText = document.getElementById('active-site-text');
  const topSitesList = document.getElementById('top-sites-list');
  const btnPause = document.getElementById('btn-pause-tracking');
  const linkDashboard = document.getElementById('link-dashboard');

  let localState = {
    active_domain: null,
    start_timestamp: 0,
    is_paused: false,
    pause_until: null,
    idle_state: 'active'
  };

  // Format seconds to text, e.g. "02h 14m" or "42s"
  function formatDuration(totalSeconds) {
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const hStr = hours < 10 ? `0${hours}` : hours;
    const mStr = minutes < 10 ? `0${minutes}` : minutes;
    return `${hStr}h ${mStr}m`;
  }

  // Retrieve today's date string, e.g. "day:2023-11-24"
  function getTodayKey() {
    return `day:${new Date().toISOString().split('T')[0]}`;
  }

  function updateUI() {
    chrome.storage.local.get([getTodayKey()], (res) => {
      const todayData = res[getTodayKey()] || { total_seconds: 0, domains: {} };
      let totalSeconds = todayData.total_seconds || 0;

      // Calculate current active session delta in real-time
      let currentSessionDelta = 0;
      if (localState.active_domain && !localState.is_paused && localState.idle_state === 'active') {
        currentSessionDelta = Math.floor((Date.now() - localState.start_timestamp) / 1000);
        if (currentSessionDelta > 0) {
          totalSeconds += currentSessionDelta;
        }
      }

      // 1. Render today's total time
      totalTimeText.textContent = formatDuration(totalSeconds);

      // 2. Render tracking state and current active domain
      if (localState.is_paused) {
        pulsingDot.className = 'logo-dot';
        pulsingDot.style.backgroundColor = 'var(--text-muted)';

        if (localState.pause_until) {
          const remainingMin = Math.ceil((localState.pause_until - Date.now()) / 60000);
          trackingStatus.textContent = remainingMin > 0 ? `paused (${remainingMin}m)` : 'paused';
        } else {
          trackingStatus.textContent = 'paused';
        }

        activeSiteText.textContent = 'tracking is paused';
        btnPause.textContent = 'Resume Tracking';
      } else if (localState.idle_state !== 'active') {
        pulsingDot.className = 'logo-dot';
        pulsingDot.style.backgroundColor = 'var(--text-muted)';
        trackingStatus.textContent = localState.idle_state;
        activeSiteText.textContent = 'system is idle';
        btnPause.textContent = 'Pause Tracking';
      } else if (localState.active_domain) {
        pulsingDot.className = 'logo-dot pulsing';
        pulsingDot.style.backgroundColor = 'var(--accent-teal)';
        trackingStatus.textContent = 'tracking';
        activeSiteText.textContent = localState.active_domain;
        btnPause.textContent = 'Pause Tracking';
      } else {
        pulsingDot.className = 'logo-dot';
        pulsingDot.style.backgroundColor = 'var(--text-muted)';
        trackingStatus.textContent = 'idle';
        activeSiteText.textContent = 'no active browser focus';
        btnPause.textContent = 'Pause Tracking';
      }

      // 3. Process and display top 3 sites today
      const domainMap = { ...todayData.domains };
      if (localState.active_domain && currentSessionDelta > 0 && !localState.is_paused) {
        domainMap[localState.active_domain] = (domainMap[localState.active_domain] || 0) + currentSessionDelta;
      }

      const sortedDomains = Object.keys(domainMap)
        .map(domain => ({ domain, seconds: domainMap[domain] }))
        .sort((a, b) => b.seconds - a.seconds);

      if (sortedDomains.length === 0) {
        topSitesList.innerHTML = `<div class="text-muted" style="font-size: 12px; text-align: center; padding: 12px 0;">No active history recorded yet today.</div>`;
      } else {
        topSitesList.innerHTML = '';
        const maxSites = Math.min(3, sortedDomains.length);
        const topSec = sortedDomains[0].seconds || 1; // used for proportional bar widths

        for (let i = 0; i < maxSites; i++) {
          const item = sortedDomains[i];
          const pct = Math.round((item.seconds / topSec) * 100);

          const row = document.createElement('div');
          row.className = 'top-site-row';

          const info = document.createElement('div');
          info.className = 'top-site-info';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'top-site-name';
          nameSpan.textContent = item.domain;

          const timeSpan = document.createElement('span');
          timeSpan.className = 'top-site-time';
          timeSpan.textContent = formatDuration(item.seconds);

          info.appendChild(nameSpan);
          info.appendChild(timeSpan);

          const bar = document.createElement('div');
          bar.className = 'top-site-bar';

          const fill = document.createElement('div');
          fill.className = 'top-site-bar-fill';
          fill.style.width = `${pct}%`;

          bar.appendChild(fill);
          row.appendChild(info);
          row.appendChild(bar);

          topSitesList.appendChild(row);
        }
      }
    });
  }

  function fetchState() {
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
      if (response) {
        localState = response;
        updateUI();
      }
    });
  }

  // Toggle Pause Event
  btnPause.addEventListener('click', () => {
    const isPaising = !localState.is_paused;
    // For MVP simple pause, we pause for 30 minutes
    const durationMinutes = isPaising ? 30 : 0;

    chrome.runtime.sendMessage({
      action: 'togglePause',
      isPaused: isPaising,
      durationMinutes: durationMinutes
    }, (res) => {
      if (res && res.success) {
        localState.is_paused = res.is_paused;
        localState.pause_until = res.pause_until;
        updateUI();
      }
    });
  });

  // Open Dashboard page
  linkDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Fetch immediately and poll every second to update the timer text smoothly
  fetchState();
  const pollInterval = setInterval(fetchState, 1000);

  // Cleanup interval on page unload
  window.addEventListener('unload', () => {
    clearInterval(pollInterval);
  });
});
