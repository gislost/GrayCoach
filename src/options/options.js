import { getSettings, saveSettings, MODELS, DEPTHS } from '../lib/settings.js';
import { verifyKey } from '../lib/coach.js';
import { clearAllGames } from '../lib/store.js';

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
  $('chesscomUser').value = s.chesscomUser;
  $('lichessUser').value = s.lichessUser;

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
    await saveSettings(next);
    saved = JSON.stringify(next);
  });

  $('showKey').addEventListener('click', () => {
    const k = $('apiKey');
    const show = k.type === 'password';
    k.type = show ? 'text' : 'password';
    $('showKey').textContent = show ? 'Hide' : 'Show';
  });

  $('testKey').addEventListener('click', async () => {
    const out = $('keyResult');
    const { apiKey, model } = readForm();
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

  window.addEventListener('beforeunload', (e) => {
    if (JSON.stringify(readForm()) !== saved) e.preventDefault();
  });
}

init();
