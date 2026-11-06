// Google AI Studio Toolkit - Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const statusPill = document.getElementById('status-pill');
  const stateActive = document.getElementById('state-active');
  const stateInactive = document.getElementById('state-inactive');
  const openStudioBtn = document.getElementById('open-studio-btn');

  /**
   * Dispatches a message to the currently active AI Studio tab
   * @param {object} payload
   */
  function notifyActiveTab(payload) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
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

  // Check active tab domain
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isStudio = Boolean(tab?.url?.includes('aistudio.google.com'));

    if (isStudio) {
      statusPill.textContent = 'Active';
      statusPill.classList.add('active');
      stateActive.style.display = 'block';
      stateInactive.style.display = 'none';
    } else {
      statusPill.textContent = 'Inactive';
      statusPill.classList.remove('active');
      stateActive.style.display = 'none';
      stateInactive.style.display = 'block';
    }
  } catch (e) {
    statusPill.textContent = 'Standby';
    stateInactive.style.display = 'block';
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
});
