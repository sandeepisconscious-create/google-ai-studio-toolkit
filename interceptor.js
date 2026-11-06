// Google AI Studio Toolkit - Main World Network Interceptor
// Intercepts fetch & XHR to rewrite prompt execution models and dynamically discover models from API responses.
(function () {
  'use strict';

  let targetModelKey = '';

  /**
   * Resolves a human-friendly model name into a canonical API identifier
   * @param {string} name
   * @returns {string}
   */
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

  /**
   * Rewrites model references in URLs or body payloads
   * @param {string} text
   * @param {string} targetKey
   * @returns {string}
   */
  function rewriteModelString(text, targetKey) {
    if (!text || !targetKey || typeof text !== 'string') return text;
    if (!text.includes('gemini-') || text.includes(targetKey)) return text;
    return text.replace(/(models\/)?gemini-[\w\d\.\-]+/g, (match) => {
      return match.startsWith('models/') ? `models/${targetKey}` : targetKey;
    });
  }

  // Listen for active model selection from toolkit content script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'ASC_SET_ACTIVE_MODEL') {
      targetModelKey = resolveModelId(event.data.model || '');
    }
  });

  /**
   * Recursively discovers model entries from Google AI Studio JSON payloads
   * @param {any} data
   * @returns {Array<{name: string, id: string, description: string}>|null}
   */
  function extractModelsFromPayload(data) {
    if (!data || typeof data !== 'object') return null;

    const discovered = [];
    const seenNames = new Set();

    function traverse(node, depth = 0) {
      if (!node || depth > 5 || discovered.length >= 30) return;

      if (Array.isArray(node)) {
        for (const item of node) traverse(item, depth + 1);
        return;
      }

      if (typeof node === 'object') {
        const name = node.displayName || node.name;
        if (typeof name === 'string' && /gemini/i.test(name)) {
          // Exclude unversioned floating aliases like "Gemini Flash Latest"
          const isUnversionedLatest = /\blatest\b/i.test(name) && !/\d+(\.\d+)?/.test(name);
          const cleanName = name.replace(/^models\//, '').trim();

          if (!isUnversionedLatest && !seenNames.has(cleanName)) {
            seenNames.add(cleanName);
            discovered.push({
              name: node.displayName || cleanName,
              id: node.name ? node.name.replace(/^models\//, '') : '',
              description: node.description || ''
            });
          }
        }

        for (const key of Object.keys(node)) {
          if (typeof node[key] === 'object' && node[key] !== null) {
            traverse(node[key], depth + 1);
          }
        }
      }
    }

    traverse(data);
    return discovered.length > 0 ? discovered : null;
  }

  function notifyExtension(models) {
    if (!models || models.length === 0) return;
    window.postMessage({
      type: 'ASC_MODELS_DISCOVERED',
      source: 'network',
      models
    }, '*');
  }

  function isPromptOrModelEndpoint(url) {
    if (typeof url !== 'string') return false;
    return url.includes('generate') || url.includes('models/') || url.includes('run') || url.includes('internal') || url.includes('batch');
  }

  // Intercept window.fetch
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      let [resource, config] = args;

      try {
        if (targetModelKey) {
          let url = typeof resource === 'string' ? resource : (resource?.url || '');

          if (isPromptOrModelEndpoint(url)) {
            const rewrittenUrl = rewriteModelString(url, targetModelKey);
            if (rewrittenUrl !== url) {
              if (typeof resource === 'string') {
                resource = rewrittenUrl;
                args[0] = resource;
              } else if (resource?.url) {
                resource = new Request(rewrittenUrl, config);
                args[0] = resource;
              }
            }

            if (config?.body && typeof config.body === 'string') {
              config.body = rewriteModelString(config.body, targetModelKey);
            }
          }
        }
      } catch (err) {
        console.warn('[AI Studio Toolkit] Fetch intercept error:', err);
      }

      const response = await originalFetch.apply(this, args);

      try {
        const url = typeof resource === 'string' ? resource : (resource?.url || '');
        if (isPromptOrModelEndpoint(url)) {
          response.clone().json().then((data) => {
            const models = extractModelsFromPayload(data);
            if (models) notifyExtension(models);
          }).catch(() => {});
        }
      } catch (e) {}

      return response;
    };
  }

  // Intercept XMLHttpRequest
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (targetModelKey && isPromptOrModelEndpoint(url)) {
        url = rewriteModelString(url, targetModelKey);
      }
      this._asc_url = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (data) {
      if (targetModelKey && typeof data === 'string' && isPromptOrModelEndpoint(this._asc_url)) {
        data = rewriteModelString(data, targetModelKey);
      }

      this.addEventListener('load', function () {
        try {
          if (isPromptOrModelEndpoint(this._asc_url)) {
            const parsed = JSON.parse(this.responseText);
            const models = extractModelsFromPayload(parsed);
            if (models) notifyExtension(models);
          }
        } catch (e) {}
      });

      return originalSend.call(this, data);
    };
  }
})();
