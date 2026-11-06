// AI Studio Companion - Service Worker (Manifest V3)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture_visible_tab') {
    const targetWindowId = (sender.tab && sender.tab.windowId) ? sender.tab.windowId : null;

    chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        const errorMsg = chrome.runtime.lastError?.message || 'Failed to capture screen';
        console.error('[AI Studio Companion]', errorMsg);
        sendResponse({ success: false, error: errorMsg });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });

    return true; // Keep message channel open for async response
  }
});
