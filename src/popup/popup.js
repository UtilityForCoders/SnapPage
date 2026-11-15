import { MSG, STATE } from '../shared/messages.js';

const $ = (id) => document.getElementById(id);
// v2: la escala por defecto pasó a "nativa" (sin zoom); se ignoran ajustes guardados antes.
const SETTINGS_KEY = 'snappage-settings-v2';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.scale) $('scale').value = String(s.scale);
    if (s.format) document.querySelector(`input[name=format][value=${s.format}]`).checked = true;
    if (s.quality) $('quality').value = String(s.quality);
    if (typeof s.preScroll === 'boolean') $('preScroll').checked = s.preScroll;
  } catch {}
}

function readSettings() {
  return {
    scale: Number($('scale').value),
    format: document.querySelector('input[name=format]:checked').value,
    quality: Number($('quality').value),
    preScroll: $('preScroll').checked,
  };
}

function syncUi() {
  const s = readSettings();
  $('qualityField').hidden = s.format !== 'jpeg';
  $('qualityOut').textContent = s.quality;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function setStatus(text, state = '') {
  $('status').textContent = text;
  $('status').dataset.state = state;
}

loadSettings();
syncUi();
document.querySelectorAll('select, input').forEach((el) => el.addEventListener('input', syncUi));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== MSG.PROGRESS) return;
  setStatus(msg.text, msg.state);
  if (msg.state !== STATE.WORKING) $('capture').disabled = false;
});

$('capture').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return setStatus('No se encontró la pestaña activa.', STATE.ERROR);
  $('capture').disabled = true;
  setStatus('Iniciando…', STATE.WORKING);
  chrome.runtime.sendMessage({ type: MSG.CAPTURE, tabId: tab.id, options: readSettings() });
});
