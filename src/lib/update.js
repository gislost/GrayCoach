// Update notice. GrayCoach is installed from a zip ("Load unpacked"), and browsers never update those,
// so once a day it asks GitHub for the latest release and says when a newer one is out.
// The request carries nothing about the user: no settings, no games, no cookies.
import { storageGet, storageSet } from './ext.js';

export const REPO = 'https://github.com/gislost/GrayCoach';
const API = 'https://api.github.com/repos/gislost/GrayCoach/releases/latest';
const DAY = 24 * 60 * 60 * 1000;
const VERSION = /^\d+(\.\d+){0,3}$/;

export async function currentVersion() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) return chrome.runtime.getManifest().version;
  try {
    return (await (await fetch(new URL('../manifest.json', location.href))).json()).version; // dev page
  } catch {
    return null;
  }
}

/** Compares dotted version numbers: 1 if a is newer, -1 if older, 0 if equal ("1.10.0" > "1.9.2"). */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Only links into this repo's releases are used, whatever the response says. */
const repoLink = (u, fallback) => (typeof u === 'string' && u.startsWith(REPO + '/releases/') ? u : fallback);

async function fetchLatest() {
  let r;
  try {
    r = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new Error("Couldn't reach GitHub. Check your internet connection.");
  }
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is rate-limiting checks right now. Try again later.' : `GitHub answered ${r.status}.`);
  const j = await r.json();
  const latest = String(j.tag_name || '').replace(/^v/i, '');
  if (!VERSION.test(latest)) throw new Error('GitHub sent an unexpected version number.');
  const zip = (j.assets || []).find((a) => /\.zip$/i.test(a?.name || ''))?.browser_download_url;
  return {
    at: Date.now(),
    latest,
    url: repoLink(j.html_url, `${REPO}/releases/latest`),
    zip: repoLink(zip, null),
  };
}

/**
 * The update state: { current, latest, url, zip, at, newer, dismissed }.
 * Asks GitHub at most once a day (or now, with force). Returns null when checks are turned off
 * (unless forced) or when nothing is known yet and GitHub can't be reached. A forced check throws on failure.
 */
export async function checkForUpdate({ force = false } = {}) {
  const [current, { settings, updateCheck, updateDismissed }] = await Promise.all([
    currentVersion(),
    storageGet(['settings', 'updateCheck', 'updateDismissed']),
  ]);
  if (!force && settings?.checkUpdates === false) return null;
  let info = updateCheck;
  const age = info ? Date.now() - info.at : Infinity;
  if (force || !(age >= 0 && age < DAY)) {
    try {
      info = await fetchLatest();
      await storageSet({ updateCheck: info });
    } catch (e) {
      if (force) throw e;
      if (!info) return null;
    }
  }
  const newer = !!current && compareVersions(info.latest, current) > 0;
  return { current, ...info, newer, dismissed: newer && updateDismissed === info.latest };
}

/** Hides the notice for this version (the Settings page still shows it). */
export async function dismissUpdate(version) {
  await storageSet({ updateDismissed: version });
  await setUpdateBadge(null);
}

/** "NEW" on the toolbar icon while a newer version is out and not dismissed. */
export async function setUpdateBadge(u) {
  if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
  const on = !!(u?.newer && !u.dismissed);
  await chrome.action.setBadgeText({ text: on ? 'NEW' : '' });
  if (on) {
    await chrome.action.setBadgeBackgroundColor({ color: '#2ea043' });
    await chrome.action.setTitle({ title: `GrayCoach: version ${u.latest} is out` });
  } else {
    await chrome.action.setTitle({ title: 'GrayCoach' });
  }
}

/** The page in Settings that walks through updating. */
export const UPDATE_PAGE = 'options/options.html#updates';
