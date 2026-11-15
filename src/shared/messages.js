// Tipos de mensaje entre el popup y el service worker.
export const MSG = Object.freeze({
  CAPTURE: 'capture', // popup → service worker: { type, tabId, options }
  PROGRESS: 'progress', // service worker → popup: { type, text, state }
});

export const STATE = Object.freeze({
  WORKING: 'working',
  DONE: 'done',
  ERROR: 'error',
});
