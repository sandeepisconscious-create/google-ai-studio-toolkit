// Google AI Studio Toolkit - Content Script
(function () {
  'use strict';

  console.log('[AI Studio Toolkit] Initializing toolkit...');

  // Baseline fallback models (used until dynamic discovery completes)
  const BASELINE_MODELS = [
    { key: 'gemini-4-argon', name: 'Gemini 4 Argon', shortName: 'Gemini 4 Argon' },
    { key: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', shortName: 'Gemini 3.8 Flash' },
    { key: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', shortName: 'Gemini 3.6 Flash' },
    { key: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', shortName: 'Gemini 3.5 Flash Lite' },
    { key: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', shortName: 'Gemini 3.1 Flash Lite' },
    { key: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', shortName: 'Gemini 3 Flash Preview' }
  ];

  // Dynamic model registry (No Auto)
  let currentModels = [...BASELINE_MODELS];

  // Remembered active model (persisted in chrome.storage.local)
  let activeModel = 'Gemini 3.8 Flash';
  let isCapturing = false;

  // --- 1. Dynamic Model Discovery & Normalization ---
  function normalizeModelEntry(raw) {
    if (!raw) return null;
    let name = typeof raw === 'string' ? raw : (raw.displayName || raw.name || '');
    name = name.replace(/^models\//, '').trim();
    if (!name || name.length < 2) return null;

    if (/^(Select|Cancel|Done|Settings|Apply|Close|Auto)$/i.test(name)) return null;

    // 1. Filter out unversioned floating aliases like "Gemini Flash Latest" or "Gemini Flash-Lite Latest"
    if (/\blatest\b/i.test(name) && !/\d+(\.\d+)?/.test(name)) {
      return null;
    }

    // 2. If it has "Default (Gemini ...)", unwrap the inner model name
    const defaultMatch = name.match(/Default\s*\(([^)]+)\)/i);
    if (defaultMatch && defaultMatch[1]) {
      name = defaultMatch[1].trim();
    }

    // 3. Strip concatenated tags like "Paid", "Free", "Beta", "(Paid)", "(Preview)"
    name = name.replace(/Paid$/i, '')
               .replace(/\s*\((paid|preview|default|beta|new)\)/gi, '')
               .replace(/\s+/g, ' ')
               .trim();

    if (!name || !/gemini/i.test(name)) return null;

    // 4. Generate clean canonical semantic key (e.g. "gemini-4-argon", "gemini-3.8-flash")
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
      // 1. Sort by version number descending (e.g. 5 > 4.5 > 4 > 3.8 > 3.6 > 3.5 > 3.1 > 3)
      const aVer = parseFloat((a.name.match(/\d+(\.\d+)?/) || [0])[0]);
      const bVer = parseFloat((b.name.match(/\d+(\.\d+)?/) || [0])[0]);
      if (bVer !== aVer) return bVer - aVer;

      // 2. High-reasoning / Pro / Argon / Ultra models above Flash of the same version
      const aPro = /argon|pro|ultra/i.test(a.name);
      const bPro = /argon|pro|ultra/i.test(b.name);
      if (aPro && !bPro) return -1;
      if (!aPro && bPro) return 1;

      // 3. Alphabetical tiebreaker
      return a.name.localeCompare(b.name);
    });
  }

  function saveDynamicModels() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ asc_dynamic_models: currentModels });
    }
  }

  function mergeDiscoveredModels(modelsList) {
    if (!Array.isArray(modelsList) || modelsList.length === 0) return;

    let hasChange = false;
    for (const raw of modelsList) {
      const entry = normalizeModelEntry(raw);
      if (!entry) continue;

      // Deduplicate by semantic key or lowercase name
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
      if (menu) {
        renderModelMenuItems(menu);
      }
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
      if (select && select.options && select.options.length > 0) {
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

  // Tier 2: Network / Interceptor message listener
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'ASC_MODELS_DISCOVERED' && Array.isArray(event.data.models)) {
      mergeDiscoveredModels(event.data.models);
    }
  });

  // --- 2. Quota Reset Time (Pacific Time Midnight) ---
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

  // --- 3. Persistent Model Selection & Cache Purging ---
  const CURRENT_CACHE_VERSION = 'v1.6.4';

  function loadSavedModel() {
    if (!chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get(['asc_cache_ver', 'asc_selected_model', 'asc_chat_model', 'asc_dynamic_models'], (res) => {
      // Purge stale duplicate-riddled cache from previous versions
      if (!res || res.asc_cache_ver !== CURRENT_CACHE_VERSION) {
        currentModels = [...BASELINE_MODELS];
        chrome.storage.local.set({
          asc_cache_ver: CURRENT_CACHE_VERSION,
          asc_dynamic_models: currentModels
        });
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

      // Immediately inform network interceptor of active model
      window.postMessage({
        type: 'ASC_SET_ACTIVE_MODEL',
        model: activeModel
      }, '*');
    });
  }

  function applyModelSelection(modelName) {
    if (!modelName || modelName.toLowerCase() === 'auto') return;

    activeModel = modelName;
    updatePillLabel();

    // Persist permanently in storage
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        asc_selected_model: modelName,
        asc_chat_model: modelName
      });
    }

    // Sync with Google AI Studio's native chat settings
    syncWithAIStudioNativeDropdown(modelName);
  }

  let isSyncingNative = false;
  function syncWithAIStudioNativeDropdown(targetModelName) {
    if (!targetModelName) return;

    // 1. Immediately inform the main-world network interceptor
    window.postMessage({
      type: 'ASC_SET_ACTIVE_MODEL',
      model: targetModelName
    }, '*');

    // 2. Programmatically select in Google AI Studio's native settings UI
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

    // Check if "Select model to use in Chat" is already in the DOM
    const existingLabel = findLabelInDOM('Select model to use in Chat');
    if (existingLabel) {
      selectOptionUnderLabel(existingLabel, targetModelName, finish);
      return;
    }

    // If drawer is closed, open the Settings / Project drawer ONCE
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
      // Find options in overlay or listbox (strictly exclude our own extension menu!)
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

  // --- SVG Icons ---
  const CAMERA_ICON = `
    <svg viewBox="0 0 24 24">
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/>
      <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
    </svg>`;

  const CHEVRON_DOWN_SVG = `
    <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; flex-shrink: 0;">
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
    </svg>`;

  // --- 4. Find Elements in AI Studio ---
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

  // --- 5. In-Prompt Injection ---
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

  // Minimal, clean dropdown displaying only quota reset countdown and model names
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

  // --- 6. Single-Instance Applet Screenshot & Drop Insertion ---
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

    chrome.runtime.sendMessage(
      { action: 'capture_visible_tab' },
      (response) => {
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
      const canvas = document.createElement('canvas');
      canvas.width = crop.width;
      canvas.height = crop.height;
      const ctx = canvas.getContext('2d');

      ctx.drawImage(
        img,
        crop.x, crop.y, crop.width, crop.height,
        0, 0, crop.width, crop.height
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
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
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

  // Keyboard Shortcut: Option + S / Alt + S
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
      e.preventDefault();
      captureAppletScreenshot();
    }
  });

  // Continuous Setup
  const mainObserver = new MutationObserver(() => {
    setupPromptBar();
  });

  mainObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  setInterval(() => {
    setupPromptBar();
  }, 1000);

  // Initialize saved model on startup
  loadSavedModel();

})();
