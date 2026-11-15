// Envoltorio mínimo sobre chrome.debugger (Chrome DevTools Protocol) para una pestaña.

export async function attach(tabId) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');

  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);

  async function evaluate(expression, awaitPromise = false) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'Error al ejecutar código en la página');
    }
    return r.result.value;
  }

  async function contentSize() {
    const m = await send('Page.getLayoutMetrics');
    const s = m.cssContentSize || m.contentSize;
    return { width: Math.ceil(s.width), height: Math.ceil(s.height) };
  }

  const detach = () => chrome.debugger.detach(target).catch(() => {});

  return { send, evaluate, contentSize, detach };
}
