/*
  CHRONA - BACKGROUND SERVICE WORKER (background.js)
  An event-driven, passive tracking engine that respects resource limits and user privacy.
  No content scripts. No page modifications. No polling.
*/

// Initial State Cache
let state = {
  active_domain: null,
  start_timestamp: 0,
  is_paused: false,
  pause_until: null,
  idle_state: 'active' // 'active', 'idle', 'locked'
};

// Default settings
const DEFAULT_SETTINGS = {
  idle_threshold_seconds: 60,
  category_overrides: {}
};

// Onboarding: Open onboarding page on installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }

  // Set default settings if not already present
  chrome.storage.local.get(['settings'], (res) => {
    if (!res.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

// Recover state on startup / worker wake-up
chrome.runtime.onStartup.addListener(initializeTracking);
initializeTracking();

function initializeTracking() {
  chrome.storage.local.get(['live_state', 'settings'], (res) => {
    const settings = res.settings || DEFAULT_SETTINGS;

    // Set up idle detection based on user configuration
    const idleSeconds = settings.idle_threshold_seconds || 60;
    chrome.idle.setDetectionInterval(idleSeconds);

    if (res.live_state) {
      state.is_paused = !!res.live_state.is_paused;
      state.pause_until = res.live_state.pause_until || null;

      // Handle auto-resume check
      if (state.is_paused && state.pause_until && Date.now() > state.pause_until) {
        state.is_paused = false;
        state.pause_until = null;
      }
    }

    // Trigger initial tracking evaluation
    evaluateActiveTab();
  });
}

// Extract hostname cleanly, discarding paths, query params, hashes and sub-routes
function extractHostname(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    if (['http:', 'https:', 'ftp:'].includes(urlObj.protocol)) {
      // Return hostname, e.g. "github.com" or "www.youtube.com"
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

// Get the current focused Chrome Window and active tab
function evaluateActiveTab() {
  chrome.windows.getLastFocused({ populate: true }, (window) => {
    if (chrome.runtime.lastError || !window) {
      handleStateTransition(null);
      return;
    }

    // If Chrome does not have OS focus, pause tracking
    if (!window.focused) {
      handleStateTransition(null);
      return;
    }

    // Find the active tab in the focused window
    const activeTab = window.tabs ? window.tabs.find(t => t.active) : null;
    if (activeTab && activeTab.url) {
      const domain = extractHostname(activeTab.url);
      handleStateTransition(domain, activeTab.title, activeTab.favIconUrl);
    } else {
      handleStateTransition(null);
    }
  });
}

// Logic to handle state transition (domain focus changes, pause/resume, lock state)
function handleStateTransition(newDomain, title = null, favIconUrl = null) {
  const now = Date.now();

  // Check pause expirations
  if (state.is_paused && state.pause_until && now > state.pause_until) {
    state.is_paused = false;
    state.pause_until = null;
  }

  const shouldTrack = !state.is_paused && state.idle_state === 'active' && newDomain !== null;
  const wasTracking = state.active_domain !== null;

  if (wasTracking) {
    // Record elapsed time for the previous domain
    const elapsedMs = now - state.start_timestamp;

    // Edge case: sleep/wake boundary check
    // If the elapsed time is larger than 5 minutes (300,000ms), we treat it as a sleep disruption
    // and discard the large tracking block, starting fresh.
    if (elapsedMs > 0 && elapsedMs < 300000) {
      const elapsedSec = Math.floor(elapsedMs / 1000);
      if (elapsedSec > 0) {
        accumulateTime(state.active_domain, elapsedSec);
      }
    }
  }

  // If we are about to track a new domain, let's save its tab title and favicon metadata if present
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

// Store most recent tab metadata (title and favicon) for each domain
function updateDomainMetadata(domain, title, favIconUrl) {
  chrome.storage.local.get(['domain_metadata'], (res) => {
    const metadata = res.domain_metadata || {};
    metadata[domain] = {
      title: title || (metadata[domain] ? metadata[domain].title : domain),
      favIconUrl: favIconUrl || (metadata[domain] ? metadata[domain].favIconUrl : null)
    };
    chrome.storage.local.set({ domain_metadata: metadata });
  });
}

// Save active session status to storage so it survives worker suspension
function persistLiveState() {
  chrome.storage.local.set({
    live_state: {
      active_domain: state.active_domain,
      start_timestamp: state.start_timestamp,
      is_paused: state.is_paused,
      pause_until: state.pause_until
    }
  });
}

// Accumulate duration to daily bucket
function accumulateTime(domain, seconds) {
  if (!domain || seconds <= 0) return;

  // Construct daily date string, e.g. "day:2023-11-24"
  const dateStr = new Date().toISOString().split('T')[0];
  const storageKey = `day:${dateStr}`;

  chrome.storage.local.get([storageKey], (res) => {
    let dayData = res[storageKey] || { total_seconds: 0, domains: {} };

    dayData.total_seconds = (dayData.total_seconds || 0) + seconds;
    dayData.domains[domain] = (dayData.domains[domain] || 0) + seconds;

    const updateObj = {};
    updateObj[storageKey] = dayData;
    chrome.storage.local.set(updateObj);
  });
}

/* Event listeners for Chrome changes */

// 1. Tab changes focus inside the same window
chrome.tabs.onActivated.addListener(() => {
  evaluateActiveTab();
});

// 2. Tab loads new URL or finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    evaluateActiveTab();
  }
});

// 3. Chrome Window focus changes (OS window level focus switching)
chrome.windows.onFocusChanged.addListener(() => {
  evaluateActiveTab();
});

// 4. Idle State Changes
chrome.idle.onStateChanged.addListener((newIdleState) => {
  state.idle_state = newIdleState;

  if (newIdleState === 'active') {
    // Resume active session
    evaluateActiveTab();
  } else {
    // Transitioning to 'idle' or 'locked' -> commit any accrued time up to this transition
    // Retroactively subtract the idle threshold configuration to maintain strict mathematical precision.
    chrome.storage.local.get(['settings'], (res) => {
      const settings = res.settings || DEFAULT_SETTINGS;
      const threshold = settings.idle_threshold_seconds || 60;

      const now = Date.now();
      if (state.active_domain) {
        const elapsedMs = now - state.start_timestamp;
        const totalSec = Math.floor(elapsedMs / 1000);

        // Subtract threshold to compensate for the delayed idle notification
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

// Handle runtime messages from Popup and Dashboard Pages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getState') {
    // Check if pause has expired in real-time
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
    initializeTracking();
    sendResponse({ success: true });
  }

  return true; // Keep message channel open for async response
});
