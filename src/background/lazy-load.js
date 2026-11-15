// Carga del contenido diferido (lazy-load) sin mover la página del usuario.
//
// En lugar de hacer scroll, se agranda el viewport virtual hasta el alto del contenido:
// los IntersectionObserver y loading="lazy" ven todo como "visible" y cargan solos.
// Cambiar solo el tamaño del viewport emulado no produce ningún cambio visible.

// Alto máximo (CSS px) al que se expande el viewport virtual.
const MAX_LAZY_VIEWPORT = 30000;
const MAX_PASSES = 3;

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

export async function loadLazyContent(session, viewportWidth) {
  // Se repite si al cargar imágenes la página creció.
  let prev = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { height } = await session.contentSize();
    if (height <= prev) break;
    prev = height;
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: Math.min(height, MAX_LAZY_VIEWPORT),
      deviceScaleFactor: 0,
      mobile: false,
    });
    await session.evaluate(LOAD_LAZY, true);
  }
  await session.send('Emulation.clearDeviceMetricsOverride');
}

export function restoreLazyAttributes(session) {
  return session.evaluate(RESTORE_LAZY).catch(() => {});
}
