/*
  CHRONA - BACKGROUND SERVICE WORKER (background.js)
  A production-ready, highly robust, event-driven tracking service worker.

  Key architectural practices implemented:
  1. Asynchronous state-restoration & synchronization with chrome.storage.local.
  2. Prevention of race-conditions via an initialization lock (ensureInitialized).
  3. Incremental 1-minute active time flushing to prevent data loss on crashes/sleep.
  4. Fully event-driven design conforming to standard Manifest V3 lifecycle constraints.
  5. Strict error checking with chrome.runtime.lastError handling.
*/

// Transient background state (synchronized with chrome.storage.local)
let state = {
  active_domain: null,
  start_timestamp: 0,
  is_paused: false,
  pause_until: null,
  idle_state: 'active' // 'active', 'idle', 'locked'
};

const DEFAULT_SETTINGS = {
  idle_threshold_seconds: 60,
  category_overrides: {}
};

// Initialization Promise Lock to ensure transient state is fully restored
// before any event listeners (tabs, windows, idle) modify or interact with it.
let initPromise = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = new Promise((resolve) => {
      chrome.storage.local.get(['live_state', 'settings'], (res) => {
        if (chrome.runtime.lastError) {
          console.error('[Chrona] Storage read error during init:', chrome.runtime.lastError);
        }

        const settings = (res && res.settings) || DEFAULT_SETTINGS;

        // 1. Configure idle detection threshold
        const idleSeconds = settings.idle_threshold_seconds || 60;
        try {
          chrome.idle.setDetectionInterval(idleSeconds);
        } catch (err) {
          console.error('[Chrona] Failed to set idle detection interval:', err);
        }

        // 2. Setup periodic 1-minute background alarm for incremental time flushing
        chrome.alarms.get('flush_active_time', (alarm) => {
          if (!alarm) {
            chrome.alarms.create('flush_active_time', { periodInMinutes: 1 });
          }
        });

        // 3. Restore last recorded active tracking session
        if (res && res.live_state) {
          const ls = res.live_state;
          state.active_domain = ls.active_domain || null;
          state.start_timestamp = ls.start_timestamp || 0;
          state.is_paused = !!ls.is_paused;
          state.pause_until = ls.pause_until || null;
          state.idle_state = ls.idle_state || 'active';

          // Handle real-time pause expiration
          if (state.is_paused && state.pause_until && Date.now() > state.pause_until) {
            state.is_paused = false;
            state.pause_until = null;
          }
        }

        resolve();
      });
    });
  }
  return initPromise;
}

