// Popup Controller for Google AI Studio Toolkit
document.addEventListener('DOMContentLoaded', async () => {
  const statusPill = document.getElementById('status-pill');
  const stateActive = document.getElementById('state-active');
  const stateInactive = document.getElementById('state-inactive');
  const openStudioBtn = document.getElementById('open-studio-btn');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isStudio = tab && tab.url && tab.url.includes('aistudio.google.com');

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

  // Handle Enter to Send Toggle
  const enterToSendToggle = document.getElementById('enter-to-send-toggle');
  if (enterToSendToggle && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['asc_enter_to_send'], (res) => {
      enterToSendToggle.checked = Boolean(res && res.asc_enter_to_send);
    });

    enterToSendToggle.addEventListener('change', () => {
      const enabled = enterToSendToggle.checked;
      chrome.storage.local.set({ asc_enter_to_send: enabled });

      // Notify content script in active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'ASC_ENTER_TO_SEND_CHANGED',
            enabled
          }).catch(() => {});
        }
      });
    });
  }
});
