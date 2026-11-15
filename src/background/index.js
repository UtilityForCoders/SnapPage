// Service worker: recibe la orden del popup, coordina la captura y abre la vista previa.

import { saveCapture, pruneOld } from '../shared/db.js';
import { captureFullPage } from './capture.js';
import { friendlyError } from './errors.js';

const KEEP_CAPTURES = 5;

let busy = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'capture') return;
  if (busy) {
    progress('Ya hay una captura en curso.', 'error');
    return;
  }
  run(msg.tabId, msg.options || {});
});

async function run(tabId, options) {
  busy = true;
  setBadge('…', '#1a73e8');
  try {
    const record = await captureFullPage(tabId, options, (text) => progress(text));

    progress('Guardando…');
    const id = String(Date.now());
    await saveCapture({ id, ...record });
    await pruneOld(KEEP_CAPTURES);

    await openPreview(tabId, id);
    progress('¡Listo!', 'done');
    setBadge('');
  } catch (err) {
    console.error(err);
    progress(friendlyError(err), 'error');
    setBadge('ERR', '#d93025');
  } finally {
    busy = false;
  }
}

async function openPreview(tabId, id) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/preview/preview.html?id=${id}`),
    ...(tab ? { index: tab.index + 1, windowId: tab.windowId } : {}),
  });
}

function progress(text, state = 'working') {
  chrome.runtime.sendMessage({ type: 'progress', text, state }).catch(() => {});
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}
