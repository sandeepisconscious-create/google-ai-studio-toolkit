// AI Studio Companion - Clean Monochromatic Content Script
(function () {
  'use strict';

  console.log('[AI Studio Companion] Initializing companion...');

  // Baseline fallback models (used until dynamic discovery completes)
  const BASELINE_MODELS = [
    { key: 'gemini-4-argon', name: 'Gemini 4 Argon', shortName: 'Gemini 4 Argon', isAuto: false, isPaid: false },
    { key: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', shortName: 'Gemini 3.8 Flash', isAuto: false, isPaid: false },
    { key: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', shortName: 'Gemini 3.6 Flash', isAuto: false, isPaid: false },
    { key: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', shortName: 'Gemini 3.5 Flash Lite', isAuto: false, isPaid: false },
    { key: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', shortName: 'Gemini 3.1 Flash Lite', isAuto: false, isPaid: false },
    { key: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', shortName: 'Gemini 3 Flash Preview', isAuto: false, isPaid: false }
  ];

  const AUTO_MODEL = { key: 'auto', name: 'Auto', shortName: 'Auto', isAuto: true, isPaid: false };

  // Live dynamic model registry
  let currentModels = [AUTO_MODEL, ...BASELINE_MODELS];

  let activeModel = 'Auto';
  let isCapturing = false;

  // Usage state keyed by Pacific Time day (resets automatically at 00:00 PT)
  let usageState = {
    dayKey: '',
    counts: {}
  };

  // --- Dynamic Model Discovery & Normalization ---
  function normalizeModelEntry(raw) {
    if (!raw) return null;
    let name = typeof raw === 'string' ? raw : (raw.displayName || raw.name || '');
    name = name.replace(/^models\//, '').trim();
    if (!name || name.length < 2) return null;

    if (/^(Select|Cancel|Done|Settings|Apply|Close)$/i.test(name)) return null;

    // Clean display name: remove "(Paid)" or trailing annotations
    const cleanName = name.replace(/\s*\((paid|preview|default)\)/gi, '').trim();
    const displayName = cleanName.length > 0 ? cleanName : name;
    const key = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    return {
      key,
      name: displayName,
      shortName: displayName,
      isAuto: false,
      isPaid: false
    };
  }

  function sortModelsList() {
    const auto = currentModels.find(m => m.isAuto) || AUTO_MODEL;
    const others = currentModels.filter(m => !m.isAuto);

    others.sort((a, b) => {
      const aPaid = a.isPaid || /argon|pro/i.test(a.name);
      const bPaid = b.isPaid || /argon|pro/i.test(b.name);
      if (aPaid && !bPaid) return -1;
      if (!aPaid && bPaid) return 1;

      const aVer = parseFloat((a.name.match(/\d+(\.\d+)?/) || [0])[0]);
      const bVer = parseFloat((b.name.match(/\d+(\.\d+)?/) || [0])[0]);
      if (bVer !== aVer) return bVer - aVer;

      return a.name.localeCompare(b.name);
    });

    currentModels = [auto, ...others];
  }

  function saveDynamicModels() {
    if (chrome.storage && chrome.storage.local) {
      const toSave = currentModels.filter(m => !m.isAuto);
      chrome.storage.local.set({ asc_dynamic_models: toSave });
    }
  }

  function mergeDiscoveredModels(modelsList) {
    if (!Array.isArray(modelsList) || modelsList.length === 0) return;

    let hasChange = false;
    for (const raw of modelsList) {
      const entry = normalizeModelEntry(raw);
      if (!entry) continue;

      if (!/gemini/i.test(entry.name) && !entry.isAuto) continue;

      const idx = currentModels.findIndex(m => 
        m.key === entry.key || 
        m.name.toLowerCase() === entry.name.toLowerCase()
      );

      if (idx === -1) {
        currentModels.push(entry);
        hasChange = true;
      } else {
        if (entry.isPaid && !currentModels[idx].isPaid) {
          currentModels[idx].isPaid = true;
          hasChange = true;
        }
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

  // --- 1. Quota Reset Time & Accurate Chat-History Usage Counter ---
  function getPacificDateAndResetSeconds() {
    try {
      const now = new Date();
      const ptFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const parts = ptFormatter.formatToParts(now);
      const map = {};
      for (const p of parts) map[p.type] = p.value;

      const dayKey = `${map.year}-${map.month}-${map.day}`;
      const h = parseInt(map.hour, 10) % 24;
      const m = parseInt(map.minute, 10);
      const s = parseInt(map.second, 10);
      const elapsedSec = h * 3600 + m * 60 + s;
      const remainingSec = Math.max(0, 86400 - elapsedSec);
      return { dayKey, remainingSec };
    } catch (e) {
      const now = new Date();
      return { dayKey: now.toISOString().slice(0, 10), remainingSec: 3600 };
    }
  }

  function formatResetDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function loadUsageState() {
    const { dayKey } = getPacificDateAndResetSeconds();
    if (!chrome.storage || !chrome.storage.local) {
      if (usageState.dayKey !== dayKey) usageState = { dayKey, counts: {} };
      return;
    }

    chrome.storage.local.get(['asc_chat_model', 'asc_usage_v2', 'asc_dynamic_models'], (res) => {
      if (res && res.asc_dynamic_models && Array.isArray(res.asc_dynamic_models) && res.asc_dynamic_models.length > 0) {
        mergeDiscoveredModels(res.asc_dynamic_models);
      }
      if (res && res.asc_chat_model) {
        if (res.asc_chat_model.startsWith('Auto')) {
          activeModel = 'Auto';
        } else if (res.asc_chat_model.startsWith('Default')) {
          activeModel = 'Gemini 3.8 Flash';
        } else {
          activeModel = res.asc_chat_model;
        }
        updatePillLabel();
      }
      if (res && res.asc_usage_v2 && res.asc_usage_v2.dayKey === dayKey) {
        usageState = res.asc_usage_v2;
      } else {
        usageState = { dayKey, counts: {} };
        chrome.storage.local.set({ asc_usage_v2: usageState });
      }
      syncUsageFromChatHistory();
    });
  }

  function saveUsageState() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ asc_usage_v2: usageState });
    }
  }

  function recordModelRequest(modelName) {
    const { dayKey } = getPacificDateAndResetSeconds();
    if (usageState.dayKey !== dayKey) {
      usageState = { dayKey, counts: {} };
    }

    let matched = currentModels.find(
      m => m.name.toLowerCase() === modelName.toLowerCase() ||
           m.shortName.toLowerCase() === modelName.toLowerCase()
    );

    // Flexible match for Argon or aliases
    if (!matched && /argon/i.test(modelName)) {
      matched = currentModels.find(m => /argon/i.test(m.key) || /argon/i.test(m.name));
    }

    const key = matched ? matched.key : 'gemini-3.8-flash';
    if (key === 'auto') return;

    usageState.counts[key] = (usageState.counts[key] || 0) + 1;
    saveUsageState();
  }

  // Tier 3: Strictly count actual run headers in chat history & auto-discover new models
  function syncUsageFromChatHistory() {
    const { dayKey } = getPacificDateAndResetSeconds();
    if (usageState.dayKey !== dayKey) {
      usageState = { dayKey, counts: {} };
    }

    const domCounts = {};
    const discoveredFromHistory = [];

    // Search for all elements containing run timing keywords ("Ran for" or "Running for")
    const allEls = document.querySelectorAll('*');
    const timingEls = Array.from(allEls).filter(el => {
      if (el.children.length > 2) return false;
      const t = el.textContent || '';
      return /(•|\u2022)?\s*(Ran for|Running for)/i.test(t);
    });

    for (const timingEl of timingEls) {
      if (timingEl.closest('#asc-model-pill-wrap')) continue;

      // Traverse up to the card/turn container (up to 5 levels) to capture model label
      let container = timingEl;
      let containerText = '';
      for (let i = 0; i < 5 && container && container !== document.body; i++) {
        const text = (container.textContent || '').trim();
        if (/gemini|argon/i.test(text)) {
          containerText = text;
          break;
        }
        container = container.parentElement;
      }

      if (!containerText) continue;

      // Match against known models
      let matchedModel = null;
      for (const m of currentModels) {
        if (m.isAuto) continue;
        if (containerText.toLowerCase().includes(m.name.toLowerCase())) {
          matchedModel = m;
          break;
        }
      }

      // Fallback: specifically detect Argon if present anywhere in the run container
      if (!matchedModel && /argon/i.test(containerText)) {
        matchedModel = currentModels.find(m => /argon/i.test(m.key) || /argon/i.test(m.name));
      }

      if (matchedModel) {
        domCounts[matchedModel.key] = (domCounts[matchedModel.key] || 0) + 1;
      }

      // Auto-discover model name
      const geminiMatch = containerText.match(/(Gemini\s+[\w\d\.\-]+(?:\s+[\w\d\.\-]+)?)/i);
      if (geminiMatch && geminiMatch[1]) {
        discoveredFromHistory.push({ name: geminiMatch[1].trim() });
      }
    }

    if (discoveredFromHistory.length > 0) {
      mergeDiscoveredModels(discoveredFromHistory);
    }

    let updated = false;
    for (const [k, count] of Object.entries(domCounts)) {
      if ((usageState.counts[k] || 0) < count) {
        usageState.counts[k] = count;
        updated = true;
      }
    }
    if (updated) {
      saveUsageState();
    }
  }

  loadUsageState();

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

  // --- 2. Smart Model Router Engine ---
  function handlePromptSubmit(promptText) {
    if (!promptText || typeof promptText !== 'string' || !promptText.trim()) return;

    if (activeModel !== 'Auto') {
      recordModelRequest(activeModel);
      return;
    }

    const text = promptText.trim().toLowerCase();
    let reasoningScore = 0;
    let uiScore = 0;

    if (/at\s+[\w\d\.\$\/<>]+\s+\(|typeerror|uncaught|syntaxerror|referenceerror|stack\s*trace|exception\b/i.test(text)) {
      reasoningScore += 5;
    }

    if (/```|def\s+\w+|function\s*\(|class\s+\w+|import\s+.*from|export\s+(default|const)|interface\s+\w+/i.test(text)) {
      reasoningScore += 3;
    }

    const reasoningKeywords = [
      'refactor', 'architecture', 'database', 'algorithm', 'state management', 'synchroniz',
      'race condition', 'deadlock', 'memory leak', 'performance', 'optimize', 'pagination',
      'concurrency', 'security', 'vulnerability', 'regex', 'crash', 'infinite loop', 'broken logic',
      'deep dive', 're-architect', 'api integration', 'edge case', 'unit test', 'backend'
    ];

    for (const kw of reasoningKeywords) {
      if (text.includes(kw)) reasoningScore += 2;
    }

    if (text.length > 250) reasoningScore += 1;

    const uiKeywords = [
      'color', 'padding', 'margin', 'font', 'size', 'align', 'css', 'theme', 'icon',
      'button text', 'rename', 'label', 'spacing', 'border', 'round', 'shadow',
      'background', 'center', 'width', 'height', 'heading', 'capitalize', 'italic',
      'bold', 'dark mode', 'light mode', 'navbar', 'footer', 'tooltip', 'placeholder'
    ];

    for (const kw of uiKeywords) {
      if (text.includes(kw)) uiScore += 2;
    }

    let chosenModel = 'Gemini 3.8 Flash';

    const proModel = currentModels.find(m => m.isPaid || /argon|pro/i.test(m.name)) || { name: 'Gemini 4 Argon' };
    const defaultFlash = currentModels.find(m => /3\.8/i.test(m.name)) || currentModels.find(m => /flash/i.test(m.name) && !m.isPaid) || { name: 'Gemini 3.8 Flash' };
    const fastFlash = currentModels.find(m => /3\.6/i.test(m.name)) || defaultFlash;

    if (reasoningScore >= 3 && reasoningScore > uiScore) {
      chosenModel = proModel.name;
    } else if (uiScore >= 2 && uiScore >= reasoningScore) {
      chosenModel = fastFlash.name;
    } else {
      chosenModel = defaultFlash.name;
    }

    recordModelRequest(chosenModel);
    syncWithAIStudioNativeDropdown(chosenModel);
  }

  // --- 3. Intercept Prompt Submission ---
  let globalSubmitAttached = false;
  function attachAutoRouterListeners() {
    if (globalSubmitAttached) return;
    globalSubmitAttached = true;

    // Capture Enter key across any prompt input element
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target;
        if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable || target.getAttribute('role') === 'textbox')) {
          const promptText = target.value || target.innerText || target.textContent || '';
          if (promptText.trim()) {
            handlePromptSubmit(promptText);
          }
        }
      }
    }, true);

    // Capture Send/Run button click
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button, [role="button"]');
      if (!btn) return;
      if (btn.id === 'asc-prompt-camera-btn' || btn.id === 'asc-model-pill-btn') return;

      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const text = (btn.textContent || '').trim().toLowerCase();
      const hasArrow = btn.querySelector('svg path[d*="M4 12"], svg path[d*="M2.01 21"], svg path[d*="M12 4"]') ||
        text === '↑' || text === 'send';
      const isSend = aria.includes('send') || aria.includes('submit') || aria.includes('run');

      if ((hasArrow || isSend) && btn.getBoundingClientRect().y > window.innerHeight * 0.4) {
        const inputEl = findPromptInputElement();
        const promptText = inputEl ? (inputEl.value || inputEl.innerText || inputEl.textContent || '') : '';
        if (promptText.trim()) {
          handlePromptSubmit(promptText);
        }
      }
    }, true);
  }

  function findSendButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const b of buttons) {
      if (b.id === 'asc-prompt-camera-btn' || b.id === 'asc-model-pill-btn') continue;
      const text = (b.textContent || '').trim();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const hasArrowUp = b.querySelector('svg path[d*="M4 12"], svg path[d*="M2.01 21"], svg path[d*="M12 4"]') ||
        text === '↑' || text === 'send';
      const isSend = aria.includes('send') || aria.includes('submit');

      if ((hasArrowUp || isSend) && b.getBoundingClientRect().y > window.innerHeight * 0.4) {
        return b;
      }
    }
    return null;
  }

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
    const elements = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
    for (const el of elements) {
      if (el.id === 'asc-prompt-camera-btn' || el.id === 'asc-model-pill-btn' || el.closest('#asc-model-pill-wrap')) {
        continue;
      }
      const text = (el.textContent || '').trim();
      if (/^(Default|Plan|Max)(\b|\s|$)/i.test(text)) {
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
      const el = container.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
      if (el) return el;
    }

    const textareas = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    const bottomInputs = textareas.filter(t => t.getBoundingClientRect().y > window.innerHeight * 0.5 && t.getBoundingClientRect().x < window.innerWidth * 0.55);
    if (bottomInputs.length > 0) return bottomInputs[0];

    return null;
  }

  // --- 5. In-Prompt Injection ---
  function setupPromptBar() {
    const plusBtn = findPlusButton();
    const modeBtn = findDefaultModeButton();

    // 1. Inject Camera Button [📷] into horizontal flex row with (+)
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

    // 2. Inject Clean Monochromatic Model Switcher Button
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

    attachAutoRouterListeners();
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
      syncUsageFromChatHistory();
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

    const { dayKey, remainingSec } = getPacificDateAndResetSeconds();
    if (usageState.dayKey !== dayKey) {
      usageState = { dayKey, counts: {} };
    }

    const header = document.createElement('div');
    header.className = 'asc-model-menu-header';
    header.innerHTML = `
      <span>Select model</span>
      <span class="asc-reset-timer" title="Daily quota resets at Midnight PT">Resets in ${formatResetDuration(remainingSec)}</span>
    `;
    menu.appendChild(header);

    currentModels.forEach((m, idx) => {
      if (idx === 1) {
        const divider = document.createElement('div');
        divider.className = 'asc-menu-divider';
        menu.appendChild(divider);
      }

      const item = document.createElement('div');
      const isActive = m.name.toLowerCase() === activeModel.toLowerCase() ||
                       m.shortName.toLowerCase() === activeModel.toLowerCase();
      item.className = `asc-model-menu-item ${isActive ? 'active' : ''}`;

      const usedCount = usageState.counts[m.key] || 0;
      const usageHtml = (!m.isAuto && usedCount > 0)
        ? `<span class="asc-usage-meta">${usedCount} used</span>`
        : '';

      item.innerHTML = `
        <div class="asc-model-name-group">
          <span>${escapeHtml(m.name)}</span>
        </div>
        ${usageHtml}
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

  function applyModelSelection(modelName) {
    activeModel = modelName;
    updatePillLabel();

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ asc_chat_model: modelName });
    }

    if (modelName !== 'Auto') {
      syncWithAIStudioNativeDropdown(modelName);
    }
  }

  function syncWithAIStudioNativeDropdown(targetModelName) {
    const allLabels = Array.from(document.querySelectorAll('*')).filter(el => {
      return el.children.length === 0 && (el.textContent || '').trim().includes('Select model to use in Chat');
    });

    for (const label of allLabels) {
      const container = label.parentElement;
      if (!container) continue;

      const dropdown = container.querySelector('select, [role="combobox"], [role="listbox"], button');
      if (dropdown) {
        if (dropdown.tagName === 'SELECT') {
          for (const opt of dropdown.options) {
            if (opt.text.toLowerCase().includes(targetModelName.toLowerCase())) {
              dropdown.value = opt.value;
              dropdown.dispatchEvent(new Event('change', { bubbles: true }));
              return;
            }
          }
        } else {
          dropdown.click();
          setTimeout(() => {
            const options = Array.from(document.querySelectorAll('[role="option"], li, mat-option, div'));
            for (const opt of options) {
              if (opt.textContent && opt.textContent.trim().toLowerCase().includes(targetModelName.toLowerCase())) {
                opt.click();
                return;
              }
            }
            document.body.click();
          }, 150);
          return;
        }
      }
    }
  }

  // --- 6. Clean Single-Instance Applet Screenshot & Drop Insertion ---
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
             r.height >= window.innerHeight * 0.5;
    });

    if (rightSideDivs.length > 0) {
      const sorted = rightSideDivs.sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight));
      return sorted[0];
    }

    return null;
  }

  function captureAppletScreenshot() {
    if (isCapturing) return;
    isCapturing = true;
    setTimeout(() => { isCapturing = false; }, 600);

    const appletEl = findAppletElement();
    if (!appletEl) return;

    flashElement(appletEl);

    const rect = appletEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    chrome.runtime.sendMessage({ action: 'capture_visible_tab' }, (response) => {
      if (!response || !response.success || !response.dataUrl) return;
      processAndInsertSingleScreenshot(response.dataUrl, rect, dpr);
    });
  }

  function flashElement(el) {
    const rect = el.getBoundingClientRect();
    const flash = document.createElement('div');
    flash.className = 'asc-flash-overlay';
    flash.style.top = `${rect.top + window.scrollY}px`;
    flash.style.left = `${rect.left + window.scrollX}px`;
    flash.style.width = `${rect.width}px`;
    flash.style.height = `${rect.height}px`;

    document.body.appendChild(flash);
    setTimeout(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 400);
    }, 120);
  }

  function processAndInsertSingleScreenshot(fullDataUrl, rect, dpr) {
    const img = new Image();
    img.onload = () => {
      const sx = Math.max(0, Math.round(rect.x * dpr));
      const sy = Math.max(0, Math.round(rect.y * dpr));
      const sWidth = Math.min(img.width - sx, Math.round(rect.width * dpr));
      const sHeight = Math.min(img.height - sy, Math.round(rect.height * dpr));

      if (sWidth <= 0 || sHeight <= 0) return;

      const canvas = document.createElement('canvas');
      canvas.width = sWidth;
      canvas.height = sHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

      canvas.toBlob(async (blob) => {
        if (!blob) return;

        const file = new File([blob], `applet-screenshot-${Date.now()}.png`, { type: 'image/png' });

        try {
          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          }
        } catch (e) {
          // ignore
        }

        // Insert into prompt directly with no floating toast popover
        insertSingleImageViaDrop(file);
      }, 'image/png');
    };
    img.src = fullDataUrl;
  }

  function insertSingleImageViaDrop(file) {
    const target = findPromptInputElement() || findPromptContainer();
    if (!target) return;

    const dt = new DataTransfer();
    dt.items.add(file);

    target.focus();

    try {
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
      console.warn('[AI Studio Companion] Drop dispatch error:', err);
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

  // Keyboard Shortcut: Option + S
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

  let tickCount = 0;
  setInterval(() => {
    setupPromptBar();
    syncUsageFromChatHistory();
    tickCount++;
    if (tickCount % 3 === 0) {
      scanNativeSettingsForModels();
    }
  }, 1000);

})();
