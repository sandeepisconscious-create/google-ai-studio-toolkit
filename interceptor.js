// Google AI Studio Toolkit - Main World Network Interceptor
// Runs in the main webpage context to:
// 1. Dynamically capture live models from Google's API responses
// 2. Ensure prompt generation requests always execute with the user's selected model
(function () {
  'use strict';

  let targetModelKey = '';

  function resolveModelId(name) {
    if (!name) return '';
    const clean = name.toLowerCase().trim();
    if (clean.includes('argon') || clean.includes('gemini 4')) return 'gemini-4-argon';
    if (clean.includes('3.8')) return 'gemini-3.8-flash';
    if (clean.includes('3.6')) return 'gemini-3.6-flash';
    if (clean.includes('3.5')) return 'gemini-3.5-flash-lite';
    if (clean.includes('3.1')) return 'gemini-3.1-flash-lite';
    if (clean.includes('preview')) return 'gemini-3-flash-preview';
    return clean.replace(/[^a-z0-9\.\-]+/g, '-');
  }

  // Listen for active model selection from the toolkit content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'ASC_SET_ACTIVE_MODEL') {
      const model = event.data.model || '';
      targetModelKey = resolveModelId(model);
      console.log('[AI Studio Toolkit] Network interceptor active model set to:', targetModelKey);
    }
  });

  function extractModelsFromPayload(data) {
    if (!data || typeof data !== 'object') return null;

    const candidates = [];

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

  // Intercept window.fetch to rewrite prompt requests and capture models
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      let [resource, config] = args;

      try {
        if (targetModelKey) {
          let url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

          if (typeof url === 'string' && (url.includes('generate') || url.includes('models/') || url.includes('run') || url.includes('internal'))) {
            // Rewrite model in URL if mismatched
            if (url.includes('gemini-') && !url.includes(targetModelKey)) {
              url = url.replace(/gemini-[\w\d\.\-]+/g, targetModelKey);
              if (typeof resource === 'string') {
                resource = url;
                args[0] = resource;
              } else if (resource && resource.url) {
                resource = new Request(url, config);
                args[0] = resource;
              }
            }

            // Rewrite model in request body if mismatched
            if (config && config.body && typeof config.body === 'string') {
              if (config.body.includes('gemini-') && !config.body.includes(targetModelKey)) {
                config.body = config.body.replace(/(models\/)?gemini-[\w\d\.\-]+/g, (match) => {
                  return match.startsWith('models/') ? `models/${targetModelKey}` : targetModelKey;
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('[AI Studio Toolkit] Request model rewrite error:', err);
      }

      const response = await originalFetch.apply(this, args);

      try {
        const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
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

  // Intercept XMLHttpRequest to rewrite prompt requests and capture models
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (targetModelKey && typeof url === 'string' && (url.includes('generate') || url.includes('models/') || url.includes('run') || url.includes('internal'))) {
        if (url.includes('gemini-') && !url.includes(targetModelKey)) {
          url = url.replace(/gemini-[\w\d\.\-]+/g, targetModelKey);
        }
      }
      this._asc_url = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (data) {
      if (targetModelKey && typeof data === 'string' && (data.includes('gemini-') || data.includes('models/'))) {
        if (!data.includes(targetModelKey)) {
          data = data.replace(/(models\/)?gemini-[\w\d\.\-]+/g, (match) => {
            return match.startsWith('models/') ? `models/${targetModelKey}` : targetModelKey;
          });
        }
      }

      this.addEventListener('load', function () {
        try {
          const url = this._asc_url || '';
          if (typeof url === 'string' && (url.includes('model') || url.includes('generativelanguage') || url.includes('internal'))) {
            const parsed = JSON.parse(this.responseText);
            const models = extractModelsFromPayload(parsed);
            if (models) notifyExtension(models);
          }
        } catch (e) {
          // Non-blocking
        }
      });
      return originalSend.call(this, data);
    };
  }
})();
