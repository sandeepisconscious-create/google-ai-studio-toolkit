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
    let clean = name.toLowerCase().trim().replace(/^models\//, '');

    // Unwrap "Default (Gemini ...)"
    const defaultMatch = clean.match(/default\s*\(([^)]+)\)/i);
    if (defaultMatch && defaultMatch[1]) {
      clean = defaultMatch[1].trim();
    }

    // Strip UI badge suffixes
    clean = clean.replace(/[•·]\s*(paid|new|free|beta|preview|default)\b/gi, '')
                 .replace(/\s*\((paid|preview|default|beta|new|free)\)/gi, '')
                 .replace(/\s+\b(paid|new|free|beta)\s*$/i, '')
                 .trim();

    if (clean.includes('hydrogen')) return 'gemini-4-hydrogen';
    if (clean.includes('carbon')) return 'gemini-4-carbon';
    if (clean.includes('argon')) return 'gemini-4-argon';
    if (clean.includes('flash-lite-latest') || clean.includes('flash-lite latest') || clean.includes('flash lite latest')) {
      return 'gemini-flash-lite-latest';
    }
    if (clean.includes('flash-latest') || clean.includes('flash latest')) {
      return 'gemini-flash-latest';
    }
    if (clean.includes('3.5') && clean.includes('lite')) return 'gemini-3.5-flash-lite';
    if (clean.includes('3.8')) return 'gemini-3.8-flash';
    if (clean.includes('3.6')) return 'gemini-3.6-flash';
    if (clean.includes('3.1')) return 'gemini-3.1-flash-lite';
    if (clean.includes('preview')) return 'gemini-3-flash-preview';

    return clean.replace(/[^a-z0-9\.]+/g, '-').replace(/^-|-$/g, '');
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
   * Recursively discovers model entries from Google AI Studio JSON or RPC payloads
   * @param {any} data
   * @returns {Array<{name: string, id: string, description: string}>|null}
   */
  function extractModelsFromPayload(data) {
    if (!data || typeof data !== 'object') return null;

    const discovered = [];
    const seenNames = new Set();

    function traverse(node, depth = 0) {
      if (!node || depth > 8 || discovered.length >= 40) return;

      if (Array.isArray(node)) {
        // Also handle Google RPC array tuples like ["models/gemini-4-hydrogen", "Gemini 4 Hydrogen", ...]
        const first = node[0];
        const second = node[1];
        if (typeof first === 'string' && /^models\/gemini-[a-z0-9\.\-]+$/i.test(first)) {
          const id = first.replace(/^models\//, '').trim();
          const disp = (typeof second === 'string' && /gemini/i.test(second)) ? second.trim() : id;
          if (!seenNames.has(id)) {
            seenNames.add(id);
            discovered.push({ name: disp, id, description: '' });
          }
        }
        for (const item of node) traverse(item, depth + 1);
        return;
      }

      if (typeof node === 'object') {
        const name = node.displayName || node.name || node.modelId || node.model;
        if (typeof name === 'string' && /gemini/i.test(name)) {
          const cleanName = name.replace(/^models\//, '').trim();
          // Ensure it looks like a model name or slug rather than a long sentence/prompt
          if (cleanName.length <= 60 && !/\n/.test(cleanName) && !seenNames.has(cleanName)) {
            seenNames.add(cleanName);
            discovered.push({
              name: node.displayName || cleanName,
              id: (node.name || node.modelId || '').replace(/^models\//, ''),
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

  /**
   * Parses JSON or Google batchexecute/XSSI-prefixed response text
   * @param {string} text
   * @returns {Array<{name: string, id: string, description: string}>|null}
   */
  function extractModelsFromResponseText(text) {
    if (!text || typeof text !== 'string' || !/gemini/i.test(text)) return null;
    const cleaned = text.replace(/^\)\]\}'\s*/, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return extractModelsFromPayload(parsed);
    } catch (e) {
      // Fallback for multi-line batchexecute responses
      const all = [];
      const lines = cleaned.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            const parsedLine = JSON.parse(trimmed);
            const found = extractModelsFromPayload(parsedLine);
            if (found) all.push(...found);
          } catch (_) {}
        }
      }
      return all.length > 0 ? all : null;
    }
  }

  function notifyExtension(models) {
    if (!models || models.length === 0) return;
    window.postMessage({
      type: 'ASC_MODELS_DISCOVERED',
      source: 'network',
      models
    }, '*');
  }

  function isPromptGenerationEndpoint(url) {
    if (typeof url !== 'string') return false;
    return url.includes('generate') || url.includes('run') || url.includes('stream') || url.includes('chat') || url.includes('alkali') || url.includes('MakerSuite') || url.includes('batchexecute');
  }

  function isModelDiscoveryEndpoint(url) {
    if (typeof url !== 'string') return false;
    return isPromptGenerationEndpoint(url) || url.includes('models') || url.includes('list') || url.includes('internal') || url.includes('batch') || url.includes('rpc');
  }

  // Intercept window.fetch
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      let [resource, config] = args;

      try {
        if (targetModelKey) {
          let url = typeof resource === 'string' ? resource : (resource?.url || '');

          if (isPromptGenerationEndpoint(url)) {
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
        if (isModelDiscoveryEndpoint(url)) {
          response.clone().text().then((text) => {
            const models = extractModelsFromResponseText(text);
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
      if (targetModelKey && isPromptGenerationEndpoint(url)) {
        url = rewriteModelString(url, targetModelKey);
      }
      this._asc_url = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (data) {
      if (targetModelKey && typeof data === 'string' && isPromptGenerationEndpoint(this._asc_url)) {
        data = rewriteModelString(data, targetModelKey);
      }

      this.addEventListener('load', function () {
        try {
          if (isModelDiscoveryEndpoint(this._asc_url) && typeof this.responseText === 'string') {
            const models = extractModelsFromResponseText(this.responseText);
            if (models) notifyExtension(models);
          }
        } catch (e) {}
      });

      return originalSend.call(this, data);
    };
  }
})();
