/*
  CHRONA - DASHBOARD WORKSPACE CONTROLLER (dashboard.js)
  Renders premium visual metrics, category distributions, searchable explorers with favicons, custom styled dropdown menus, settings.
*/

// Self-mocking layer for offline static testing and Playwright verification
let isOfflineMock = typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local;

if (isOfflineMock) {
  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (msg.action === 'getState') {
          cb({
            active_domain: 'github.com',
            start_timestamp: Date.now() - 45 * 60 * 1000,
            is_paused: false,
            pause_until: null,
            idle_state: 'active'
          });
        } else if (msg.action === 'togglePause') {
          cb({ success: true, is_paused: msg.isPaused, pause_until: null });
        } else if (msg.action === 'settingsChanged') {
          cb({ success: true });
        }
      }
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const mockData = {
            'settings': {
              idle_threshold_seconds: 60,
              daily_goal_seconds: 10800,
              category_overrides: {}
            },
            'update_available': true,
            'domain_metadata': {
              'github.com': { title: 'GitHub - Chrona Pull Request', favIconUrl: 'https://github.githubassets.com/favicons/favicon.svg' },
              'youtube.com': { title: 'Lofi Girl - Chill Beats to Study/Relax', favIconUrl: 'https://www.youtube.com/s/desktop/99f1fa00/img/favicon_144x144.png' },
              'wikipedia.org': { title: 'Cognitive Load Wikipedia Article', favIconUrl: 'https://en.wikipedia.org/static/favicon/wikipedia.ico' }
            }
          };

          const last7Days = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days.push(d.toISOString().split('T')[0]);
          }

          const mockDailySeconds = [2400, 7200, 5400, 9600, 11000, 3600, 8400];
          last7Days.forEach((date, idx) => {
            mockData[`day:${date}`] = {
              total_seconds: mockDailySeconds[idx],
              domains: {
                'github.com': Math.round(mockDailySeconds[idx] * 0.5),
                'wikipedia.org': Math.round(mockDailySeconds[idx] * 0.2),
                'youtube.com': Math.round(mockDailySeconds[idx] * 0.3)
              }
            };
          });

          const result = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => { result[k] = mockData[k]; });
          } else {
            result[keys] = mockData[keys];
          }
          cb(result);
        },
        set: (obj, cb) => {
          if (cb) cb();
        }
      }
    }
  };
}

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
  const explorerTableBody = document.getElementById('explorer-table-body');
  const explorerCountText = document.getElementById('explorer-count');

  const btnSaveSettings = document.getElementById('btn-save-settings');
  const settingsAlert = document.getElementById('settings-alert');
  const btnSeedDemo = document.getElementById('btn-seed-demo');
  const bannerUpdateAvailable = document.getElementById('banner-update-available');

  if (bannerUpdateAvailable) {
    bannerUpdateAvailable.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'triggerReloadUpdate' });
    });
  }

  // Pre-bundled core domain categorization lookup
  const BUNDLED_CATEGORIES = {
    'github.com': 'Productivity',
    'gitlab.com': 'Productivity',
    'stackoverflow.com': 'Productivity',
    'figma.com': 'Productivity',
    'linear.app': 'Productivity',
    'notion.so': 'Productivity',
    'wikipedia.org': 'Education',
    'youtube.com': 'Entertainment',
    'netflix.com': 'Entertainment'
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

  let currentSelectedFilterCat = 'ALL';
  let activeOpenDropdownMenu = null;

  // Formatting utility
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

  function getDomainCategory(domain) {
    if (globalSettings.category_overrides && globalSettings.category_overrides[domain]) {
      return globalSettings.category_overrides[domain];
    }
    return BUNDLED_CATEGORIES[domain] || 'Uncategorized';
  }

  // --- CUSTOM DROPDOWN MANAGEMENT ---
  function setupChronaDropdown(dropdownId, onSelectCallback) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const toggle = dropdown.querySelector('.chrona-dropdown-toggle');
    const menu = dropdown.querySelector('.chrona-dropdown-menu');
    const toggleSpan = toggle.querySelector('span');

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close any other open dropdown
      if (activeOpenDropdownMenu && activeOpenDropdownMenu !== menu) {
        activeOpenDropdownMenu.classList.remove('show');
      }
      menu.classList.toggle('show');
      activeOpenDropdownMenu = menu.classList.contains('show') ? menu : null;
    });

    const items = menu.querySelectorAll('.chrona-dropdown-item');
    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();

        items.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');

        const val = item.getAttribute('data-value');
        toggleSpan.textContent = item.textContent;
        menu.classList.remove('show');
        activeOpenDropdownMenu = null;

        if (onSelectCallback) {
          onSelectCallback(val);
        }
      });
    });
  }

  // Set selected dropdown value programmatically
  function setChronaDropdownValue(dropdownId, value) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const toggleSpan = dropdown.querySelector('.chrona-dropdown-toggle span');
    const items = dropdown.querySelectorAll('.chrona-dropdown-item');

    items.forEach(item => {
      if (item.getAttribute('data-value') === value.toString()) {
        item.classList.add('selected');
        toggleSpan.textContent = item.textContent;
      } else {
        item.classList.remove('selected');
      }
    });
  }

  // Global click-outside listener to dismiss custom menus
  document.addEventListener('click', () => {
    if (activeOpenDropdownMenu) {
      activeOpenDropdownMenu.classList.remove('show');
      activeOpenDropdownMenu = null;
    }
  });

  // Wire up the top-level custom dropdown filters and setting dropdown selectors
  setupChronaDropdown('dropdown-explorer-filter', (value) => {
    currentSelectedFilterCat = value;
    refreshState();
  });

  setupChronaDropdown('dropdown-idle-threshold', (value) => {
    globalSettings.idle_threshold_seconds = parseInt(value, 10);
  });

  setupChronaDropdown('dropdown-daily-goal', (value) => {
    globalSettings.daily_goal_seconds = parseInt(value, 10);
  });

  // --- TRACKING LOOP & METRIC RENDERING ---
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

  function loadDashboardMetrics() {
    chrome.storage.local.get(['settings', 'update_available'], (settingsRes) => {
      if (settingsRes && settingsRes.settings) {
        globalSettings = { ...globalSettings, ...settingsRes.settings };
      }

      if (bannerUpdateAvailable) {
        bannerUpdateAvailable.style.display = (settingsRes && settingsRes.update_available) ? 'block' : 'none';
      }

      // Update custom dropdown visualizations to match restored configs
      setChronaDropdownValue('dropdown-idle-threshold', globalSettings.idle_threshold_seconds || 60);
      setChronaDropdownValue('dropdown-daily-goal', globalSettings.daily_goal_seconds || 10800);

      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7Days.push(d.toISOString().split('T')[0]);
      }

      const dayKeys = last7Days.map(date => `day:${date}`);

      chrome.storage.local.get([...dayKeys, 'domain_metadata'], (storageRes) => {
        const domainMetadata = (storageRes && storageRes.domain_metadata) || {};

        const todayStr = last7Days[6];
        const todayData = (storageRes && storageRes[`day:${todayStr}`]) || { total_seconds: 0, domains: {} };

        let totalTodaySec = todayData.total_seconds || 0;
        let todayDomains = { ...todayData.domains };

        let currentSessionDelta = 0;
        if (systemState.active_domain && !systemState.is_paused && systemState.idle_state === 'active') {
          currentSessionDelta = Math.floor((Date.now() - systemState.start_timestamp) / 1000);
          if (currentSessionDelta > 0) {
            totalTodaySec += currentSessionDelta;
            todayDomains[systemState.active_domain] = (todayDomains[systemState.active_domain] || 0) + currentSessionDelta;
          }
        }

        statTotalToday.textContent = formatDuration(totalTodaySec);
        const goalSeconds = globalSettings.daily_goal_seconds || 10800;
        const pctGoal = Math.round((totalTodaySec / goalSeconds) * 100);
        statTodaySub.textContent = `${pctGoal}% of your daily voluntary goal (${formatDuration(goalSeconds)})`;

        if (systemState.is_paused) {
          statFocusDomain.textContent = 'Paused';
          statFocusSub.textContent = 'Manual tracker pause active';
        } else if (systemState.idle_state !== 'active') {
          statFocusDomain.textContent = 'Idle';
          statFocusSub.textContent = 'System has gone idle';
        } else if (systemState.active_domain) {
          const meta = domainMetadata[systemState.active_domain] || {};
          statFocusDomain.textContent = meta.title || systemState.active_domain;
          statFocusSub.textContent = `Currently active: ${systemState.active_domain}`;
        } else {
          statFocusDomain.textContent = 'none';
          statFocusSub.textContent = 'No active window focus';
        }

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

        renderDonutChart(categorySeconds, totalTodaySec);
        renderWeeklyTimeline(last7Days, storageRes, todayStr, currentSessionDelta);
        renderTableExplorer(todayDomains, domainMetadata);
      });
    });
  }

  function renderDonutChart(categorySeconds, totalSeconds) {
    donutTotalText.textContent = formatDuration(totalSeconds);
    donutSegmentsGroup.innerHTML = '';

    if (totalSeconds === 0) return;

    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    let accumulatedOffset = 0;

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
    const dailyTotals = last7Days.map(date => {
      const dayData = (storageRes && storageRes[`day:${date}`]) || { total_seconds: 0 };
      let secs = dayData.total_seconds || 0;
      if (date === todayStr) {
        secs += currentSessionDelta;
      }
      return secs;
    });

    const maxDailySec = Math.max(...dailyTotals, 1);
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

  function renderTableExplorer(todayDomains, domainMetadata) {
    const filterTerm = explorerSearch.value.toLowerCase().trim();
    const filterCat = currentSelectedFilterCat;

    let tableItems = Object.keys(todayDomains).map(domain => ({
      domain,
      seconds: todayDomains[domain],
      category: getDomainCategory(domain)
    }));

    tableItems = tableItems.filter(item => {
      const meta = domainMetadata[item.domain] || {};
      const displayTitle = meta.title || item.domain;

      const matchSearch = item.domain.toLowerCase().includes(filterTerm) || displayTitle.toLowerCase().includes(filterTerm);
      const matchCat = filterCat === 'ALL' || item.category === filterCat;
      return matchSearch && matchCat;
    });

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

    tableItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      const tdDomain = document.createElement('td');

      const domainGroup = document.createElement('div');
      domainGroup.style.display = 'flex';
      domainGroup.style.alignItems = 'center';
      domainGroup.style.gap = '8px';

      const meta = domainMetadata[item.domain] || {};
      const displayTitle = meta.title || item.domain;
      const favIconUrl = meta.favIconUrl || null;

      const img = document.createElement('img');
      img.style.width = '16px';
      img.style.height = '16px';
      img.style.borderRadius = '3px';
      img.style.flexShrink = '0';
      img.style.objectFit = 'contain';

      const fallbackDot = document.createElement('span');
      fallbackDot.style.width = '16px';
      fallbackDot.style.height = '16px';
      fallbackDot.style.borderRadius = '50%';
      fallbackDot.style.backgroundColor = 'var(--shading-alpha-hover)';
      fallbackDot.style.display = 'inline-block';
      fallbackDot.style.flexShrink = '0';

      if (favIconUrl && !favIconUrl.startsWith('chrome://')) {
        img.src = favIconUrl;
        img.onerror = () => {
          img.style.display = 'none';
          fallbackDot.style.display = 'inline-block';
        };
        fallbackDot.style.display = 'none';
        domainGroup.appendChild(img);
        domainGroup.appendChild(fallbackDot);
      } else {
        domainGroup.appendChild(fallbackDot);
      }

      const textSpan = document.createElement('span');
      textSpan.style.overflow = 'hidden';
      textSpan.style.textOverflow = 'ellipsis';
      textSpan.style.whiteSpace = 'nowrap';
      textSpan.style.maxWidth = '300px';
      textSpan.textContent = displayTitle;
      textSpan.title = item.domain;

      domainGroup.appendChild(textSpan);
      tdDomain.appendChild(domainGroup);

      // --- CUSTOM TABLE DROPDOWN ---
      const tdCategory = document.createElement('td');

      const customSelectDropdown = document.createElement('div');
      customSelectDropdown.className = 'chrona-dropdown';
      customSelectDropdown.id = `row-dropdown-${index}`;

      const selectToggle = document.createElement('div');
      selectToggle.className = 'chrona-dropdown-toggle';
      selectToggle.innerHTML = `
        <span>${item.category}</span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" style="opacity: 0.7;"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
      `;

      const selectMenu = document.createElement('div');
      selectMenu.className = 'chrona-dropdown-menu';

      ['Productivity', 'Education', 'Entertainment', 'Uncategorized'].forEach(cat => {
        const selectItem = document.createElement('div');
        selectItem.className = cat === item.category ? 'chrona-dropdown-item selected' : 'chrona-dropdown-item';
        selectItem.setAttribute('data-value', cat);
        selectItem.textContent = cat;

        selectItem.addEventListener('click', (e) => {
          e.stopPropagation();
          globalSettings.category_overrides = globalSettings.category_overrides || {};
          globalSettings.category_overrides[item.domain] = cat;

          chrome.storage.local.set({ settings: globalSettings }, () => {
            chrome.runtime.sendMessage({ action: 'settingsChanged' }, () => {
              loadDashboardMetrics();
            });
          });
        });

        selectMenu.appendChild(selectItem);
      });

      selectToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeOpenDropdownMenu && activeOpenDropdownMenu !== selectMenu) {
          activeOpenDropdownMenu.classList.remove('show');
        }
        selectMenu.classList.toggle('show');
        activeOpenDropdownMenu = selectMenu.classList.contains('show') ? selectMenu : null;
      });

      customSelectDropdown.appendChild(selectToggle);
      customSelectDropdown.appendChild(selectMenu);
      tdCategory.appendChild(customSelectDropdown);

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

  explorerSearch.addEventListener('input', () => {
    refreshState();
  });

  btnSaveSettings.addEventListener('click', () => {
    chrome.storage.local.set({ settings: globalSettings }, () => {
      chrome.runtime.sendMessage({ action: 'settingsChanged' }, () => {
        settingsAlert.style.display = 'block';
        setTimeout(() => {
          settingsAlert.style.display = 'none';
        }, 3000);
        refreshState();
      });
    });
  });

  // --- PROGRAMMATICAL SEED DEMO DATA ACTION ---
  btnSeedDemo.addEventListener('click', () => {
    const mockMetadata = {
      'github.com': { title: 'GitHub - Chrona Pull Request', favIconUrl: 'https://github.githubassets.com/favicons/favicon.svg' },
      'stackoverflow.com': { title: 'Stack Overflow - Developer Hub', favIconUrl: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico' },
      'wikipedia.org': { title: 'Cognitive Load Wikipedia Article', favIconUrl: 'https://en.wikipedia.org/static/favicon/wikipedia.ico' },
      'youtube.com': { title: 'Lofi Girl - Chill Beats to Study/Relax', favIconUrl: 'https://www.youtube.com/s/desktop/99f1fa00/img/favicon_144x144.png' },
      'figma.com': { title: 'Chrona Premium UI Specs - Figma', favIconUrl: 'https://www.figma.com/favicon.ico' },
      'linear.app': { title: 'Active Focus Cycle - Linear', favIconUrl: 'https://linear.app/favicon.ico' }
    };

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7Days.push(d.toISOString().split('T')[0]);
    }

    const mockDailySeconds = [7200, 11500, 9400, 14200, 11000, 4600, 8400];
    const payload = { 'domain_metadata': mockMetadata };

    last7Days.forEach((date, idx) => {
      const secs = mockDailySeconds[idx];
      payload[`day:${date}`] = {
        total_seconds: secs,
        domains: {
          'github.com': Math.round(secs * 0.45),
          'stackoverflow.com': Math.round(secs * 0.15),
          'wikipedia.org': Math.round(secs * 0.15),
          'youtube.com': Math.round(secs * 0.15),
          'figma.com': Math.round(secs * 0.10)
        }
      };
    });

    chrome.storage.local.set(payload, () => {
      // Re-initialize off offline mock boundaries as well
      if (isOfflineMock) {
        window.location.reload();
      } else {
        chrome.runtime.sendMessage({ action: 'settingsChanged' }, () => {
          refreshState();
        });
      }
    });
  });

  refreshState();
  const updateTimer = setInterval(refreshState, 1000);

  window.addEventListener('unload', () => {
    clearInterval(updateTimer);
  });
});
