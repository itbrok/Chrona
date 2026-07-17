/*
  CHRONA - DASHBOARD WORKSPACE CONTROLLER (dashboard.js)
  Renders premium visual metrics, category distributions, searchable explorers, and handles settings.
*/

document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const statTotalToday = document.getElementById('stat-total-today');
  const statTodaySub = document.getElementById('stat-today-sub');
  const statFocusDomain = document.getElementById('stat-focus-domain');
  const statFocusSub = document.getElementById('stat-focus-sub');
  const statTopCategory = document.getElementById('stat-top-category');
  const statCategorySub = document.getElementById('stat-category-sub');

  const headerPulsingDot = document.getElementById('header-pulsing-dot');
  const headerStatusText = document.getElementById('header-tracking-status');
  const btnToggleActive = document.getElementById('btn-toggle-tracking');
  const btnTogglePaused = document.getElementById('btn-toggle-paused');

  const weeklyTimelineGroup = document.getElementById('weekly-timeline-group');
  const donutSegmentsGroup = document.getElementById('donut-segments-group');
  const donutTotalText = document.getElementById('donut-total-text');

  const explorerSearch = document.getElementById('explorer-search');
  const explorerFilterCategory = document.getElementById('explorer-filter-category');
  const explorerTableBody = document.getElementById('explorer-table-body');
  const explorerCountText = document.getElementById('explorer-count');

  const inputIdleThreshold = document.getElementById('input-idle-threshold');
  const inputDailyGoal = document.getElementById('input-daily-goal');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const settingsAlert = document.getElementById('settings-alert');

  // Pre-bundled core domain categorization lookup
  const BUNDLED_CATEGORIES = {
    // Productivity
    'github.com': 'Productivity',
    'github.dev': 'Productivity',
    'gitlab.com': 'Productivity',
    'stackoverflow.com': 'Productivity',
    'figma.com': 'Productivity',
    'linear.app': 'Productivity',
    'notion.so': 'Productivity',
    'docs.google.com': 'Productivity',
    'sheets.google.com': 'Productivity',
    'slack.com': 'Productivity',
    'zoom.us': 'Productivity',
    'meet.google.com': 'Productivity',
    'asana.com': 'Productivity',
    'trello.com': 'Productivity',
    'canva.com': 'Productivity',

    // Education
    'wikipedia.org': 'Education',
    'coursera.org': 'Education',
    'udemy.com': 'Education',
    'khanacademy.org': 'Education',
    'edx.org': 'Education',
    'duolingo.com': 'Education',
    'medium.com': 'Education',
    'arxiv.org': 'Education',
    'w3schools.com': 'Education',
    'mdn.mozilla.org': 'Education',
    'developer.chrome.com': 'Education',

    // Entertainment
    'youtube.com': 'Entertainment',
    'netflix.com': 'Entertainment',
    'twitch.tv': 'Entertainment',
    'spotify.com': 'Entertainment',
    'disneyplus.com': 'Entertainment',
    'hulu.com': 'Entertainment',
    'reddit.com': 'Entertainment',
    'twitter.com': 'Entertainment',
    'x.com': 'Entertainment',
    'facebook.com': 'Entertainment',
    'instagram.com': 'Entertainment',
    'tiktok.com': 'Entertainment',
    'amazon.com': 'Entertainment',
    'ebay.com': 'Entertainment'
  };

  const CATEGORY_COLORS = {
    'Productivity': 'var(--cat-productivity)',
    'Education': 'var(--cat-education)',
    'Entertainment': 'var(--cat-entertainment)',
    'Uncategorized': 'var(--cat-uncategorized)'
  };

  let systemState = {
    active_domain: null,
    start_timestamp: 0,
    is_paused: false,
    pause_until: null,
    idle_state: 'active'
  };

  let globalSettings = {
    idle_threshold_seconds: 60,
    daily_goal_seconds: 10800,
    category_overrides: {}
  };

  // Format seconds to text, e.g. "02h 14m" or "45s"
  function formatDuration(totalSeconds) {
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const hStr = hours < 10 ? `0${hours}` : hours;
    const mStr = minutes < 10 ? `0${minutes}` : minutes;

    if (hours > 0) {
      return `${hStr}h ${mStr}m`;
    }
    return `${mStr}m`;
  }

  // Get domain categorization mapping
  function getDomainCategory(domain) {
    if (globalSettings.category_overrides && globalSettings.category_overrides[domain]) {
      return globalSettings.category_overrides[domain];
    }
    return BUNDLED_CATEGORIES[domain] || 'Uncategorized';
  }

  // Fetch the active state and update tracking metrics
  function refreshState() {
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
      if (response) {
        systemState = response;
        renderHeaderState();
        loadDashboardMetrics();
      }
    });
  }

  function renderHeaderState() {
    if (systemState.is_paused) {
      headerPulsingDot.className = 'logo-dot';
      headerPulsingDot.style.backgroundColor = 'var(--text-muted)';
      headerStatusText.textContent = 'tracking is paused';

      btnToggleActive.className = '';
      btnTogglePaused.className = 'active';
    } else if (systemState.idle_state !== 'active') {
      headerPulsingDot.className = 'logo-dot';
      headerPulsingDot.style.backgroundColor = 'var(--text-muted)';
      headerStatusText.textContent = `system is ${systemState.idle_state}`;

      btnToggleActive.className = 'active';
      btnTogglePaused.className = '';
    } else if (systemState.active_domain) {
      headerPulsingDot.className = 'logo-dot pulsing';
      headerPulsingDot.style.backgroundColor = 'var(--accent-teal)';
      headerStatusText.textContent = 'tracking active';

      btnToggleActive.className = 'active';
      btnTogglePaused.className = '';
    } else {
      headerPulsingDot.className = 'logo-dot';
      headerPulsingDot.style.backgroundColor = 'var(--text-muted)';
      headerStatusText.textContent = 'awaiting active tab';

      btnToggleActive.className = 'active';
      btnTogglePaused.className = '';
    }
  }

  // Handle active status toggle buttons
  btnToggleActive.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'togglePause', isPaused: false }, () => {
      refreshState();
    });
  });

  btnTogglePaused.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'togglePause', isPaused: true, durationMinutes: 60 }, () => {
      refreshState();
    });
  });

  // Load configuration and aggregates
  function loadDashboardMetrics() {
    chrome.storage.local.get(['settings'], (settingsRes) => {
      if (settingsRes.settings) {
        globalSettings = { ...globalSettings, ...settingsRes.settings };
      }

      // Update config panel selectors with active loaded values
      inputIdleThreshold.value = globalSettings.idle_threshold_seconds || 60;
      inputDailyGoal.value = globalSettings.daily_goal_seconds || 10800;

      // Construct dates for the past 7 days
      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7Days.push(d.toISOString().split('T')[0]);
      }

      const dayKeys = last7Days.map(date => `day:${date}`);

      chrome.storage.local.get(dayKeys, (storageRes) => {
        // Today's Date String
        const todayStr = last7Days[6];
        const todayData = storageRes[`day:${todayStr}`] || { total_seconds: 0, domains: {} };

        let totalTodaySec = todayData.total_seconds || 0;
        let todayDomains = { ...todayData.domains };

        // Add active session live delta in real-time
        let currentSessionDelta = 0;
        if (systemState.active_domain && !systemState.is_paused && systemState.idle_state === 'active') {
          currentSessionDelta = Math.floor((Date.now() - systemState.start_timestamp) / 1000);
          if (currentSessionDelta > 0) {
            totalTodaySec += currentSessionDelta;
            todayDomains[systemState.active_domain] = (todayDomains[systemState.active_domain] || 0) + currentSessionDelta;
          }
        }

        // Render Card 1: Today Active Total
        statTotalToday.textContent = formatDuration(totalTodaySec);

        const goalSeconds = globalSettings.daily_goal_seconds || 10800;
        const pctGoal = Math.round((totalTodaySec / goalSeconds) * 100);
        statTodaySub.textContent = `${pctGoal}% of your daily voluntary goal (${formatDuration(goalSeconds)})`;

        // Render Card 2: Current Focused Website
        if (systemState.is_paused) {
          statFocusDomain.textContent = 'Paused';
          statFocusSub.textContent = 'Manual tracker pause active';
        } else if (systemState.idle_state !== 'active') {
          statFocusDomain.textContent = 'Idle';
          statFocusSub.textContent = 'System has gone idle';
        } else if (systemState.active_domain) {
          statFocusDomain.textContent = systemState.active_domain;
          statFocusSub.textContent = 'Currently holding browser focus';
        } else {
          statFocusDomain.textContent = 'none';
          statFocusSub.textContent = 'No active window focus';
        }

        // Aggregate categories and render Card 3: Top Category
        const categorySeconds = {
          'Productivity': 0,
          'Education': 0,
          'Entertainment': 0,
          'Uncategorized': 0
        };

        Object.keys(todayDomains).forEach(domain => {
          const cat = getDomainCategory(domain);
          categorySeconds[cat] = (categorySeconds[cat] || 0) + todayDomains[domain];
        });

        let topCat = 'Uncategorized';
        let topCatSec = -1;
        Object.keys(categorySeconds).forEach(cat => {
          if (categorySeconds[cat] > topCatSec) {
            topCatSec = categorySeconds[cat];
            topCat = cat;
          }
        });

        statTopCategory.textContent = topCatSec > 0 ? topCat : 'none';
        statTopCategory.style.color = topCatSec > 0 ? CATEGORY_COLORS[topCat] : 'var(--text-primary)';
        statCategorySub.textContent = topCatSec > 0 ? `${formatDuration(topCatSec)} spent today` : 'No categories tracked today';

        // Render SVG Donut Chart
        renderDonutChart(categorySeconds, totalTodaySec);

        // Render Timeline Charts (past 7 days)
        renderWeeklyTimeline(last7Days, storageRes, todayStr, currentSessionDelta);

        // Render Table Explorer with filters
        renderTableExplorer(todayDomains);
      });
    });
  }

  function renderDonutChart(categorySeconds, totalSeconds) {
    donutTotalText.textContent = formatDuration(totalSeconds);
    donutSegmentsGroup.innerHTML = '';

    if (totalSeconds === 0) {
      return;
    }

    const radius = 60;
    const circumference = 2 * Math.PI * radius; // ~376.99
    let accumulatedOffset = 0;

    // Categories sorted in order of preference
    const categories = ['Productivity', 'Education', 'Entertainment', 'Uncategorized'];

    categories.forEach(cat => {
      const sec = categorySeconds[cat] || 0;
      if (sec === 0) return;

      const pct = sec / totalSeconds;
      const strokeLength = pct * circumference;
      const strokeOffset = circumference - accumulatedOffset;

      const circleSegment = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circleSegment.setAttribute('class', 'donut-segment');
      circleSegment.setAttribute('cx', '80');
      circleSegment.setAttribute('cy', '80');
      circleSegment.setAttribute('r', radius.toString());
      circleSegment.setAttribute('stroke-width', '12');
      circleSegment.setAttribute('stroke', CATEGORY_COLORS[cat]);
      circleSegment.setAttribute('stroke-dasharray', `${strokeLength} ${circumference - strokeLength}`);
      circleSegment.setAttribute('stroke-dashoffset', strokeOffset.toString());

      donutSegmentsGroup.appendChild(circleSegment);
      accumulatedOffset += strokeLength;
    });
  }

  function renderWeeklyTimeline(last7Days, storageRes, todayStr, currentSessionDelta) {
    // Collect daily totals
    const dailyTotals = last7Days.map(date => {
      const dayData = storageRes[`day:${date}`] || { total_seconds: 0 };
      let secs = dayData.total_seconds || 0;

      // Inject real-time session update for today
      if (date === todayStr) {
        secs += currentSessionDelta;
      }
      return secs;
    });

    const maxDailySec = Math.max(...dailyTotals, 1); // Avoid division by zero

    weeklyTimelineGroup.innerHTML = '';

    const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    last7Days.forEach((date, index) => {
      const secs = dailyTotals[index];
      const pct = Math.min(100, Math.round((secs / maxDailySec) * 100));

      const dayObj = new Date(date + 'T00:00:00');
      const label = weekdayLabels[dayObj.getDay()];

      const col = document.createElement('div');
      col.className = 'timeline-bar-col';
      col.title = `${date}: ${formatDuration(secs)}`;

      const wrapper = document.createElement('div');
      wrapper.className = 'timeline-bar-wrapper';

      const fill = document.createElement('div');
      fill.className = 'timeline-bar-fill';
      fill.style.height = `${pct}%`;

      wrapper.appendChild(fill);

      const span = document.createElement('span');
      span.className = 'timeline-bar-label';
      span.textContent = label;

      col.appendChild(wrapper);
      col.appendChild(span);

      weeklyTimelineGroup.appendChild(col);
    });
  }

  function renderTableExplorer(todayDomains) {
    const filterTerm = explorerSearch.value.toLowerCase().trim();
    const filterCat = explorerFilterCategory.value;

    // Convert domains map to sorted array
    let tableItems = Object.keys(todayDomains).map(domain => ({
      domain,
      seconds: todayDomains[domain],
      category: getDomainCategory(domain)
    }));

    // Apply Search and Category filter
    tableItems = tableItems.filter(item => {
      const matchSearch = item.domain.toLowerCase().includes(filterTerm);
      const matchCat = filterCat === 'ALL' || item.category === filterCat;
      return matchSearch && matchCat;
    });

    // Sort by duration descending
    tableItems.sort((a, b) => b.seconds - a.seconds);

    explorerCountText.textContent = `${tableItems.length} domain${tableItems.length === 1 ? '' : 's'}`;

    explorerTableBody.innerHTML = '';

    if (tableItems.length === 0) {
      explorerTableBody.innerHTML = `
        <tr>
          <td colspan="3" class="text-muted" style="text-align: center; padding: 24px;">No domains found matching criteria.</td>
        </tr>
      `;
      return;
    }

    tableItems.forEach(item => {
      const tr = document.createElement('tr');

      const tdDomain = document.createElement('td');
      tdDomain.className = 'monospace';
      tdDomain.textContent = item.domain;

      const tdCategory = document.createElement('td');
      const select = document.createElement('select');
      select.className = 'category-dropdown';

      ['Productivity', 'Education', 'Entertainment', 'Uncategorized'].forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        if (cat === item.category) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      // Handle Category reclassification change inline
      select.addEventListener('change', () => {
        const newCat = select.value;
        globalSettings.category_overrides = globalSettings.category_overrides || {};
        globalSettings.category_overrides[item.domain] = newCat;

        chrome.storage.local.set({ settings: globalSettings }, () => {
          chrome.runtime.sendMessage({ action: 'settingsChanged' }, () => {
            loadDashboardMetrics();
          });
        });
      });

      tdCategory.appendChild(select);

      const tdTime = document.createElement('td');
      tdTime.className = 'monospace';
      tdTime.style.textAlign = 'right';
      tdTime.textContent = formatDuration(item.seconds);

      tr.appendChild(tdDomain);
      tr.appendChild(tdCategory);
      tr.appendChild(tdTime);

      explorerTableBody.appendChild(tr);
    });
  }

  // Filter and search trigger bindings
  explorerSearch.addEventListener('input', () => {
    refreshState();
  });

  explorerFilterCategory.addEventListener('change', () => {
    refreshState();
  });

  // Handle configuration edits
  btnSaveSettings.addEventListener('click', () => {
    const idleVal = parseInt(inputIdleThreshold.value, 10) || 60;
    const goalVal = parseInt(inputDailyGoal.value, 10) || 10800;

    globalSettings.idle_threshold_seconds = idleVal;
    globalSettings.daily_goal_seconds = goalVal;

    chrome.storage.local.set({ settings: globalSettings }, () => {
      // Notify background of change
      chrome.runtime.sendMessage({ action: 'settingsChanged' }, () => {
        settingsAlert.style.display = 'block';
        setTimeout(() => {
          settingsAlert.style.display = 'none';
        }, 3000);
        refreshState();
      });
    });
  });

  // Pull state immediately and keep updated every second
  refreshState();
  const updateTimer = setInterval(refreshState, 1000);

  // Cleanup on unload
  window.addEventListener('unload', () => {
    clearInterval(updateTimer);
  });
});
