// Google AI Studio Toolkit - Service Worker (Manifest V3)
// Handles background tab capture and GitHub release auto-update checking.

const REPO = 'sandeepisconscious-create/google-ai-studio-toolkit';

/**
 * Compares two semantic version strings (e.g. "1.9.6" vs "1.9.5")
 * @param {string} latest
 * @param {string} current
 * @returns {boolean}
 */
function isNewerVersion(latest, current) {
  const lParts = latest.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const cParts = current.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
    const l = lParts[i] || 0;
    const c = cParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Checks GitHub Releases API for new versions and sets notification badges
 * @returns {Promise<object|null>}
 */
async function checkForUpdates() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return null;

    const release = await res.json();
    const latestTag = release.tag_name || '';
    const currentVer = chrome.runtime.getManifest().version;

    if (isNewerVersion(latestTag, currentVer)) {
      const asset = (release.assets || []).find(a => a.name.endsWith('.zip'));
      const downloadUrl = asset ? asset.browser_download_url : release.html_url;

      chrome.storage.local.set({
        asc_latest_update: {
          available: true,
          version: latestTag,
          downloadUrl
        }
      });

      chrome.action.setBadgeText({ text: 'NEW' });
      chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
      return { available: true, version: latestTag, downloadUrl };
    } else {
      chrome.storage.local.set({
        asc_latest_update: {
          available: false,
          version: `v${currentVer}`
        }
      });
      chrome.action.setBadgeText({ text: '' });
      return { available: false, version: `v${currentVer}` };
    }
  } catch (e) {
    return null;
  }
}

// Background Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture_visible_tab') {
    const targetWindowId = sender.tab?.windowId ?? null;

    chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        const errorMsg = chrome.runtime.lastError?.message || 'Failed to capture visible tab';
        console.error('[AI Studio Toolkit]', errorMsg);
        sendResponse({ success: false, error: errorMsg });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });

    return true; // Keep message channel open for async response
  }

  if (message.action === 'check_for_updates') {
    checkForUpdates().then(result => sendResponse(result));
    return true;
  }
});

// Periodic and Startup Update Checks
chrome.runtime.onInstalled.addListener(() => {
  checkForUpdates();
});

chrome.runtime.onStartup.addListener(() => {
  checkForUpdates();
});
