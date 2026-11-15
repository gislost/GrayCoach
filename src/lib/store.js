// Saved games, cached analyses, and the "recent reviews" index.
import { storageGet, storageSet, storageRemove } from './ext.js';

const MAX_RECENT = 40;

export function gameKey(game) {
  return `game:${game.site}:${game.id}`;
}

export function reviewKey(gk) {
  return 'review:' + gk.slice('game:'.length);
}

/** Saves a game and puts it at the top of the recent list; trims old entries. */
export async function saveGame(game) {
  const key = gameKey(game);
  const { recent = [] } = await storageGet('recent');
  const h = game.headers || {};
  const entry = {
    key,
    site: game.site,
    white: h.White || '?',
    black: h.Black || '?',
    result: h.Result || '*',
    date: h.Date || '',
    savedAt: Date.now(),
  };
  const next = [entry, ...recent.filter((r) => r.key !== key)];
  const evicted = next.slice(MAX_RECENT);
  await storageSet({ [key]: game, recent: next.slice(0, MAX_RECENT) });
  if (evicted.length) {
    await storageRemove(evicted.flatMap((r) => [r.key, reviewKey(r.key)]));
  }
  return key;
}

export async function loadGame(key) {
  const got = await storageGet(key);
  return got[key] || null;
}

export async function loadReview(gk) {
  const k = reviewKey(gk);
  const got = await storageGet(k);
  return got[k] || null;
}

export async function saveReview(gk, review) {
  await storageSet({ [reviewKey(gk)]: review });
}

export async function getRecent() {
  const { recent = [] } = await storageGet('recent');
  return recent;
}

/** Deletes every saved game, cached analysis and the recent list. Settings are kept. */
export async function clearAllGames() {
  let keys = [];
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    keys = Object.keys(await chrome.storage.local.get(null));
  } else {
    try {
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i).replace(/^cc:/, ''));
    } catch { /* storage blocked */ }
  }
  const doomed = keys.filter((k) => k.startsWith('game:') || k.startsWith('review:'));
  await storageRemove([...doomed, 'recent']);
  return doomed.filter((k) => k.startsWith('game:')).length;
}
