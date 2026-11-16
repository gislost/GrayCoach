import { getSettings, saveSettings, coachKey, MODELS, DEPTHS } from '../lib/settings.js';
import { verifyKey, HUB } from '../lib/coach.js';
import { clearAllGames } from '../lib/store.js';
import { isExtension } from '../lib/ext.js';
import { checkForUpdate, currentVersion, setUpdateBadge } from '../lib/update.js';

const $ = (id) => document.getElementById(id);

function fillSelect(el, items, valueKey, labelKey) {
  el.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = String(it[valueKey]);
    o.textContent = it[labelKey];
    el.appendChild(o);
  }
}

function setResult(el, text, kind) {
  el.textContent = text;
  el.className = 'small ' + (kind === 'err' ? 'cls-blunder' : kind === 'ok' ? 'cls-best' : 'muted');
}

function readForm() {
  return {
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    depth: Number($('depth').value),
    autoCoach: $('autoCoach').checked,
    openIn: $('openIn').value,
    checkUpdates: $('checkUpdates').checked,
    chesscomUser: $('chesscomUser').value.trim(),
    lichessUser: $('lichessUser').value.trim(),
  };
}

async function init() {
  fillSelect($('model'), MODELS, 'id', 'label');
  fillSelect($('depth'), DEPTHS, 'value', 'label');
  const s = await getSettings();
  $('apiKey').value = s.apiKey;
  $('model').value = s.model;
  $('depth').value = String(s.depth);
  $('autoCoach').checked = s.autoCoach;
  $('openIn').value = s.openIn === 'tab' ? 'tab' : 'panel';
  $('chesscomUser').value = s.chesscomUser;
  $('lichessUser').value = s.lichessUser;
  $('checkUpdates').checked = s.checkUpdates !== false;

  let saved = JSON.stringify(readForm());
  const status = $('status');
  const markDirty = () => {
    const dirty = JSON.stringify(readForm()) !== saved;
    status.textContent = dirty ? 'Unsaved changes' : '';
  };
  document.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', markDirty));
  document.querySelectorAll('input[type=checkbox], select').forEach((el) => el.addEventListener('change', markDirty));

  $('save').addEventListener('click', async () => {
    const next = readForm();
    if (next.apiKey && !next.apiKey.startsWith('sk-ant-')) {
      status.textContent = "That doesn't look like an Anthropic API key (they start with sk-ant-). Saved anyway.";
    } else {
      status.textContent = 'Saved.';
    }
    const before = JSON.parse(saved);
    await saveSettings(next);
    saved = JSON.stringify(next);
    if (next.checkUpdates !== before.checkUpdates) {
      if (next.checkUpdates) checkForUpdate().then((u) => { renderUpdate(u); return setUpdateBadge(u); }).catch(() => {});
      else setUpdateBadge(null).catch(() => {});
    }
  });

  $('showKey').addEventListener('click', () => {
    const k = $('apiKey');
    const show = k.type === 'password';
    k.type = show ? 'text' : 'password';
    $('showKey').textContent = show ? 'Hide' : 'Show';
  });

  $('testKey').addEventListener('click', async () => {
    const out = $('keyResult');
    const { model } = readForm();
    const apiKey = coachKey({ ...(await getSettings()), apiKey: readForm().apiKey });
    if (!apiKey) return setResult(out, 'Enter a key first.', 'err');
    $('testKey').disabled = true;
    setResult(out, 'Checking…');
    try {
      const name = await verifyKey(apiKey, model);
      setResult(out, `Key works. ${name} is available.`, 'ok');
    } catch (e) {
      setResult(out, e.message.replace(' Check it in Settings.', ' Check that you copied the whole key.'), 'err');
    } finally {
      $('testKey').disabled = false;
    }
  });

  $('clearGames').addEventListener('click', async () => {
    if (!confirm('Delete all saved games, analyses and coach reviews? Settings are kept. This cannot be undone.')) return;
    const n = await clearAllGames();
    $('clearStatus').textContent = ` Deleted ${n} saved game${n === 1 ? '' : 's'}.`;
  });

  initUpdates().catch(() => {});
  initHub().catch(() => {});

  window.addEventListener('beforeunload', (e) => {
    if (JSON.stringify(readForm()) !== saved) e.preventDefault();
  });
}

