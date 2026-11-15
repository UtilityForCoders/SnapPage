import { getCapture, deleteCapture } from './db.js';

// Límites de canvas de Chrome: ningún lado mayor a 32767 px y área máxima ~268 Mpx.
const MAX_SIDE = 32767;
const MAX_AREA = 268435456;

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');

const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

function baseName(rec) {
  let host = 'pagina';
  try { host = new URL(rec.url).hostname.replace(/^www\./, ''); } catch {}
  const d = new Date(rec.createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${host}_${stamp}`.replace(/[^\w.-]+/g, '_');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function stitch(rec) {
  const bitmaps = await Promise.all(rec.tiles.map((t) => createImageBitmap(t.blob)));
  const width = Math.max(...bitmaps.map((b) => b.width));
  const height = bitmaps.reduce((sum, b) => sum + b.height, 0);
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_AREA) {
    bitmaps.forEach((b) => b.close());
    return null;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (rec.format === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  let y = 0;
  for (const b of bitmaps) {
    ctx.drawImage(b, 0, y);
    y += b.height;
    b.close();
  }
  return canvas.convertToBlob({ type: `image/${rec.format}`, quality: rec.quality / 100 });
}

function showImage(blob) {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  img.alt = 'Captura de página completa';
  $('stage').append(img);
  return img;
}

async function init() {
  const rec = id && (await getCapture(id));
  if (!rec) {
    $('title').textContent = 'Captura no encontrada';
    $('details').textContent = 'Puede que se haya eliminado. Vuelve a capturar desde el icono de la extensión.';
    $('delete').hidden = true;
    return;
  }

  document.title = `Snappage · ${rec.title || rec.url}`;
  $('title').textContent = rec.title || rec.url;
  const ext = rec.format === 'jpeg' ? 'jpg' : 'png';
  const name = baseName(rec);

  let blob = rec.tiles.length === 1 ? rec.tiles[0].blob : await stitch(rec);

  if (blob) {
    const img = showImage(blob);
    await img.decode().catch(() => {});
    $('details').textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${rec.scale}x · ${ext.toUpperCase()} · ${fmtBytes(blob.size)}`;
    $('download').onclick = () => download(blob, `${name}.${ext}`);
    if (rec.format === 'png' && 'ClipboardItem' in window) {
      $('copy').hidden = false;
      $('copy').onclick = async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          $('copy').textContent = '¡Copiado!';
        } catch {
          $('copy').textContent = 'No se pudo copiar';
        }
        setTimeout(() => ($('copy').textContent = 'Copiar'), 2000);
      };
    }
  } else {
    // Demasiado grande para una sola imagen: se ofrecen las partes por separado.
    const total = rec.tiles.reduce((s, t) => s + t.blob.size, 0);
    $('details').textContent = `${rec.tiles.length} partes · ${rec.scale}x · ${ext.toUpperCase()} · ${fmtBytes(total)}`;
    $('notice').hidden = false;
    $('notice').textContent = `La página es demasiado larga para una sola imagen a ${rec.scale}x, así que se guardó en ${rec.tiles.length} partes. Para una sola imagen, captura de nuevo con una escala menor.`;
    rec.tiles.forEach((t) => showImage(t.blob));
    $('download').textContent = `Descargar ${rec.tiles.length} partes`;
    $('download').onclick = async () => {
      for (let i = 0; i < rec.tiles.length; i++) {
        download(rec.tiles[i].blob, `${name}_parte${String(i + 1).padStart(2, '0')}.${ext}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    };
  }
  $('download').disabled = false;

  $('delete').onclick = async () => {
    await deleteCapture(rec.id);
    window.close();
  };
}

$('stage').addEventListener('click', () => $('stage').classList.toggle('fit'));

init().catch((err) => {
  console.error(err);
  $('title').textContent = 'Error al abrir la captura';
  $('details').textContent = err.message || String(err);
});
