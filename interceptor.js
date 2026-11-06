// Google AI Studio Toolkit - Main World Network Interceptor
// Runs in the main webpage context to dynamically capture live models from Google's API responses
(function () {
  'use strict';

  function extractModelsFromPayload(data) {
    if (!data || typeof data !== 'object') return null;

    const candidates = [];

    // Pattern 1: { models: [ { name: "models/gemini-...", displayName: "Gemini 3.8 Flash", ... } ] }
    if (Array.isArray(data.models)) {
      for (const item of data.models) {
        if (!item || typeof item !== 'object') continue;
        const name = item.displayName || item.name || '';
        if (name && typeof name === 'string' && /gemini/i.test(name)) {
          candidates.push({
            name: item.displayName || item.name.replace(/^models\//, ''),
            id: item.name ? item.name.replace(/^models\//, '') : '',
            description: item.description || ''
          });
        }
      }
    }

    // Pattern 2: Deep search in batch RPCs / nested responses
    if (candidates.length === 0) {
      function searchNested(obj, depth) {
        if (!obj || depth > 4 || candidates.length > 25) return;
        if (Array.isArray(obj)) {
          for (const el of obj) searchNested(el, depth + 1);
        } else if (typeof obj === 'object') {
          if (obj.displayName && typeof obj.displayName === 'string' && /gemini/i.test(obj.displayName)) {
            candidates.push({
              name: obj.displayName,
              id: obj.name ? obj.name.replace(/^models\//, '') : '',
              description: obj.description || ''
            });
          }
          for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
              searchNested(obj[key], depth + 1);
            }
          }
        }
      }
      searchNested(data, 0);
    }

    return candidates.length > 0 ? candidates : null;
  }

  function notifyExtension(models) {
    if (!models || models.length === 0) return;
    window.postMessage({
      type: 'ASC_MODELS_DISCOVERED',
      source: 'network',
      models: models
    }, '*');
  }

  // Intercept window.fetch
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (url.includes('model') || url.includes('generativelanguage') || url.includes('internal') || url.includes('batch')) {
          const clone = response.clone();
          clone.json().then(data => {
            const models = extractModelsFromPayload(data);
            if (models) notifyExtension(models);
          }).catch(() => {});
        }
      } catch (e) {
        // Non-blocking
      }
      return response;
    };
  }

  // Intercept XMLHttpRequest
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._asc_url = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = this._asc_url || '';
          if (typeof url === 'string' && (url.includes('model') || url.includes('generativelanguage') || url.includes('internal'))) {
            const data = JSON.parse(this.responseText);
            const models = extractModelsFromPayload(data);
            if (models) notifyExtension(models);
          }
        } catch (e) {
          // Non-blocking
        }
      });
      return originalSend.apply(this, args);
    };
  }
})();
