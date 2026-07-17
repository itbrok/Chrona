/*
  CHRONA - ONBOARDING CONTROLLER (onboarding.js)
  Secures trust, sets default targets, and directs users seamlessly to the dashboard workspace.
*/

document.getElementById('btn-start').addEventListener('click', () => {
  const goalSelect = document.getElementById('goal-select');
  const selectedGoalSeconds = parseInt(goalSelect.value, 10) || 10800;

  // Set the selected preferences into local storage
  chrome.storage.local.get(['settings'], (res) => {
    const currentSettings = res.settings || {};
    currentSettings.daily_goal_seconds = selectedGoalSeconds;
    currentSettings.idle_threshold_seconds = 60; // default 60s
    currentSettings.category_overrides = {};

    chrome.storage.local.set({ settings: currentSettings }, () => {
      // Notify background worker of config change
      chrome.runtime.sendMessage({ action: 'settingsChanged' }, () => {
        // Direct user to the main dashboard tab
        const dashboardUrl = chrome.runtime.getURL('dashboard.html');
        chrome.tabs.create({ url: dashboardUrl }, () => {
          // Close the welcome onboarding tab
          window.close();
        });
      });
    });
  });
});
