// Thin wrappers over chrome.* so the review page also runs as a plain web page
// (served from dist/ on localhost) for development.
const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;

export const isExtension = hasChrome;

export async function storageGet(keys) {
  if (hasChrome) return chrome.storage.local.get(keys);
  const list = typeof keys === 'string' ? [keys] : keys;
  const out = {};
  for (const k of list) {
    try {
      const v = localStorage.getItem('cc:' + k);
      if (v != null) out[k] = JSON.parse(v);
    } catch { /* storage may be blocked */ }
  }
  return out;
}

export async function storageSet(obj) {
  if (hasChrome) return chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) {
    try { localStorage.setItem('cc:' + k, JSON.stringify(v)); } catch { /* ignore */ }
  }
}

export async function storageRemove(keys) {
  if (hasChrome) return chrome.storage.local.remove(keys);
  for (const k of [].concat(keys)) {
    try { localStorage.removeItem('cc:' + k); } catch { /* ignore */ }
  }
}

export function assetURL(p) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL(p);
  return new URL('../' + p, location.href).href;
}

export function openOptions() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  else location.href = assetURL('options/options.html');
}
