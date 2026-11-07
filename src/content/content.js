// Google AI Studio Toolkit - Content Script
// Manages in-prompt model switcher, one-click applet screenshot, suggestions suppression, and Enter to Send controls.
(function () {
  'use strict';

  console.log('[AI Studio Toolkit] Initializing toolkit...');

  // --- 1. Lifecycle & Context Safety Guards ---

  /**
   * Validates that the Chrome extension context is still active.
   * Prevents "Extension context invalidated" errors when the extension is reloaded or updated in developer mode.
   * @returns {boolean}
   */
  function isContextValid() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // --- 2. Registry & Baseline Fallback Models ---

  const CURRENT_CACHE_VERSION = 'v1.6.4';

  const BASELINE_MODELS = [
    { key: 'gemini-4-argon', name: 'Gemini 4 Argon', shortName: 'Gemini 4 Argon' },
    { key: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', shortName: 'Gemini 3.8 Flash' },
    { key: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', shortName: 'Gemini 3.6 Flash' },
    { key: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', shortName: 'Gemini 3.5 Flash Lite' },
    { key: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', shortName: 'Gemini 3.1 Flash Lite' },
    { key: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', shortName: 'Gemini 3 Flash Preview' }
  ];

  let currentModels = [...BASELINE_MODELS];
  let activeModel = 'Gemini 3.8 Flash';
  let isCapturing = false;
  let enterToSendEnabled = false;
  let hideSuggestionsEnabled = true;

  // --- 3. Preferences & Storage Sync ---

  if (isContextValid() && chrome.storage?.local) {
    try {
      chrome.storage.local.get(['asc_enter_to_send', 'asc_hide_suggestions'], (res) => {
        if (!isContextValid()) return;
        enterToSendEnabled = Boolean(res?.asc_enter_to_send);
        hideSuggestionsEnabled = res?.asc_hide_suggestions !== undefined ? Boolean(res.asc_hide_suggestions) : true;
        scanAndHideSuggestions();
      });
    } catch (e) {}
  }

  if (isContextValid() && chrome.storage?.onChanged) {
    try {
      chrome.storage.onChanged.addListener((changes) => {
        if (!isContextValid()) return;
        if (changes.asc_enter_to_send) {
          enterToSendEnabled = Boolean(changes.asc_enter_to_send.newValue);
        }
        if (changes.asc_hide_suggestions !== undefined) {
          hideSuggestionsEnabled = Boolean(changes.asc_hide_suggestions.newValue);
          scanAndHideSuggestions();
        }
        if (changes.asc_selected_model?.newValue) {
          const newModel = changes.asc_selected_model.newValue;
          if (newModel !== activeModel) {
            activeModel = newModel;
            updatePillLabel();
            window.postMessage({ type: 'ASC_SET_ACTIVE_MODEL', model: activeModel }, '*');
            const menu = document.getElementById('asc-model-dropdown-menu');
            if (menu) renderModelMenuItems(menu);
          }
        }
      });
    } catch (e) {}
  }

  if (isContextValid() && chrome.runtime?.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!isContextValid()) return;
        if (msg?.type === 'ASC_ENTER_TO_SEND_CHANGED') {
          enterToSendEnabled = Boolean(msg.enabled);
        }
        if (msg?.type === 'ASC_HIDE_SUGGESTIONS_CHANGED') {
          hideSuggestionsEnabled = Boolean(msg.enabled);
          scanAndHideSuggestions();
        }
        if (msg?.action === 'trigger_capture') {
          captureAppletScreenshot();
        }
      });
    } catch (e) {}
  }

  // --- 4. Dynamic Model Discovery & Normalization ---

  /**
   * Normalizes a model entry and eliminates aliases or UI badges
   * @param {string|object} raw
   * @returns {{key: string, name: string, shortName: string}|null}
   */
  function normalizeModelEntry(raw) {
    if (!raw) return null;
    let name = typeof raw === 'string' ? raw : (raw.displayName || raw.name || '');
    name = name.replace(/^models\//, '').trim();
    if (!name || name.length < 2) return null;

    if (/^(Select|Cancel|Done|Settings|Apply|Close|Auto)$/i.test(name)) return null;

    // Filter out unversioned floating aliases like "Gemini Flash Latest"
    if (/\blatest\b/i.test(name) && !/\d+(\.\d+)?/.test(name)) return null;

    // Unwrap "Default (Gemini ...)"
    const defaultMatch = name.match(/Default\s*\(([^)]+)\)/i);
    if (defaultMatch && defaultMatch[1]) {
      name = defaultMatch[1].trim();
    }

    // Strip UI badge text like "Paid", "Free", "Beta", "(Paid)", "(Preview)"
    name = name.replace(/Paid$/i, '')
               .replace(/\s*\((paid|preview|default|beta|new)\)/gi, '')
               .replace(/\s+/g, ' ')
               .trim();

    if (!name || !/gemini/i.test(name)) return null;

    // Generate canonical semantic key
    const key = name.toLowerCase()
                    .replace(/[^a-z0-9\.]+/g, '-')
                    .replace(/^-|-$/g, '');

    return {
      key,
      name,
      shortName: name
    };
  }

  function sortModelsList() {
    currentModels.sort((a, b) => {
      const aVer = parseFloat((a.name.match(/\d+(\.\d+)?/) || [0])[0]);
      const bVer = parseFloat((b.name.match(/\d+(\.\d+)?/) || [0])[0]);
      if (bVer !== aVer) return bVer - aVer;

      const aPro = /argon|pro|ultra/i.test(a.name);
      const bPro = /argon|pro|ultra/i.test(b.name);
      if (aPro && !bPro) return -1;
      if (!aPro && bPro) return 1;

      return a.name.localeCompare(b.name);
    });
  }

  function saveDynamicModels() {
    if (!isContextValid()) return;
    try {
      if (chrome.storage?.local) {
        chrome.storage.local.set({ asc_dynamic_models: currentModels }, () => {
          if (chrome.runtime?.lastError) { /* ignore */ }
        });
      }
    } catch (e) {}
  }

  function mergeDiscoveredModels(modelsList) {
    if (!Array.isArray(modelsList) || modelsList.length === 0) return;

    let hasChange = false;
    for (const raw of modelsList) {
      const entry = normalizeModelEntry(raw);
      if (!entry) continue;

      const existing = currentModels.find(m =>
        m.key === entry.key ||
        m.name.toLowerCase() === entry.name.toLowerCase()
      );

      if (!existing) {
        currentModels.push(entry);
        hasChange = true;
      }
    }

    if (hasChange) {
      sortModelsList();
      saveDynamicModels();

      const menu = document.getElementById('asc-model-dropdown-menu');
      if (menu) renderModelMenuItems(menu);
      updatePillLabel();
    }
  }

  // Tier 1: DOM Reader from Native Chat Settings
  function scanNativeSettingsForModels() {
    const allLabels = Array.from(document.querySelectorAll('*')).filter(el => {
      return el.children.length === 0 && (el.textContent || '').trim().includes('Select model to use in Chat');
    });

    for (const label of allLabels) {
      const container = label.parentElement;
      if (!container) continue;

      const select = container.querySelector('select');
      if (select?.options?.length > 0) {
        const found = [];
        for (const opt of select.options) {
          const t = (opt.text || opt.value || '').trim();
          if (t) found.push({ name: t });
        }
        if (found.length > 0) mergeDiscoveredModels(found);
      }

      const options = container.querySelectorAll('[role="option"], mat-option');
      if (options.length > 0) {
        const found = [];
        for (const opt of options) {
          const t = (opt.textContent || '').trim();
          if (t) found.push({ name: t });
        }
        if (found.length > 0) mergeDiscoveredModels(found);
      }
    }
  }

  // Tier 2: Network Interceptor message listener
  window.addEventListener('message', (event) => {
    if (!isContextValid() || event.source !== window || !event.data) return;
    if (event.data.type === 'ASC_MODELS_DISCOVERED' && Array.isArray(event.data.models)) {
      mergeDiscoveredModels(event.data.models);
    }
  });

  // --- 5. Quota Reset Time (Pacific Time Midnight) ---

  function getPacificResetSeconds() {
    try {
      const now = new Date();
      const ptFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const parts = ptFormatter.formatToParts(now);
      const map = {};
      for (const p of parts) map[p.type] = p.value;

      const h = parseInt(map.hour, 10) % 24;
      const m = parseInt(map.minute, 10);
      const s = parseInt(map.second, 10);
      const elapsedSec = h * 3600 + m * 60 + s;
      return Math.max(0, 86400 - elapsedSec);
    } catch (e) {
      return 3600;
    }
  }

  function formatResetDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // --- 6. Persistent Model Selection & Cache Purging ---

  function loadSavedModel() {
    if (!isContextValid()) return;
    try {
      if (!chrome.storage?.local) return;

      chrome.storage.local.get(['asc_cache_ver', 'asc_selected_model', 'asc_chat_model', 'asc_dynamic_models'], (res) => {
        if (!isContextValid()) return;

        if (!res || res.asc_cache_ver !== CURRENT_CACHE_VERSION) {
          currentModels = [...BASELINE_MODELS];
          try {
            chrome.storage.local.set({
              asc_cache_ver: CURRENT_CACHE_VERSION,
              asc_dynamic_models: currentModels
            });
          } catch (e) {}
        } else if (res.asc_dynamic_models && Array.isArray(res.asc_dynamic_models) && res.asc_dynamic_models.length > 0) {
          mergeDiscoveredModels(res.asc_dynamic_models);
        }

        const rawSaved = (res && (res.asc_selected_model || res.asc_chat_model)) || '';
        const normalizedSaved = normalizeModelEntry(rawSaved);

        if (normalizedSaved && !normalizedSaved.name.toLowerCase().startsWith('auto')) {
          activeModel = normalizedSaved.name;
        } else {
          activeModel = 'Gemini 3.8 Flash';
        }

        updatePillLabel();

        window.postMessage({
          type: 'ASC_SET_ACTIVE_MODEL',
          model: activeModel
        }, '*');
      });
    } catch (e) {}
  }

  function applyModelSelection(modelName) {
    if (!modelName || modelName.toLowerCase() === 'auto') return;

    activeModel = modelName;
    updatePillLabel();

    if (isContextValid()) {
      try {
        if (chrome.storage?.local) {
          chrome.storage.local.set({
            asc_selected_model: modelName,
            asc_chat_model: modelName
          });
        }
      } catch (e) {}
    }

    syncWithAIStudioNativeDropdown(modelName);
  }

  let isSyncingNative = false;
  function syncWithAIStudioNativeDropdown(targetModelName) {
    if (!targetModelName) return;

    window.postMessage({
      type: 'ASC_SET_ACTIVE_MODEL',
      model: targetModelName
    }, '*');

    if (isSyncingNative) return;
    isSyncingNative = true;

    attemptNativeDropdownSelection(targetModelName, () => {
      setTimeout(() => {
        isSyncingNative = false;
      }, 500);
    });
  }

  function attemptNativeDropdownSelection(targetModelName, onDone) {
    function finish() {
      if (onDone) onDone();
    }

    const existingLabel = findLabelInDOM('Select model to use in Chat');
    if (existingLabel) {
      selectOptionUnderLabel(existingLabel, targetModelName, finish);
      return;
    }

    const settingsBtn = findSettingsDrawerButton();
    if (!settingsBtn) {
      finish();
      return;
    }

    settingsBtn.click();

    setTimeout(() => {
      const chatTab = findChatTabButton();
      if (chatTab) chatTab.click();

      setTimeout(() => {
        const chatLabel = findLabelInDOM('Select model to use in Chat');
        if (chatLabel) {
          selectOptionUnderLabel(chatLabel, targetModelName, () => {
            closeSettingsDrawer();
            finish();
          });
        } else {
          closeSettingsDrawer();
          finish();
        }
      }, 150);
    }, 150);
  }

  function findLabelInDOM(text) {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.closest('#asc-model-pill-wrap')) continue;
      if (el.children.length === 0 && (el.textContent || '').trim().includes(text)) {
        return el;
      }
    }
    return null;
  }

  function findSettingsDrawerButton() {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      if (b.closest('#asc-model-pill-wrap') || b.id === 'asc-prompt-camera-btn') continue;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      if (aria.includes('setting') || title.includes('setting') || aria.includes('project') || title.includes('project')) {
        return b;
      }

      const svg = b.querySelector('svg');
      if (svg) {
        const path = b.querySelector('path');
        const d = path ? path.getAttribute('d') : '';
        if (d && (d.includes('M19.14') || d.includes('M12 15.5') || d.includes('M3 17v2h6') || d.includes('19.43 12.97'))) {
          return b;
        }
      }
    }

    for (const b of buttons) {
      const text = (b.textContent || '').trim().toLowerCase();
      if (['publish', 'share', 'github', 'versions', 'integrations'].includes(text)) {
        return b;
      }
    }
    return null;
  }

  function findChatTabButton() {
    const buttons = Array.from(document.querySelectorAll('button, [role="tab"], div, span'));
    for (const b of buttons) {
      if (b.closest('#asc-model-pill-wrap')) continue;
      const text = (b.textContent || '').trim();
      if (/^(•\s*)?Chat$/i.test(text)) {
        return b.closest('button, [role="tab"]') || b;
      }
    }
    return null;
  }

  function selectOptionUnderLabel(labelEl, targetModelName, onDone) {
    const container = labelEl.closest('div, section') || labelEl.parentElement;
    if (!container) {
      if (onDone) onDone();
      return;
    }

    const dropdown = container.querySelector('button, [role="combobox"], [role="listbox"], mat-select') ||
                     labelEl.nextElementSibling;

    if (!dropdown) {
      if (onDone) onDone();
      return;
    }

    dropdown.click();

    setTimeout(() => {
      const allOpts = Array.from(document.querySelectorAll('[role="option"], mat-option, li'));
      let matchedOpt = null;

      for (const opt of allOpts) {
        if (opt.closest('#asc-model-pill-wrap')) continue;
        const text = (opt.textContent || '').trim().toLowerCase();
        if (text.includes(targetModelName.toLowerCase())) {
          matchedOpt = opt;
          break;
        }
      }

      if (!matchedOpt) {
        const key = targetModelName.toLowerCase();
        for (const opt of allOpts) {
          if (opt.closest('#asc-model-pill-wrap')) continue;
          const text = (opt.textContent || '').trim().toLowerCase();
          if ((key.includes('3.8') && text.includes('3.8')) ||
              (key.includes('argon') && text.includes('argon')) ||
              (key.includes('3.6') && text.includes('3.6')) ||
              (key.includes('3.5') && text.includes('3.5')) ||
              (key.includes('3.1') && text.includes('3.1')) ||
              (key.includes('preview') && text.includes('preview'))) {
            matchedOpt = opt;
            break;
          }
        }
      }

      if (matchedOpt) {
        matchedOpt.click();
      } else {
        document.body.click();
      }

      if (onDone) setTimeout(onDone, 80);
    }, 120);
  }

  function closeSettingsDrawer() {
    const closeBtn = document.querySelector('button[aria-label*="close" i], button[aria-label*="cancel" i]') ||
                     Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === '✕' || (b.textContent || '').trim() === '×');
    if (closeBtn) {
      closeBtn.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
  }

  // --- 7. SVG Icons ---

  const CAMERA_ICON = `
    <svg viewBox="0 0 24 24">
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/>
      <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
    </svg>`;

  const CHEVRON_DOWN_SVG = `
    <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; flex-shrink: 0;">
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
    </svg>`;

  // --- 8. Finding Elements in AI Studio UI ---

  function findPlusButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const b of buttons) {
      if (b.id === 'asc-prompt-camera-btn' || b.id === 'asc-model-pill-btn') continue;
      const text = (b.textContent || '').trim();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const hasPlus = b.querySelector('svg path[d*="M19 13"], svg path[d*="M13 19"], svg path[d*="M12 5"]') ||
        b.querySelector('svg circle') || text === '+';
      const isAttach = aria.includes('attach') || aria.includes('add') || aria.includes('file');

      if ((hasPlus || isAttach) && b.getBoundingClientRect().y > window.innerHeight * 0.6) {
        return b;
      }
    }
    return null;
  }

  function findDefaultModeButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const b of buttons) {
      if (b.id === 'asc-prompt-camera-btn' || b.id === 'asc-model-pill-btn') continue;
      const text = (b.textContent || '').trim();
      if (/^(Default|Plan|Max)(\b|\s|$)/i.test(text)) {
        const r = b.getBoundingClientRect();
        if (r.y > window.innerHeight * 0.6 && r.width >= 40 && r.height >= 24) {
          return b;
        }
      }
    }

    const allClickable = Array.from(document.querySelectorAll('div, span'));
    for (const el of allClickable) {
      if (el.children.length === 0 && /^(Default|Plan|Max)$/i.test((el.textContent || '').trim())) {
        const r = el.getBoundingClientRect();
        if (r.y > window.innerHeight * 0.6 && r.width >= 24 && r.height >= 24) {
          return el.closest('button, [role="button"]') || el;
        }
      }
    }
    return null;
  }

  function findPromptContainer() {
    const plusBtn = findPlusButton();
    if (plusBtn) {
      let cur = plusBtn.parentElement;
      while (cur && cur !== document.body) {
        if (cur.querySelector('textarea, [contenteditable="true"]') && cur.querySelectorAll('button').length >= 2) {
          return cur;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  function findPromptInputElement() {
    const container = findPromptContainer();
    if (container) {
      const el = container.querySelector('textarea, [contenteditable="true"], [role="textbox"], input');
      if (el) return el;
    }

    const textareas = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    const bottomInputs = textareas.filter(t => t.getBoundingClientRect().y > window.innerHeight * 0.4 && t.getBoundingClientRect().x < window.innerWidth * 0.6);
    if (bottomInputs.length > 0) return bottomInputs[0];

    return null;
  }

  function findSendButton() {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      if (b.closest('#asc-model-pill-wrap') || b.id === 'asc-prompt-camera-btn') continue;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').trim().toLowerCase();
      const hasArrow = b.querySelector('svg path[d*="M4 12"], svg path[d*="M2.01 21"], svg path[d*="M12 4"], svg path[d*="M2.01 3"]') ||
                       text === '↑' || text === 'send' || text === 'run';
      const isSend = aria.includes('send') || aria.includes('submit') || aria.includes('run');

      if ((hasArrow || isSend) && b.getBoundingClientRect().y > window.innerHeight * 0.4) {
        return b;
      }
    }
    return null;
  }

  // --- 9. In-Prompt Injection ---

  function setupPromptBar() {
    const plusBtn = findPlusButton();
    const modeBtn = findDefaultModeButton();

    // 1. Inject Camera Button [📷] next to (+)
    if (plusBtn && !document.getElementById('asc-prompt-camera-btn')) {
      const cameraBtn = document.createElement('button');
      cameraBtn.id = 'asc-prompt-camera-btn';
      cameraBtn.className = 'asc-capture-btn';
      cameraBtn.type = 'button';
      cameraBtn.setAttribute('data-tooltip', 'Capture Applet Screenshot (Option+S)');
      cameraBtn.innerHTML = CAMERA_ICON;

      cameraBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        captureAppletScreenshot();
      });

      let leftGroup = document.getElementById('asc-left-group');
      if (!leftGroup) {
        leftGroup = document.createElement('div');
        leftGroup.id = 'asc-left-group';
        leftGroup.className = 'asc-left-group';

        const parent = plusBtn.parentNode;
        parent.insertBefore(leftGroup, plusBtn);
        leftGroup.appendChild(plusBtn);
        leftGroup.appendChild(cameraBtn);
      } else {
        leftGroup.appendChild(cameraBtn);
      }
    }

    // 2. Inject Monochromatic Model Switcher Button
    let modelWrap = document.getElementById('asc-model-pill-wrap');
    if (!modelWrap) {
      modelWrap = createModelSwitcherElement();

      if (modeBtn && modeBtn.parentNode) {
        modeBtn.parentNode.insertBefore(modelWrap, modeBtn);
      } else {
        const leftGroup = document.getElementById('asc-left-group');
        if (leftGroup) {
          leftGroup.appendChild(modelWrap);
        }
      }
    } else {
      if (modeBtn && modeBtn.parentNode && modelWrap.nextSibling !== modeBtn) {
        modeBtn.parentNode.insertBefore(modelWrap, modeBtn);
      }
    }
  }

  function createModelSwitcherElement() {
    const wrap = document.createElement('div');
    wrap.id = 'asc-model-pill-wrap';
    wrap.className = 'asc-model-btn-wrap';

    const pillBtn = document.createElement('button');
    pillBtn.id = 'asc-model-pill-btn';
    pillBtn.className = 'asc-model-pill';
    pillBtn.type = 'button';
    pillBtn.title = 'Select Model';
    pillBtn.innerHTML = `
      <span id="asc-model-pill-text">${escapeHtml(getShortName(activeModel))}</span>
      ${CHEVRON_DOWN_SVG}
    `;

    const menu = document.createElement('div');
    menu.id = 'asc-model-dropdown-menu';
    menu.className = 'asc-model-menu';

    wrap.appendChild(pillBtn);
    wrap.appendChild(menu);

    renderModelMenuItems(menu);

    pillBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      scanNativeSettingsForModels();
      renderModelMenuItems(menu);
      menu.classList.toggle('asc-show');
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        menu.classList.remove('asc-show');
      }
    });

    return wrap;
  }

  function renderModelMenuItems(menu) {
    menu.innerHTML = '';

    const remainingSec = getPacificResetSeconds();

    const header = document.createElement('div');
    header.className = 'asc-model-menu-header';
    header.innerHTML = `
      <span>Select model</span>
      <span class="asc-reset-timer" title="Daily quota resets at Midnight PT">Resets in ${formatResetDuration(remainingSec)}</span>
    `;
    menu.appendChild(header);

    currentModels.forEach((m) => {
      const item = document.createElement('div');
      const isActive = m.name.toLowerCase() === activeModel.toLowerCase() ||
                       m.shortName.toLowerCase() === activeModel.toLowerCase();
      item.className = `asc-model-menu-item ${isActive ? 'active' : ''}`;

      item.innerHTML = `
        <div class="asc-model-name-group">
          <span>${escapeHtml(m.name)}</span>
        </div>
        ${isActive ? '<span class="asc-check">✓</span>' : ''}
      `;

      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyModelSelection(m.name);
        menu.classList.remove('asc-show');
      });

      menu.appendChild(item);
    });
  }

  function getShortName(fullName) {
    const matched = currentModels.find(m => m.name.toLowerCase() === fullName.toLowerCase());
    return matched ? matched.shortName : fullName;
  }

  function updatePillLabel() {
    const label = document.getElementById('asc-model-pill-text');
    if (label) {
      label.textContent = getShortName(activeModel);
    }
  }

  // --- 10. Single-Instance Applet Screenshot & Drop Insertion ---

  function findAppletElement() {
    const iframes = Array.from(document.querySelectorAll('iframe')).filter(f => {
      const r = f.getBoundingClientRect();
      return r.width > 200 && r.height > 200 && r.x >= window.innerWidth * 0.3;
    });

    if (iframes.length > 0) {
      iframes.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
      return iframes[0];
    }

    const rightSideDivs = Array.from(document.querySelectorAll('div, section, main')).filter(d => {
      const r = d.getBoundingClientRect();
      return r.x >= window.innerWidth * 0.35 &&
             r.y >= 45 &&
             r.width >= window.innerWidth * 0.4 &&
             r.height >= window.innerHeight * 0.4;
    });

    if (rightSideDivs.length > 0) {
      rightSideDivs.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
      return rightSideDivs[0];
    }

    return null;
  }

  function captureAppletScreenshot() {
    if (isCapturing) return;

    const targetEl = findAppletElement();
    if (!targetEl) {
      console.warn('[AI Studio Toolkit] Live applet pane not found.');
      return;
    }

    isCapturing = true;
    showCaptureFlash(targetEl);

    const rect = targetEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const cropArea = {
      x: Math.round(rect.left * dpr),
      y: Math.round(rect.top * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr)
    };

    if (!isContextValid()) {
      isCapturing = false;
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { action: 'capture_visible_tab' },
        (response) => {
          if (!isContextValid()) {
            isCapturing = false;
            return;
          }
          if (!response || !response.success || !response.dataUrl) {
            isCapturing = false;
            console.warn('[AI Studio Toolkit] Screenshot capture failed:', response ? response.error : 'No response');
            return;
          }

          cropImageDataUrl(response.dataUrl, cropArea, (croppedDataUrl) => {
            isCapturing = false;
            processAndInsertSingleScreenshot(croppedDataUrl);
          });
        }
      );
    } catch (e) {
      isCapturing = false;
    }
  }

  function showCaptureFlash(el) {
    const rect = el.getBoundingClientRect();
    const flash = document.createElement('div');
    flash.className = 'asc-flash-overlay';
    flash.style.left = `${rect.left}px`;
    flash.style.top = `${rect.top}px`;
    flash.style.width = `${rect.width}px`;
    flash.style.height = `${rect.height}px`;

    document.body.appendChild(flash);
    setTimeout(() => {
      flash.classList.add('fade-out');
      setTimeout(() => flash.remove(), 250);
    }, 150);
  }

  function cropImageDataUrl(dataUrl, crop, callback) {
    const img = new Image();
    img.onload = () => {
      const cropX = Math.max(0, Math.min(crop.x, img.width - 1));
      const cropY = Math.max(0, Math.min(crop.y, img.height - 1));
      const cropW = Math.max(1, Math.min(crop.width, img.width - cropX));
      const cropH = Math.max(1, Math.min(crop.height, img.height - cropY));

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');

      ctx.drawImage(
        img,
        cropX, cropY, cropW, cropH,
        0, 0, cropW, cropH
      );

      callback(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      callback(dataUrl);
    };
    img.src = dataUrl;
  }

  function processAndInsertSingleScreenshot(dataUrl) {
    const blob = dataUrlToBlob(dataUrl);
    const fileName = `applet-screenshot-${Date.now()}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    // Copy to clipboard
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]).catch(() => {});
      }
    } catch (e) {}

    // Dispatch directly into prompt input
    const promptInput = findPromptInputElement();
    if (promptInput) {
      promptInput.focus();
      dispatchDropEvent(promptInput, file);
    }
  }

  function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = (header.match(/:(.*?);/) || ['', 'image/png'])[1];
    const binary = atob(base64);
    const len = binary.length;
    const buffer = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      buffer[i] = binary.charCodeAt(i);
    }
    return new Blob([buffer], { type: mime });
  }

  function dispatchDropEvent(target, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);

      const dragEnter = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt
      });
      const dragOver = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt
      });
      const drop = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt
      });

      target.dispatchEvent(dragEnter);
      target.dispatchEvent(dragOver);
      target.dispatchEvent(drop);
    } catch (err) {
      console.warn('[AI Studio Toolkit] Drop dispatch error:', err);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));
  }

  // --- 11. Enter to Send Interception ---

  window.addEventListener('keydown', (e) => {
    if (!enterToSendEnabled) return;

    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      const target = e.target;
      if (!target) return;

      const isPromptInput = target.tagName === 'TEXTAREA' ||
                            target.isContentEditable ||
                            target.getAttribute('role') === 'textbox' ||
                            target.classList.contains('input-area');

      if (isPromptInput && target.getBoundingClientRect().y > window.innerHeight * 0.4) {
        e.preventDefault();
        e.stopPropagation();

        const sendBtn = findSendButton();
        if (sendBtn) {
          sendBtn.click();
        } else {
          const fallbackBtn = document.querySelector('button[aria-label*="send" i], button[aria-label*="run" i], button[aria-label*="submit" i]');
          if (fallbackBtn) fallbackBtn.click();
        }
      }
    }
  }, true);

  // --- Standardized Fixed Keyboard Shortcuts ---

  // Shortcut: Option + S / Alt + S -> Capture Applet Screenshot
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
      e.preventDefault();
      captureAppletScreenshot();
    }
  });

  // Shortcut: Option + M / Alt + M -> Toggle Model Switcher Menu
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM')) {
      e.preventDefault();
      const menu = document.getElementById('asc-model-dropdown-menu');
      if (menu) {
        scanNativeSettingsForModels();
        renderModelMenuItems(menu);
        menu.classList.toggle('asc-show');
      }
    }
  });

  // --- 12. Hide Suggestions Scanner ---

  function scanAndHideSuggestions() {
    if (!hideSuggestionsEnabled) {
      document.body.classList.remove('asc-hide-suggestions');
      document.querySelectorAll('.asc-suggestion-hidden').forEach((el) => {
        el.classList.remove('asc-suggestion-hidden');
        el.style.removeProperty('display');
      });
      return;
    }

    document.body.classList.add('asc-hide-suggestions');

    // 1. Selector-based suppression (fast query)
    const selectors = [
      'ms-prompt-suggestions',
      'ms-suggestions',
      '[data-test-id*="suggestion" i]',
      '[aria-label*="suggestions" i]',
      '[class*="prompt-suggestions" i]',
      '[class*="suggestion-container" i]',
      '[class*="suggestions-container" i]',
      '[class*="suggestions-wrapper" i]',
      '[class*="suggestions-list" i]'
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.closest('#asc-model-pill-wrap') || el.id === 'asc-prompt-camera-btn') return;
        if (el.querySelector('textarea, [contenteditable="true"], [role="textbox"]')) return;
        el.classList.add('asc-suggestion-hidden');
        el.style.setProperty('display', 'none', 'important');
      });
    }

    // 2. Text-based card container suppression
    const textNodes = Array.from(document.querySelectorAll('h1, h2, h3, h4, span, div')).filter((el) => {
      if (el.children.length > 0 || el.closest('#asc-model-pill-wrap') || el.id === 'asc-prompt-camera-btn') return false;
      const t = (el.textContent || '').trim();
      return t === 'Suggestions' || t === 'AI Features' || t === 'New feature';
    });

    for (const node of textNodes) {
      let curr = node.parentElement;
      let targetBox = null;
      let depth = 0;

      while (curr && curr !== document.body && depth < 8) {
        if (curr.querySelector('textarea, [contenteditable="true"], [role="textbox"], #asc-prompt-camera-btn, #asc-model-pill-wrap')) {
          break;
        }

        const text = curr.textContent || '';
        const hasCards = curr.querySelectorAll('button, [role="button"]').length >= 2 ||
                         text.includes('AI Features') ||
                         text.includes('New feature');
        const hasClose = curr.querySelector('button[aria-label*="close" i], button[aria-label*="dismiss" i], svg path[d*="19 6.41"], svg path[d*="M19 6.41"], svg path[d*="M18 6L6 18"]');

        if (hasCards || hasClose) {
          targetBox = curr;
        }
        curr = curr.parentElement;
        depth++;
      }

      if (targetBox) {
        targetBox.classList.add('asc-suggestion-hidden');
        targetBox.style.setProperty('display', 'none', 'important');
      }
    }
  }

  // --- 13. Continuous Lifecycle Observers & Poller ---

  let mainObserver = null;
  let pollInterval = null;
  let rafDebounce = null;

  function teardownIfInvalid() {
    if (!isContextValid()) {
      if (mainObserver) {
        try { mainObserver.disconnect(); } catch (e) {}
        mainObserver = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (rafDebounce) {
        cancelAnimationFrame(rafDebounce);
        rafDebounce = null;
      }
      return true;
    }
    return false;
  }

  // High-performance debounced MutationObserver
  mainObserver = new MutationObserver(() => {
    if (teardownIfInvalid()) return;
    if (rafDebounce) return;

    rafDebounce = requestAnimationFrame(() => {
      rafDebounce = null;
      if (teardownIfInvalid()) return;
      setupPromptBar();
      scanAndHideSuggestions();
    });
  });

  mainObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  pollInterval = setInterval(() => {
    if (teardownIfInvalid()) return;
    setupPromptBar();
    scanAndHideSuggestions();
  }, 1000);

  // Initialize saved model and suggestions on startup
  if (isContextValid()) {
    loadSavedModel();
    scanAndHideSuggestions();
  }

})();
