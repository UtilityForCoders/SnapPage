// Traduce los errores de chrome.debugger / CDP a mensajes comprensibles.
export function friendlyError(err) {
  const m = err?.message || String(err);
  if (/chrome:\/\/|chrome-extension:\/\/|edge:\/\/|Cannot access|Cannot attach/i.test(m)) {
    return 'Esta página está protegida por el navegador y no se puede capturar.';
  }
  if (/Another debugger|already attached/i.test(m)) {
    return 'Las DevTools u otra extensión están conectadas a esta pestaña. Ciérralas e inténtalo de nuevo.';
  }
  if (/Detached|not attached/i.test(m)) {
    return 'La captura se canceló (se cerró la barra de depuración o la pestaña).';
  }
  return 'Error: ' + m;
}