// The Gray Hub card: Connect opens dojo.grayhub.dev/coach-connect, which sends the token to
// background.js; this page notices the change in storage and shows it.
async function initHub() {
  const render = async () => {
    const s = await getSettings();
    const on = !!s.hubToken;
    $('hubOff').hidden = on;
    $('hubOn').hidden = !on;
    $('keyNote').textContent = on ? '(not used while Gray Hub is connected)' : '';
    if (!on) return;
    $('hubName').textContent = s.hubUser || 'your account';
    $('hubStatus').textContent = '';
    try {
      const r = await fetch(`${HUB}/api/coach/status`, { headers: { 'x-api-key': s.hubToken } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || `Gray Hub error ${r.status}`);
      const ai = d.ai || {};
      $('hubStatus').textContent = !d.claude
        ? "Gray Hub doesn't have Claude set up yet."
        : ai.enabled === false
          ? 'AI is turned off for this account.'
          : ai.limit
            ? `${ai.used} of ${ai.limit} AI uses today.`
            : '';
    } catch (e) {
      $('hubStatus').textContent = e.message || String(e);
    }
  };
  $('hubConnect').addEventListener('click', () => window.open(`${HUB}/coach-connect`, '_blank', 'noopener'));
  $('hubDisconnect').addEventListener('click', async () => {
    const s = await getSettings();
    // Forget the token on Gray Hub too; if that fails it still stops working here.
    fetch(`${HUB}/api/coach/token`, { method: 'DELETE', headers: { 'x-api-key': s.hubToken } }).catch(() => {});
    await saveSettings({ hubToken: '', hubUser: '' });
    render();
  });
  if (isExtension) {
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.settings && ch.settings.newValue?.hubToken !== ch.settings.oldValue?.hubToken) render();
    });
  }
  await render();
}

// The Updates card: installed version, and the steps when a newer one is out.
function renderUpdate(u) {
  const newer = !!u?.newer;
  $('updSteps').hidden = !newer;
  if (!newer) return;
  $('newVer').textContent = u.latest;
  $('relNotes').href = u.url;
  $('zipLink').href = u.zip || u.url;
}

async function initUpdates() {
  $('curVer').textContent = (await currentVersion()) || 'unknown';
  if (isExtension) $('reloadExt').addEventListener('click', () => chrome.runtime.reload());
  else {
    // dev page: only the extensions-page route applies
    $('reloadExt').hidden = true;
    $('reloadAlt').textContent = "Press the reload arrow ↻ on GrayCoach in your browser's extensions page.";
  }

  const out = $('checkResult');
  const lastChecked = (u) => `Last checked ${new Date(u.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`;
  $('checkNow').addEventListener('click', async () => {
    const btn = $('checkNow');
    btn.disabled = true;
    setResult(out, 'Checking…');
    try {
      const u = await checkForUpdate({ force: true });
      renderUpdate(u);
      setResult(out, u.newer ? `Version ${u.latest} is out (steps above).` : `You're up to date (${u.current}).`, 'ok');
      if ($('checkUpdates').checked) await setUpdateBadge(u);
    } catch (e) {
      setResult(out, e.message || String(e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  try {
    const u = await checkForUpdate();
    renderUpdate(u);
    if (u && !u.newer) setResult(out, lastChecked(u));
    else if (!u && !$('checkUpdates').checked) setResult(out, 'Daily checks are off.');
  } catch { /* the Check now button still works */ }
  if (location.hash === '#updates') $('updates').scrollIntoView({ block: 'start' });
}

init();
