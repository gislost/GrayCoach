import { storageGet, storageSet } from './ext.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best coaching)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

export const DEPTHS = [
  { value: 12, label: 'Quick (depth 12)' },
  { value: 15, label: 'Normal (depth 15)' },
  { value: 18, label: 'Deep (depth 18, slower)' },
];

export const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  depth: 15,
  autoCoach: true,
  openIn: 'panel', // 'panel' (side panel next to the game) or 'tab'
  chesscomUser: '',
  lichessUser: '',
};

export async function getSettings() {
  const { settings } = await storageGet('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await storageSet({ settings: next });
  return next;
}