// Installation Hook
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }

  chrome.storage.local.get(['settings'], (res) => {
    if (chrome.runtime.lastError) return;
    if (!res || !res.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

// Initial worker startup call
chrome.runtime.onStartup.addListener(() => {
  ensureInitialized().then(evaluateActiveTab);
});

// Self-invocation context in case worker loaded or reloaded outside start event
ensureInitialized().then(evaluateActiveTab);

// Helper to extract clean web hostnames
function extractHostname(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    if (['http:', 'https:', 'ftp:'].includes(urlObj.protocol)) {
      let hostname = urlObj.hostname;
      if (hostname.startsWith('www.')) {
        hostname = hostname.substring(4);
      }
      return hostname;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Primary tab evaluation logic
function evaluateActiveTab() {
  chrome.windows.getLastFocused({ populate: true }, (window) => {
    if (chrome.runtime.lastError) {
      handleStateTransition(null);
      return;
    }
    if (!window || !window.focused) {
      handleStateTransition(null);
      return;
    }

    const activeTab = window.tabs ? window.tabs.find(t => t.active) : null;
    if (activeTab && activeTab.url) {
      const domain = extractHostname(activeTab.url);
      handleStateTransition(domain, activeTab.title, activeTab.favIconUrl);
    } else {
      handleStateTransition(null);
    }
  });
}

// State transition and time calculation controller
function handleStateTransition(newDomain, title = null, favIconUrl = null) {
  const now = Date.now();

  // Real-time evaluation of pause duration limits
  if (state.is_paused && state.pause_until && now > state.pause_until) {
    state.is_paused = false;
    state.pause_until = null;
  }

  const shouldTrack = !state.is_paused && state.idle_state === 'active' && newDomain !== null;
  const wasTracking = state.active_domain !== null;

  if (wasTracking) {
    const elapsedMs = now - state.start_timestamp;

    // Avoid double logging: accumulate all elapsed seconds since session anchor
    if (elapsedMs > 0) {
      const elapsedSec = Math.floor(elapsedMs / 1000);
      if (elapsedSec > 0) {
        accumulateTime(state.active_domain, elapsedSec);
      }
    }
  }

  if (shouldTrack) {
    state.active_domain = newDomain;
    state.start_timestamp = now;

    if (title || favIconUrl) {
      updateDomainMetadata(newDomain, title, favIconUrl);
    }
  } else {
    state.active_domain = null;
    state.start_timestamp = 0;
  }

  persistLiveState();
}

// Flush currently elapsed tracking session time incrementally (called by periodic alarms)
function flushActiveTime() {
  const now = Date.now();
  if (state.active_domain && !state.is_paused && state.idle_state === 'active') {
    const elapsedMs = now - state.start_timestamp;
    if (elapsedMs > 0) {
      const elapsedSec = Math.floor(elapsedMs / 1000);
      if (elapsedSec > 0) {
        accumulateTime(state.active_domain, elapsedSec);
        // Reset start timestamp anchor to avoid double tracking
        state.start_timestamp = now;
        persistLiveState();
      }
    }
  }
}

// Save domain metadata descriptors
function updateDomainMetadata(domain, title, favIconUrl) {
  chrome.storage.local.get(['domain_metadata'], (res) => {
    if (chrome.runtime.lastError) return;
    const metadata = (res && res.domain_metadata) || {};
    metadata[domain] = {
      title: title || (metadata[domain] ? metadata[domain].title : domain),
      favIconUrl: favIconUrl || (metadata[domain] ? metadata[domain].favIconUrl : null)
    };
    chrome.storage.local.set({ domain_metadata: metadata });
  });
}

// Synchronize transient variables with chrome.storage.local
function persistLiveState() {
  chrome.storage.local.set({
    live_state: {
      active_domain: state.active_domain,
      start_timestamp: state.start_timestamp,
      is_paused: state.is_paused,
      pause_until: state.pause_until,
      idle_state: state.idle_state
    }
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('[Chrona] Persistent storage state save failure:', chrome.runtime.lastError);
    }
  });
}

// Increment tracked statistics under daily key bucket
function accumulateTime(domain, seconds) {
  if (!domain || seconds <= 0) return;

  const dateStr = new Date().toISOString().split('T')[0];
  const storageKey = `day:${dateStr}`;

  chrome.storage.local.get([storageKey], (res) => {
    if (chrome.runtime.lastError) return;

    const dayData = (res && res[storageKey]) || { total_seconds: 0, domains: {} };
    dayData.total_seconds = (dayData.total_seconds || 0) + seconds;
    dayData.domains[domain] = (dayData.domains[domain] || 0) + seconds;

    const updateObj = {};
    updateObj[storageKey] = dayData;
    chrome.storage.local.set(updateObj);
  });
}

/* Event listeners */

// 1. Tab activated inside window focus context
chrome.tabs.onActivated.addListener(() => {
  ensureInitialized().then(evaluateActiveTab);
});

// 2. Tab URL loading updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    ensureInitialized().then(evaluateActiveTab);
  }
});

// 3. Browser OS Window focus toggles
chrome.windows.onFocusChanged.addListener(() => {
  ensureInitialized().then(evaluateActiveTab);
});

// 4. Idle context change listeners
chrome.idle.onStateChanged.addListener((newIdleState) => {
  ensureInitialized().then(() => {
    state.idle_state = newIdleState;

    if (newIdleState === 'active') {
      evaluateActiveTab();
    } else {
      // Commit pending tracking time immediately upon leaving active focus
      chrome.storage.local.get(['settings'], (res) => {
        if (chrome.runtime.lastError) return;
        const settings = (res && res.settings) || DEFAULT_SETTINGS;
        const threshold = settings.idle_threshold_seconds || 60;

        const now = Date.now();
        if (state.active_domain) {
          const elapsedMs = now - state.start_timestamp;
          const totalSec = Math.floor(elapsedMs / 1000);

          // Deduct threshold latency compensation for absolute precision
          const activeSec = Math.max(0, totalSec - threshold);
          if (activeSec > 0) {
            accumulateTime(state.active_domain, activeSec);
          }
        }

        state.active_domain = null;
        state.start_timestamp = 0;
        persistLiveState();
      });
    }
  });
});

// 5. Periodic alarms for background persistence and flushing
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush_active_time') {
    ensureInitialized().then(flushActiveTime);
  }
});

// 6. Runtime message controller
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ensureInitialized().then(() => {
    if (message.action === 'getState') {
      if (state.is_paused && state.pause_until && Date.now() > state.pause_until) {
        state.is_paused = false;
        state.pause_until = null;
        persistLiveState();
      }

      sendResponse({
        active_domain: state.active_domain,
        start_timestamp: state.start_timestamp,
        is_paused: state.is_paused,
        pause_until: state.pause_until,
        idle_state: state.idle_state
      });
    }

    else if (message.action === 'togglePause') {
      const durationMin = parseInt(message.durationMinutes, 10);

      if (message.isPaused) {
        state.is_paused = true;
        state.pause_until = durationMin > 0 ? Date.now() + durationMin * 60 * 1000 : null;
      } else {
        state.is_paused = false;
        state.pause_until = null;
      }

      evaluateActiveTab();
      sendResponse({ success: true, is_paused: state.is_paused, pause_until: state.pause_until });
    }

    else if (message.action === 'settingsChanged') {
      // Re-trigger initialization block with new configs
      initPromise = null;
      ensureInitialized().then(() => {
        evaluateActiveTab();
        sendResponse({ success: true });
      });
    }
  });

  return true; // Keep communication channel open
});
