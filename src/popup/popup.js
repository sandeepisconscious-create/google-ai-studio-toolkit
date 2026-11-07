// Google AI Studio Toolkit - Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const statusPill = document.getElementById('status-pill');
  const gearBtn = document.getElementById('gear-btn');
  const openStudioBtn = document.getElementById('open-studio-btn');
  const viewActiveMain = document.getElementById('view-active-main');
  const viewSettings = document.getElementById('view-settings');
  const viewInactive = document.getElementById('view-inactive');
  const openSettingsRowBtn = document.getElementById('open-settings-row-btn');
  const backToMainBtn = document.getElementById('back-to-main-btn');

  const updateBanner = document.getElementById('update-banner');
  const updateVersionLabel = document.getElementById('update-version-label');
  const updateDownloadBtn = document.getElementById('update-download-btn');
  const checkUpdateBtn = document.getElementById('check-update-btn');
  const updateStatusDesc = document.getElementById('update-status-desc');

  const manifestVersion = chrome.runtime.getManifest().version;

  /**
   * Dispatches a message to the currently active AI Studio tab
   * @param {object} payload
   */
  function notifyActiveTab(payload) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs?.[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, payload).catch(() => {});
      }
    });
  }

  /**
   * Binds a checkbox toggle to chrome.storage.local and notifies active tabs
   * @param {string} elementId
   * @param {string} storageKey
   * @param {string} messageType
   * @param {boolean} defaultValue
   */
  function bindStorageToggle(elementId, storageKey, messageType, defaultValue = false) {
    const toggleEl = document.getElementById(elementId);
    if (!toggleEl || !chrome.storage?.local) return;

    chrome.storage.local.get([storageKey], (res) => {
      toggleEl.checked = res && res[storageKey] !== undefined ? Boolean(res[storageKey]) : defaultValue;
    });

    toggleEl.addEventListener('change', () => {
      const enabled = toggleEl.checked;
      chrome.storage.local.set({ [storageKey]: enabled });
      notifyActiveTab({ type: messageType, enabled });
    });
  }

  // --- View Navigation ---
  function showActiveMain() {
    viewActiveMain.style.display = 'block';
    viewSettings.style.display = 'none';
    viewInactive.style.display = 'none';
    if (gearBtn) gearBtn.classList.remove('active');
  }

  function showSettings() {
    viewActiveMain.style.display = 'none';
    viewSettings.style.display = 'block';
    viewInactive.style.display = 'none';
    if (gearBtn) gearBtn.classList.add('active');
  }

  function showInactive() {
    viewActiveMain.style.display = 'none';
    viewSettings.style.display = 'none';
    viewInactive.style.display = 'block';
    if (gearBtn) gearBtn.style.display = 'none';
  }

  // Check active tab domain
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isStudio = Boolean(tab?.url?.includes('aistudio.google.com'));

    if (isStudio) {
      statusPill.textContent = 'Active';
      statusPill.classList.add('active');
      if (gearBtn) gearBtn.style.display = 'inline-flex';
      showActiveMain();
    } else {
      statusPill.textContent = 'Inactive';
      statusPill.classList.remove('active');
      showInactive();
    }
  } catch (e) {
    statusPill.textContent = 'Standby';
    showInactive();
  }

  // Gear Button & Settings Navigation
  if (gearBtn) {
    gearBtn.addEventListener('click', () => {
      if (viewSettings.style.display === 'block') {
        showActiveMain();
      } else {
        showSettings();
      }
    });
  }

  if (openSettingsRowBtn) {
    openSettingsRowBtn.addEventListener('click', showSettings);
  }

  if (backToMainBtn) {
    backToMainBtn.addEventListener('click', showActiveMain);
  }

  if (openStudioBtn) {
    openStudioBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://aistudio.google.com' });
      window.close();
    });
  }

  // Bind settings toggles
  bindStorageToggle('hide-suggestions-toggle', 'asc_hide_suggestions', 'ASC_HIDE_SUGGESTIONS_CHANGED', true);
  bindStorageToggle('enter-to-send-toggle', 'asc_enter_to_send', 'ASC_ENTER_TO_SEND_CHANGED', false);

  // --- Auto-Update Check & Display ---
  function showUpdateAvailable(versionTag, downloadUrl) {
    if (updateBanner && updateVersionLabel && updateDownloadBtn) {
      updateVersionLabel.textContent = versionTag;
      updateDownloadBtn.href = downloadUrl;
      updateBanner.style.display = 'flex';
    }
    if (updateStatusDesc) {
      updateStatusDesc.textContent = `Update available: ${versionTag}`;
    }
  }

  // Check cached update info on open
  if (chrome.storage?.local) {
    chrome.storage.local.get(['asc_latest_update'], (res) => {
      const update = res?.asc_latest_update;
      if (update?.available && update.downloadUrl) {
        showUpdateAvailable(update.version, update.downloadUrl);
      } else if (updateStatusDesc) {
        updateStatusDesc.textContent = `Version v${manifestVersion} • Up to date`;
      }
    });
  }

  // Manual Check Button
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener('click', async () => {
      checkUpdateBtn.disabled = true;
      checkUpdateBtn.textContent = '...';
      if (updateStatusDesc) updateStatusDesc.textContent = 'Checking GitHub releases...';

      chrome.runtime.sendMessage({ action: 'check_for_updates' }, (res) => {
        checkUpdateBtn.disabled = false;
        checkUpdateBtn.textContent = 'Check';

        if (res?.available && res.downloadUrl) {
          showUpdateAvailable(res.version, res.downloadUrl);
        } else {
          if (updateStatusDesc) {
            updateStatusDesc.textContent = `Version v${manifestVersion} • Up to date ✓`;
          }
        }
      });
    });
  }
});
