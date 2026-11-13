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

  const CURRENT_CACHE_VERSION = 'v1.9.8';

  const BASELINE_MODELS = [
    { key: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', shortName: 'Gemini 4 Hydrogen', badge: 'New' },
    { key: 'gemini-4-carbon', name: 'Gemini 4 Carbon', shortName: 'Gemini 4 Carbon', badge: 'Paid' },
    { key: 'gemini-4-argon', name: 'Gemini 4 Argon', shortName: 'Gemini 4 Argon', badge: '' },
    { key: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', shortName: 'Gemini 3.5 Flash Lite', badge: '' },
    { key: 'gemini-flash-latest', name: 'Gemini Flash Latest', shortName: 'Gemini Flash Latest', badge: '' },
    { key: 'gemini-flash-lite-latest', name: 'Gemini Flash-Lite Latest', shortName: 'Gemini Flash-Lite Latest', badge: '' }
  ];

  let currentModels = [...BASELINE_MODELS];
  let activeModel = 'Gemini 4 Hydrogen';
  let hasInitialDiscovered = false;
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
   * Normalizes a model entry and extracts or strips UI badges
   * @param {string|object} raw
   * @returns {{key: string, name: string, shortName: string, badge: string}|null}
   */
  function normalizeModelEntry(raw) {
    if (!raw) return null;
    let name = typeof raw === 'string' ? raw : (raw.displayName || raw.name || '');
    const rawId = (typeof raw === 'object' && raw.id) ? String(raw.id).replace(/^models\//, '').trim() : '';
    let badge = (typeof raw === 'object' && raw.badge) ? String(raw.badge).trim() : '';

    name = name.replace(/^models\//, '').trim();
    if (!name || name.length < 2) return null;

    if (/^(Select|Cancel|Done|Settings|Apply|Close|Auto)$/i.test(name)) return null;

    // Extract badge before unwrapping or stripping if not explicitly provided
    if (!badge) {
      if (/(?:[•·]\s*|\b|\()new(?:\)|\b|$)/i.test(name)) badge = 'New';
      else if (/(?:[•·]\s*|\b|\()paid(?:\)|\b|$)/i.test(name)) badge = 'Paid';
      else if (/(?:[•·]\s*|\b|\()preview(?:\)|\b|$)/i.test(name)) badge = 'Preview';
      else if (/(?:[•·]\s*|\b|\()beta(?:\)|\b|$)/i.test(name)) badge = 'Beta';
    }

    // Unwrap "Default (Gemini ...)"
    const defaultMatch = name.match(/Default\s*\(([^)]+)\)/i);
    if (defaultMatch && defaultMatch[1]) {
      name = defaultMatch[1].trim();
    }

    // Strip UI badge text like "• New", "• Paid", "Paid", "New", "Free", "Beta", "(Paid)", "(Preview)"
    name = name.replace(/[•·]\s*(paid|new|free|beta|preview|default)\b/gi, '')
               .replace(/\s*\((paid|preview|default|beta|new|free)\)/gi, '')
               .replace(/\s+\b(paid|new|free|beta)\s*$/i, '')
               .replace(/(paid|new|free|beta)$/i, (match, p1, offset, str) => {
                 // Only strip if attached at the end after a known model word or whitespace
                 const before = str.slice(0, offset);
                 if (/\s$/.test(before) || /(hydrogen|carbon|argon|helium|neon|krypton|xenon|radon|flash|pro|lite|ultra|latest|\d)$/i.test(before)) {
                   return '';
                 }
                 return match;
               })
               .replace(/[•·]/g, ' ')
               .replace(/\s+/g, ' ')
               .trim();

    if (!name || !/gemini/i.test(name)) return null;

    // Convert raw API slug (e.g. "gemini-4-hydrogen") into Title Case display name if needed
    if (/^gemini-[a-z0-9\.\-]+$/i.test(name) && !name.includes(' ')) {
      name = name
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
        .replace(/Flash Lite\s+Latest/i, 'Flash-Lite Latest');
    }

    // Generate canonical semantic key
    const key = (rawId && /^gemini-[a-z0-9\.\-]+$/i.test(rawId))
      ? rawId.toLowerCase()
      : name.toLowerCase()
            .replace(/[^a-z0-9\.]+/g, '-')
            .replace(/^-|-$/g, '');

    return {
      key,
      name,
      shortName: name,
      badge
    };
  }

  function getModelRank(m) {
    const n = m.name.toLowerCase();
    const verMatch = n.match(/\d+(\.\d+)?/);
    const ver = verMatch ? parseFloat(verMatch[0]) : 0; // Unversioned "Latest" aliases sort at bottom (ver = 0)

    // Tier priority within same version generation
    let tier = 50;
    if (n.includes('hydrogen')) tier = 100;
    else if (n.includes('carbon')) tier = 95;
    else if (n.includes('ultra')) tier = 90;
    else if (n.includes('argon') || n.includes('pro')) tier = 85;
    else if (n.includes('neon') || n.includes('krypton') || n.includes('xenon')) tier = 80;
    else if (n.includes('flash') && !n.includes('lite')) tier = 70;
    else if (n.includes('lite')) tier = 60;

    return { ver, tier };
  }

  function sortModelsList() {
    currentModels.sort((a, b) => {
      const rA = getModelRank(a);
      const rB = getModelRank(b);
      if (rB.ver !== rA.ver) return rB.ver - rA.ver;
      if (rB.tier !== rA.tier) return rB.tier - rA.tier;
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

  function mergeDiscoveredModels(modelsList, replaceExisting = false) {
    if (!Array.isArray(modelsList) || modelsList.length === 0) return;

    const normalizedList = [];
    const seenKeys = new Set();

    for (const raw of modelsList) {
      const entry = normalizeModelEntry(raw);
      if (!entry || seenKeys.has(entry.key)) continue;
      seenKeys.add(entry.key);
      normalizedList.push(entry);
    }

    if (normalizedList.length === 0) return;

    let hasChange = false;

    if (replaceExisting && normalizedList.length >= 2) {
      const prevKeys = currentModels.map(m => `${m.key}:${m.badge || ''}`).join(',');
      currentModels = normalizedList;
      sortModelsList();
      const nextKeys = currentModels.map(m => `${m.key}:${m.badge || ''}`).join(',');
      hasChange = prevKeys !== nextKeys;
    } else {
      for (const entry of normalizedList) {
        const existing = currentModels.find(m =>
          m.key === entry.key ||
          m.name.toLowerCase() === entry.name.toLowerCase()
        );

        if (!existing) {
          currentModels.push(entry);
          hasChange = true;
        } else if (entry.badge && !existing.badge) {
          existing.badge = entry.badge;
          hasChange = true;
        }
      }
      if (hasChange) {
        sortModelsList();
      }
    }

    if (hasChange) {
      saveDynamicModels();

      // If activeModel is no longer in the discovered list and wasn't explicitly set to a valid model, default to top model
      const activeExists = currentModels.some(
        m => m.name.toLowerCase() === activeModel.toLowerCase() || m.key === activeModel.toLowerCase()
      );
      if (!activeExists && currentModels.length > 0) {
        activeModel = currentModels[0].name;
      }

      const menu = document.getElementById('asc-model-dropdown-menu');
      if (menu) renderModelMenuItems(menu);
      updatePillLabel();
    }
  }

  function extractTextWithSpacing(el) {
    if (!el) return '';
    // Clone or walk child nodes so adjacent badge spans don't concatenate without spaces
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const val = (node.nodeValue || '').trim();
      if (val) parts.push(val);
    }
    return parts.join(' ').trim();
  }

  function collectOptionsFromRoot(root) {
    const found = [];
    if (!root) return found;

    const selects = root.querySelectorAll('select');
    for (const select of selects) {
      if (select.options?.length > 0) {
        for (const opt of select.options) {
          const t = (opt.text || opt.value || '').trim();
          if (t && /gemini/i.test(t)) found.push({ name: t });
        }
      }
    }

    const options = root.querySelectorAll('[role="option"], mat-option, [role="menuitem"], [role="menuitemradio"], .mat-mdc-option, .mdc-list-item');
    for (const opt of options) {
      if (opt.closest('#asc-model-pill-wrap')) continue;
      const t = extractTextWithSpacing(opt) || (opt.textContent || '').trim();
      if (t && /gemini/i.test(t)) {
        found.push({ name: t });
      }
    }

    return found;
  }

  // Tier 1: DOM Reader from Native Chat Settings & Overlay Containers
  function scanNativeSettingsForModels() {
    const discovered = [];

    // 1. Check near "Select model to use in Chat" label
    const allLabels = Array.from(document.querySelectorAll('*')).filter(el => {
      return el.children.length === 0 && (el.textContent || '').trim().includes('Select model to use in Chat');
    });

    for (const label of allLabels) {
      const container = label.closest('div, section, aside, form') || label.parentElement;
      if (!container) continue;

      // Also check currently selected value shown on the combobox/trigger button
      const trigger = container.querySelector('button, [role="combobox"], [role="listbox"], mat-select') || label.nextElementSibling;
      if (trigger) {
        const triggerText = extractTextWithSpacing(trigger) || (trigger.textContent || '').trim();
        if (triggerText && /gemini/i.test(triggerText)) {
          discovered.push({ name: triggerText });
        }
      }

      discovered.push(...collectOptionsFromRoot(container));
    }

    // 2. Check global CDK / Material overlay containers (where Angular Material renders open dropdowns!)
    const overlayRoots = document.querySelectorAll(
      '.cdk-overlay-container, .cdk-overlay-pane, [role="listbox"], .mat-mdc-select-panel, .mat-select-panel'
    );
    const overlayModels = [];
    for (const root of overlayRoots) {
      overlayModels.push(...collectOptionsFromRoot(root));
    }

    if (overlayModels.length >= 2) {
      // Complete list from an open native model dropdown! Replace stale models with the live list
      mergeDiscoveredModels(overlayModels, true);
      hasInitialDiscovered = true;
      return true;
    }

    if (discovered.length > 0) {
      mergeDiscoveredModels(discovered, false);
    }
    return false;
  }

  // Proactive background probe to discover models from Native Chat Settings when needed
  let isProbingModels = false;
  function probeNativeModelsIfNeeded(onComplete) {
    if (isProbingModels) {
      if (onComplete) onComplete();
      return;
    }

    // First try passive scan
    if (scanNativeSettingsForModels()) {
      if (onComplete) onComplete();
      return;
    }

    const existingLabel = findLabelInDOM('Select model to use in Chat');
    if (existingLabel) {
      isProbingModels = true;
      const container = existingLabel.closest('div, section') || existingLabel.parentElement;
      const dropdown = container && (container.querySelector('button, [role="combobox"], [role="listbox"], mat-select') || existingLabel.nextElementSibling);
      if (dropdown) {
        dropdown.click();
        setTimeout(() => {
          scanNativeSettingsForModels();
          // Close the dropdown overlay cleanly
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          const backdrop = document.querySelector('.cdk-overlay-backdrop');
          if (backdrop) backdrop.click();
          isProbingModels = false;
          if (onComplete) onComplete();
        }, 120);
        return;
      }
      isProbingModels = false;
    }

    if (onComplete) onComplete();
  }

  // Tier 2: Network Interceptor message listener
  window.addEventListener('message', (event) => {
    if (!isContextValid() || event.source !== window || !event.data) return;
    if (event.data.type === 'ASC_MODELS_DISCOVERED' && Array.isArray(event.data.models)) {
      mergeDiscoveredModels(event.data.models, false);
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
          const isValidSaved = currentModels.some(
            m => m.key === normalizedSaved.key || m.name.toLowerCase() === normalizedSaved.name.toLowerCase()
          );
          activeModel = isValidSaved ? normalizedSaved.name : (currentModels[0]?.name || 'Gemini 4 Hydrogen');
        } else {
          activeModel = currentModels[0]?.name || 'Gemini 4 Hydrogen';
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
      // While the native dropdown is open, capture all available options!
      scanNativeSettingsForModels();

      const allOpts = Array.from(document.querySelectorAll('[role="option"], mat-option, li'));
      const targetEntry = normalizeModelEntry(targetModelName);
      const targetKey = targetEntry ? targetEntry.key : targetModelName.toLowerCase();
      let matchedOpt = null;
      let nonDefaultMatch = null;

      for (const opt of allOpts) {
        if (opt.closest('#asc-model-pill-wrap')) continue;
        const rawText = extractTextWithSpacing(opt) || (opt.textContent || '').trim();
        const optEntry = normalizeModelEntry(rawText);

        if (optEntry && (optEntry.key === targetKey || optEntry.name.toLowerCase() === targetModelName.toLowerCase())) {
          if (!/^default\b/i.test(rawText)) {
            nonDefaultMatch = opt;
            break;
          }
          if (!matchedOpt) matchedOpt = opt;
        }
      }

      if (nonDefaultMatch) {
        matchedOpt = nonDefaultMatch;
      }

      if (!matchedOpt) {
        for (const opt of allOpts) {
          if (opt.closest('#asc-model-pill-wrap')) continue;
          const text = (extractTextWithSpacing(opt) || opt.textContent || '').trim().toLowerCase();
          if (text.includes(targetModelName.toLowerCase())) {
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

  // --- 8b. Prompt Input Validation & Controls Visibility ---

  function isPromptInputActiveAndVisible() {
    // 1. Only run within Google AI Studio
    if (window.location.hostname !== 'aistudio.google.com') {
      return false;
    }

    // 2. Hide when viewing an applet in full-screen mode or when assistant is hidden
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('fullscreenApplet') === 'true' || urlParams.get('showAssistant') === 'false') {
      return false;
    }

    // 3. Prompt text field must exist
    const input = findPromptInputElement();
    if (!input) {
      return false;
    }

    // 4. Prompt text field must be enabled (not disabled or aria-disabled)
    if (input.disabled === true || input.getAttribute('aria-disabled') === 'true' || input.getAttribute('contenteditable') === 'false') {
      return false;
    }

    // 5. Prompt text field must have rendered dimensions and not be visually hidden
    const rect = input.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // 6. Must be within the visible viewport bounds
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
      return false;
    }

    return true;
  }

  function setInjectedControlsVisibility(visible) {
    const cameraBtn = document.getElementById('asc-prompt-camera-btn');
    if (cameraBtn) {
      cameraBtn.style.setProperty('display', visible ? '' : 'none', 'important');
    }

    const modelWrap = document.getElementById('asc-model-pill-wrap');
    if (modelWrap) {
      modelWrap.style.setProperty('display', visible ? '' : 'none', 'important');
    }

    if (!visible) {
      const menu = document.getElementById('asc-model-dropdown-menu');
      if (menu) {
        menu.classList.remove('asc-show');
      }
    }
  }

  // --- 9. In-Prompt Injection ---

  function setupPromptBar() {
    if (!isPromptInputActiveAndVisible()) {
      setInjectedControlsVisibility(false);
      return;
    }

    setInjectedControlsVisibility(true);

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
      const willShow = !menu.classList.contains('asc-show');
      if (willShow && !hasInitialDiscovered) {
        probeNativeModelsIfNeeded(() => {
          renderModelMenuItems(menu);
        });
      } else {
        scanNativeSettingsForModels();
      }
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

      const badgeHtml = m.badge
        ? `<span class="asc-model-badge asc-badge-${escapeHtml(m.badge.toLowerCase())}">• ${escapeHtml(m.badge)}</span>`
        : '';

      item.innerHTML = `
        <div class="asc-model-name-group">
          <span>${escapeHtml(m.name)}</span>
          ${badgeHtml}
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
      if (!isPromptInputActiveAndVisible()) return;
      e.preventDefault();
      captureAppletScreenshot();
    }
  });

  // Shortcut: Option + M / Alt + M -> Toggle Model Switcher Menu
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM')) {
      if (!isPromptInputActiveAndVisible()) return;
      e.preventDefault();
      const menu = document.getElementById('asc-model-dropdown-menu');
      if (menu) {
        const willShow = !menu.classList.contains('asc-show');
        if (willShow && !hasInitialDiscovered) {
          probeNativeModelsIfNeeded(() => {
            renderModelMenuItems(menu);
          });
        } else {
          scanNativeSettingsForModels();
        }
        renderModelMenuItems(menu);
        menu.classList.toggle('asc-show');
      }
    }
  });

  // Re-check UI visibility when navigating or changing URL state
  window.addEventListener('popstate', () => {
    setupPromptBar();
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
      scanNativeSettingsForModels();
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
    scanNativeSettingsForModels();
    scanAndHideSuggestions();
  }, 1000);

  // Initialize saved model and suggestions on startup
  if (isContextValid()) {
    loadSavedModel();
    scanAndHideSuggestions();
  }

})();
