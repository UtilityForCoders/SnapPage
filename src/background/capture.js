// Captura de la página completa de una pestaña mediante DevTools Protocol.
//
// Nota sobre la escala: a escala nativa (1) la captura no produce cambios visibles.
// Con escalas mayores Chrome fuerza la pestaña a esa densidad mientras genera la
// imagen y el usuario ve un zoom momentáneo; no hay forma de compensarlo desde CDP.

import { attach } from './cdp.js';
import { loadLazyContent, restoreLazyAttributes } from './lazy-load.js';

// Alto máximo de cada tramo en píxeles reales. Chrome falla o devuelve imágenes
// corruptas con capturas mucho más altas, así que las páginas largas se dividen.
const MAX_TILE_DEVICE_PX = 16000;

/**
 * @param {number} tabId
 * @param {{scale?: number, format?: 'png'|'jpeg', quality?: number, preScroll?: boolean}} options
 * @param {(text: string) => void} onProgress
 * @returns {Promise<object>} registro listo para guardar (sin id)
 */
export async function captureFullPage(tabId, options, onProgress) {
  const { scale = 1, format = 'png', quality = 92, preScroll = true } = options;
  let session = null;
  let original = null;

  try {
    onProgress('Conectando con la pestaña…');
    session = await attach(tabId);

    original = await session.evaluate(
      '({ url: location.href, title: document.title, x: scrollX, y: scrollY, vw: innerWidth })'
    );

    await session.send('Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {});

    if (preScroll) {
      onProgress('Cargando contenido diferido…');
      await loadLazyContent(session, original.vw);
    }

    const { width, height } = await session.contentSize();
    if (!width || !height) throw new Error('La página no tiene contenido visible.');

    const tiles = await captureTiles(session, { width, height, scale, format, quality }, onProgress);

    return {
      url: original.url,
      title: original.title,
      width,
      height,
      scale,
      format,
      quality,
      tiles,
      createdAt: Date.now(),
    };
  } finally {
    if (session) {
      await session.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await session.send('Emulation.setScrollbarsHidden', { hidden: false }).catch(() => {});
      await restoreLazyAttributes(session);
      if (original) await session.evaluate(`scrollTo(${original.x}, ${original.y})`).catch(() => {});
      await session.detach();
    }
  }
}

async function captureTiles(session, { width, height, scale, format, quality }, onProgress) {
  const tileCss = Math.max(1, Math.floor(MAX_TILE_DEVICE_PX / scale));
  const total = Math.ceil(height / tileCss);
  const mime = `image/${format}`;
  const tiles = [];

  for (let y = 0, i = 1; y < height; y += tileCss, i++) {
    onProgress(total > 1 ? `Capturando tramo ${i} de ${total}…` : 'Capturando…');
    const h = Math.min(tileCss, height - y);
    const { data } = await session.send('Page.captureScreenshot', {
      format,
      ...(format === 'jpeg' ? { quality } : {}),
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x: 0, y, width, height: h, scale },
    });
    const blob = await (await fetch(`data:${mime};base64,${data}`)).blob();
    tiles.push({ y, height: h, blob });
  }
  return tiles;
}
