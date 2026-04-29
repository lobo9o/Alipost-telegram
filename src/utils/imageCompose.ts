import { Template, TextEl, TerminataConfig } from '../types';

const CANVAS_SIZE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  el: { x: number; y: number; size: number },
) {
  const x = (el.x / 100) * CANVAS_SIZE;
  const y = (el.y / 100) * CANVAS_SIZE;
  const box = (el.size / 100) * CANVAS_SIZE;
  const ratio = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const dw = img.naturalWidth * ratio;
  const dh = img.naturalHeight * ratio;
  ctx.drawImage(img, x + (box - dw) / 2, y + (box - dh) / 2, dw, dh);
}

function drawTextEl(ctx: CanvasRenderingContext2D, el: TextEl, text: string) {
  if (!el.enabled || !text) return;
  const x = (el.x / 100) * CANVAS_SIZE;
  const y = (el.y / 100) * CANVAS_SIZE;
  const fs = el.fontSize * 2; // template px → 1024 canvas

  const anchor = el.textAnchor ?? 'left';
  ctx.save();
  ctx.textAlign = anchor === 'right' ? 'right' : anchor === 'center' ? 'center' : 'left';
  ctx.font = `${el.bold ? 'bold ' : ''}${fs}px ${el.fontFamily || 'Impact'}`;
  ctx.textBaseline = 'top';

  if (el.strokeEnabled && el.strokeWidth > 0) {
    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth * 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }

  ctx.fillStyle = el.color;
  ctx.fillText(text, x, y);

  if (el.strikethrough) {
    const metrics = ctx.measureText(text);
    const strikeY = y + fs * 0.55;
    const startX = anchor === 'right' ? x - metrics.width : anchor === 'center' ? x - metrics.width / 2 : x;
    ctx.strokeStyle = el.strikethroughColor || el.color;
    ctx.lineWidth = Math.max(1, fs * 0.06);
    ctx.beginPath();
    ctx.moveTo(startX, strikeY);
    ctx.lineTo(startX + metrics.width, strikeY);
    ctx.stroke();
  }

  ctx.restore();
}

function makeStoreSvg(platform: 'amazon' | 'aliexpress'): string {
  const amazon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#FF9900"/><text x="50" y="78" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="72" fill="white">a</text></svg>`;
  const ali = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#E43226"/><text x="50" y="68" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="34" fill="white">Ali</text></svg>`;
  const svg = platform === 'amazon' ? amazon : ali;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function generatePostImage(
  template: Template,
  productImageUrl: string,
  isHistoricalLow: boolean,
  platform: 'amazon' | 'aliexpress',
  values: {
    prezzo?: string;
    prezzoPrecedente?: string;
    sconto?: string;
    testoCustom?: string;
  } = {},
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = template.bgColor || '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Product image via CORS proxy
  if (productImageUrl && productImageUrl.startsWith('http')) {
    try {
      const img = await loadImage(`/api/posts?img=${encodeURIComponent(productImageUrl)}`);
      drawContained(ctx, img, template.product);
    } catch { /* skip on error */ }
  }

  // Overlay PNG
  if (template.overlay.enabled && template.overlay.src) {
    try {
      const img = await loadImage(template.overlay.src);
      const el = template.overlay;
      ctx.drawImage(img, (el.x / 100) * CANVAS_SIZE, (el.y / 100) * CANVAS_SIZE, (el.size / 100) * CANVAS_SIZE, (el.size / 100) * CANVAS_SIZE);
    } catch { /* skip */ }
  }

  // Store logo (Amazon / AliExpress auto icon)
  if (template.store.enabled) {
    try {
      const img = await loadImage(makeStoreSvg(platform));
      const el = template.store;
      const s = (el.size / 100) * CANVAS_SIZE;
      ctx.drawImage(img, (el.x / 100) * CANVAS_SIZE, (el.y / 100) * CANVAS_SIZE, s, s);
    } catch { /* skip */ }
  }

  // Text elements
  drawTextEl(ctx, template.prezzo, values.prezzo ?? template.prezzo.text);
  drawTextEl(ctx, template.prezzoPrecedente, values.prezzoPrecedente ?? template.prezzoPrecedente.text);
  drawTextEl(ctx, template.sconto, values.sconto ?? template.sconto.text);
  drawTextEl(ctx, template.testoCustom, values.testoCustom ?? template.testoCustom.text);

  // Badge — ULTIMO livello, sopra tutto incluso il testo
  if (template.badge.enabled && isHistoricalLow && template.badge.src) {
    try {
      const img = await loadImage(template.badge.src);
      const el = template.badge;
      const w = (el.size / 100) * CANVAS_SIZE;
      const h = (img.naturalHeight / img.naturalWidth) * w;
      ctx.drawImage(img, (el.x / 100) * CANVAS_SIZE, (el.y / 100) * CANVAS_SIZE, w, h);
    } catch { /* skip */ }
  }

  return canvas.toDataURL('image/jpeg', 0.88);
}

export async function generateTerminataImage(
  template: Template,
  productImageUrl: string,
  platform: 'amazon' | 'aliexpress',
  config: TerminataConfig,
  values: { prezzo?: string; prezzoPrecedente?: string; sconto?: string; testoCustom?: string } = {},
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = template.bgColor || '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (productImageUrl && productImageUrl.startsWith('http')) {
    try {
      const img = await loadImage(`/api/posts?img=${encodeURIComponent(productImageUrl)}`);
      drawContained(ctx, img, template.product);
    } catch { /* skip */ }
  }

  if (template.overlay.enabled && template.overlay.src) {
    try {
      const img = await loadImage(template.overlay.src);
      const el = template.overlay;
      ctx.drawImage(img, (el.x / 100) * CANVAS_SIZE, (el.y / 100) * CANVAS_SIZE, (el.size / 100) * CANVAS_SIZE, (el.size / 100) * CANVAS_SIZE);
    } catch { /* skip */ }
  }

  if (template.store.enabled) {
    try {
      const img = await loadImage(makeStoreSvg(platform));
      const el = template.store;
      const s = (el.size / 100) * CANVAS_SIZE;
      ctx.drawImage(img, (el.x / 100) * CANVAS_SIZE, (el.y / 100) * CANVAS_SIZE, s, s);
    } catch { /* skip */ }
  }

  // Grayscale sull'intera immagine (prodotto + overlay + store)
  if (config.grayscale) {
    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  if (config.showPrezzo) drawTextEl(ctx, template.prezzo, values.prezzo ?? template.prezzo.text);
  if (config.showPrezzoPrecedente) drawTextEl(ctx, template.prezzoPrecedente, values.prezzoPrecedente ?? template.prezzoPrecedente.text);
  if (config.showSconto) drawTextEl(ctx, template.sconto, values.sconto ?? template.sconto.text);
  drawTextEl(ctx, template.testoCustom, values.testoCustom ?? template.testoCustom.text);

  if (config.overlayText) {
    const fs = (config.overlayTextSize / 100) * CANVAS_SIZE;
    const tx = (config.overlayTextX / 100) * CANVAS_SIZE;
    const ty = (config.overlayTextY / 100) * CANVAS_SIZE;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fs}px Impact, Arial Black`;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = fs * 0.08;
    ctx.lineJoin = 'round';
    ctx.strokeText(config.overlayText, tx, ty);
    ctx.fillStyle = config.overlayTextColor;
    ctx.fillText(config.overlayText, tx, ty);
    ctx.restore();
  }

  return canvas.toDataURL('image/jpeg', 0.88);
}
