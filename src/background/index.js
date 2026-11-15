import { saveCapture, pruneOld } from '../shared/db.js';

// Alto máximo de cada tramo en píxeles reales. Chrome falla o devuelve imágenes
// corruptas con capturas mucho más altas, así que las páginas largas se dividen.
const MAX_TILE_DEVICE_PX = 16000;

let busy = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'capture') return;
  if (busy) {
    progress('Ya hay una captura en curso.', 'error');
    return;
  }
  capture(msg.tabId, msg.options || {}).catch((err) => {
    console.error(err);
    progress(friendlyError(err), 'error');
    setBadge('ERR', '#d93025');
  });
});

function progress(text, state = 'working') {
  chrome.runtime.sendMessage({ type: 'progress', text, state }).catch(() => {});
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

function friendlyError(err) {
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

async function evaluate(send, expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || 'Error al ejecutar código en la página');
  }
  return r.result.value;
}

// Alto máximo (CSS px) al que se expande el viewport virtual para cargar contenido diferido.
const MAX_LAZY_VIEWPORT = 30000;

// Se ejecuta con el viewport ya expandido a toda la página: los IntersectionObserver
// y loading="lazy" ven todo como "visible" y cargan sin que haga falta hacer scroll.
const LOAD_LAZY = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach((el) => {
    el.setAttribute('data-snappage-lazy', '');
    el.loading = 'eager';
  });
  // Librerías antiguas que escuchan scroll/resize en lugar de IntersectionObserver.
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('scroll'));
  document.dispatchEvent(new Event('scroll'));
  await sleep(500);
  const pending = [...document.images].filter((i) => !i.complete);
  await Promise.all(pending.map((i) => new Promise((r) => {
    i.addEventListener('load', r, { once: true });
    i.addEventListener('error', r, { once: true });
    setTimeout(r, 4000);
  })));
  await sleep(200);
  return true;
})()`;

const RESTORE_LAZY = `document.querySelectorAll('[data-snappage-lazy]').forEach((el) => {
  el.removeAttribute('data-snappage-lazy');
  el.loading = 'lazy';
})`;

async function contentSize(send) {
  const m = await send('Page.getLayoutMetrics');
  const s = m.cssContentSize || m.contentSize;
  return { width: Math.ceil(s.width), height: Math.ceil(s.height) };
}

async function capture(tabId, { scale = 2, format = 'png', quality = 92, preScroll = true }) {
  busy = true;
  setBadge('…', '#1a73e8');
  const target = { tabId };
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);
  let attached = false;
  let original = null;

  try {
    progress('Conectando con la pestaña…');
    await chrome.debugger.attach(target, '1.3');
    attached = true;

    original = await evaluate(
      send,
      '({ url: location.href, title: document.title, x: scrollX, y: scrollY, vw: innerWidth })'
    );

    await send('Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {});

    if (preScroll) {
      // Sin mover la página: se agranda el viewport virtual hasta el alto del contenido.
      // Se repite si al cargar imágenes la página creció.
      progress('Cargando contenido diferido…');
      let prev = 0;
      for (let pass = 0; pass < 3; pass++) {
        const { height: h } = await contentSize(send);
        if (h <= prev) break;
        prev = h;
        await send('Emulation.setDeviceMetricsOverride', {
          width: original.vw,
          height: Math.min(h, MAX_LAZY_VIEWPORT),
          deviceScaleFactor: 0,
          mobile: false,
        });
        await evaluate(send, LOAD_LAZY, true);
      }
      await send('Emulation.clearDeviceMetricsOverride');
    }

    const { width, height } = await contentSize(send);
    if (!width || !height) throw new Error('La página no tiene contenido visible.');

    const tileCss = Math.max(1, Math.floor(MAX_TILE_DEVICE_PX / scale));
    const total = Math.ceil(height / tileCss);
    const mime = `image/${format}`;
    const tiles = [];

    for (let y = 0, i = 1; y < height; y += tileCss, i++) {
      progress(total > 1 ? `Capturando tramo ${i} de ${total}…` : 'Capturando…');
      const h = Math.min(tileCss, height - y);
      const { data } = await send('Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: 0, y, width, height: h, scale },
      });
      const blob = await (await fetch(`data:${mime};base64,${data}`)).blob();
      tiles.push({ y, height: h, blob });
    }

    progress('Guardando…');
    const id = String(Date.now());
    await saveCapture({
      id,
      url: original.url,
      title: original.title,
      width,
      height,
      scale,
      format,
      quality,
      tiles,
      createdAt: Date.now(),
    });
    await pruneOld(5);

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/preview/preview.html?id=${id}`),
      ...(tab ? { index: tab.index + 1, windowId: tab.windowId } : {}),
    });
    progress('¡Listo!', 'done');
    setBadge('');
  } finally {
    if (attached) {
      await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await send('Emulation.setScrollbarsHidden', { hidden: false }).catch(() => {});
      await evaluate(send, RESTORE_LAZY).catch(() => {});
      if (original) await evaluate(send, `scrollTo(${original.x}, ${original.y})`).catch(() => {});
      await chrome.debugger.detach(target).catch(() => {});
    }
    busy = false;
  }
}
