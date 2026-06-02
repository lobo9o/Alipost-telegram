import { Template, TextEl, TerminataConfig } from '../types';

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
  canvasW: number,
  canvasH: number,
  canvasRef: number,
) {
  const x = (el.x / 100) * canvasW;
  const y = (el.y / 100) * canvasH;
  const box = (el.size / 100) * canvasRef;
  const ratio = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const dw = img.naturalWidth * ratio;
  const dh = img.naturalHeight * ratio;
  ctx.drawImage(img, x + (box - dw) / 2, y + (box - dh) / 2, dw, dh);
}

export function applyCurrPos(text: string, pos?: 'before' | 'after'): string {
  if (pos !== 'after') return text;
  const m = text.match(/^([^0-9]+)([\d].*)/);
  return m ? `${m[2]}${m[1].trimEnd()}` : text;
}

export function applyDecimalSep(text: string, sep?: '.' | ','): string {
  if (!sep) return text;
  return text.replace(/([.,])(\d{1,3})([\D]*)$/, (_, _d, dec, suf) => `${sep}${dec}${suf}`);
}

export function applySconto(text: string, hidePercent?: boolean, hideMinus?: boolean): string {
  let t = text;
  if (hideMinus) t = t.replace(/^-/, '');
  if (hidePercent) t = t.replace(/%$/, '');
  return t;
}

function splitAtDecimal(text: string): { main: string; dec: string; suffix: string } | null {
  const m = text.match(/^(.*?)([.,]\d{1,3})([\D]*)$/);
  if (!m) return null;
  return { main: m[1], dec: m[2], suffix: m[3] };
}

function drawTextEl(ctx: CanvasRenderingContext2D, el: TextEl, text: string, canvasW: number, canvasH: number) {
  if (!el.enabled || !text) return;
  const x = (el.x / 100) * canvasW;
  const y = (el.y / 100) * canvasH;
  const fs = el.fontSize * 2;
  const anchor = el.textAnchor ?? 'left';
  const fontStr = (size: number) => `${el.bold ? 'bold ' : ''}${size}px ${el.fontFamily || 'Impact'}, 'Open Sans', sans-serif`;
  const scale = el.decimalFontScale != null && el.decimalFontScale < 1 ? el.decimalFontScale : 1;
  const parts = scale < 1 ? splitAtDecimal(text) : null;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Misura la cap height reale per allineare il top visivo a y (uguale a CSS top: Y%)
  // actualBoundingBoxAscent è cross-platform e non dipende da hhea/winAscent del font
  ctx.font = fontStr(fs);
  const capH = ctx.measureText('H').actualBoundingBoxAscent;
  const baseline = y + capH; // baseline alfabetica allineata al top visivo in y

  if (!parts) {
    const textW = ctx.measureText(text).width;
    const drawX = anchor === 'right' ? x - textW : anchor === 'center' ? x - textW / 2 : x;
    if (el.strokeEnabled && el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor; ctx.lineWidth = el.strokeWidth * 2; ctx.lineJoin = 'round';
      ctx.strokeText(text, drawX, baseline);
    }
    ctx.fillStyle = el.color;
    ctx.fillText(text, drawX, baseline);
    if (el.strikethrough) {
      ctx.strokeStyle = el.strikethroughColor || el.color;
      ctx.lineWidth = Math.max(1, fs * 0.06);
      ctx.beginPath(); ctx.moveTo(drawX, baseline - capH * 0.5); ctx.lineTo(drawX + textW, baseline - capH * 0.5); ctx.stroke();
    }
  } else {
    const fsDec = Math.round(fs * scale);
    ctx.font = fontStr(fs);
    const mainW = ctx.measureText(parts.main).width;
    ctx.font = fontStr(fsDec);
    const decW = ctx.measureText(parts.dec).width;
    ctx.font = fontStr(fs);
    const sufW = parts.suffix ? ctx.measureText(parts.suffix).width : 0;
    const totalW = mainW + decW + sufW;
    const drawX = anchor === 'right' ? x - totalW : anchor === 'center' ? x - totalW / 2 : x;

    // main e dec hanno la stessa baseline → i fondi sono allineati (cifre non hanno discendenti)
    ctx.font = fontStr(fs);
    if (el.strokeEnabled && el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor; ctx.lineWidth = el.strokeWidth * 2; ctx.lineJoin = 'round';
      ctx.strokeText(parts.main, drawX, baseline);
    }
    ctx.fillStyle = el.color;
    ctx.fillText(parts.main, drawX, baseline);

    ctx.font = fontStr(fsDec);
    if (el.strokeEnabled && el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor; ctx.lineWidth = el.strokeWidth * 2; ctx.lineJoin = 'round';
      ctx.strokeText(parts.dec, drawX + mainW, baseline);
    }
    ctx.fillStyle = el.color;
    ctx.fillText(parts.dec, drawX + mainW, baseline);

    if (parts.suffix) {
      ctx.font = fontStr(fs);
      if (el.strokeEnabled && el.strokeWidth > 0) {
        ctx.strokeStyle = el.strokeColor; ctx.lineWidth = el.strokeWidth * 2; ctx.lineJoin = 'round';
        ctx.strokeText(parts.suffix, drawX + mainW + decW, baseline);
      }
      ctx.fillStyle = el.color;
      ctx.fillText(parts.suffix, drawX + mainW + decW, baseline);
    }

    if (el.strikethrough) {
      ctx.strokeStyle = el.strikethroughColor || el.color;
      ctx.lineWidth = Math.max(1, fs * 0.06);
      ctx.beginPath(); ctx.moveTo(drawX, baseline - capH * 0.5); ctx.lineTo(drawX + totalW, baseline - capH * 0.5); ctx.stroke();
    }
  }

  ctx.restore();
}

function makeStoreImageUrl(platform: 'amazon' | 'aliexpress'): string {
  return platform === 'amazon' ? '/store-amazon.png' : '/store-aliexpress.png';
}

// Fattore correttivo: a parità di size%, Amazon e AliExpress appaiono uguali
const STORE_SCALE: Record<'amazon' | 'aliexpress', number> = {
  amazon:     1.0,
  aliexpress: 5 / 11,
};

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
  const canvasW = template.canvasW ?? 1024;
  const canvasH = template.canvasH ?? 1024;
  const canvasRef = Math.min(canvasW, canvasH);
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = template.bgColor || '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Product image via CORS proxy
  if (productImageUrl && productImageUrl.startsWith('http')) {
    try {
      const img = await loadImage(`/api/posts?img=${encodeURIComponent(productImageUrl)}`);
      drawContained(ctx, img, template.product, canvasW, canvasH, canvasRef);
    } catch { /* skip on error */ }
  }

  // Overlay PNG — contain rettangolare: box usa canvasW×canvasH come la preview CSS
  if (template.overlay.enabled && template.overlay.src) {
    try {
      const img = await loadImage(template.overlay.src);
      const el = template.overlay;
      const boxX = (el.x / 100) * canvasW;
      const boxY = (el.y / 100) * canvasH;
      const boxW = (el.size / 100) * canvasW;
      const boxH = (el.size / 100) * canvasH;
      const ratio = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
      const dw = img.naturalWidth * ratio;
      const dh = img.naturalHeight * ratio;
      ctx.drawImage(img, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);
    } catch { /* skip */ }
  }

  // Store logo (Amazon / AliExpress)
  const storeEl = platform === 'amazon' ? template.storeAmazon : template.storeAliexpress;
  if (storeEl?.enabled) {
    try {
      const img = await loadImage(makeStoreImageUrl(platform));
      const h = (storeEl.size / 100) * STORE_SCALE[platform] * canvasRef;
      const w = h * (img.naturalWidth / img.naturalHeight);
      ctx.drawImage(img, (storeEl.x / 100) * canvasW, (storeEl.y / 100) * canvasH, w, h);
    } catch { /* skip */ }
  }

  // Assicura che i font siano caricati nel contesto browser prima di disegnare
  {
    const textEls = [template.prezzo, template.prezzoPrecedente, template.sconto, template.testoCustom];
    await Promise.all(textEls.filter(el => el?.enabled && el?.fontFamily).map(el => {
      const w = el.bold ? '700' : '400';
      return document.fonts.load(`${w} ${el.fontSize * 2}px "${el.fontFamily}"`).catch(() => {});
    }));
  }

  // Text elements
  drawTextEl(ctx, template.prezzo, applyDecimalSep(applyCurrPos(values.prezzo ?? template.prezzo.text, template.prezzo.currencyPos), template.prezzo.decimalSep), canvasW, canvasH);
  drawTextEl(ctx, template.prezzoPrecedente, applyDecimalSep(applyCurrPos(values.prezzoPrecedente ?? template.prezzoPrecedente.text, template.prezzoPrecedente.currencyPos), template.prezzoPrecedente.decimalSep), canvasW, canvasH);
  drawTextEl(ctx, template.sconto, applySconto(values.sconto ?? template.sconto.text, template.sconto.hidePercent, template.sconto.hideMinus), canvasW, canvasH);
  drawTextEl(ctx, template.testoCustom, values.testoCustom ?? template.testoCustom.text, canvasW, canvasH);

  // Badge — ULTIMO livello, sopra tutto incluso il testo
  if (template.badge.enabled && isHistoricalLow && template.badge.src) {
    try {
      const img = await loadImage(template.badge.src);
      const el = template.badge;
      const w = (el.size / 100) * canvasW;
      const h = (img.naturalHeight / img.naturalWidth) * w;
      ctx.drawImage(img, (el.x / 100) * canvasW, (el.y / 100) * canvasH, w, h);
    } catch { /* skip */ }
  }

  return canvas.toDataURL('image/jpeg', 0.88);
}

export async function generateMultiPostImage(imageUrls: string[]): Promise<string> {
  const n = imageUrls.length;
  if (n === 0) return '';
  const cols = n <= 3 ? n : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  // Celle quadrate, canvas esattamente cellSize*cols × cellSize*rows (niente pixel scoperti)
  const cellSize = Math.round(1024 / cols);
  const canvasW = cellSize * cols;
  const canvasH = cellSize * rows;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const PAD = 4;
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const itemsInRow = Math.min(cols, n - row * cols);
    const rowOffsetX = Math.floor(((cols - itemsInRow) * cellSize) / 2);
    const cellX = rowOffsetX + col * cellSize;
    const cellY = row * cellSize;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cellX, cellY, cellSize, cellSize);
    if (!imageUrls[i]) continue;
    try {
      const proxyUrl = imageUrls[i].startsWith('http')
        ? `/api/posts?img=${encodeURIComponent(imageUrls[i])}`
        : imageUrls[i];
      const img = await loadImage(proxyUrl);
      const availW = cellSize - PAD * 2;
      const availH = cellSize - PAD * 2;
      const ratio = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
      const dw = img.naturalWidth * ratio;
      const dh = img.naturalHeight * ratio;
      ctx.drawImage(img, cellX + PAD + (availW - dw) / 2, cellY + PAD + (availH - dh) / 2, dw, dh);
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
  // Crea una copia del template disabilitando i campi che non vanno mostrati sulla terminata
  const tmpl: Template = {
    ...template,
    prezzo:           { ...template.prezzo,           enabled: template.prezzo.enabled           && config.showPrezzo },
    prezzoPrecedente: { ...template.prezzoPrecedente, enabled: template.prezzoPrecedente.enabled && config.showPrezzoPrecedente },
    sconto:           { ...template.sconto,           enabled: template.sconto.enabled           && config.showSconto },
  };

  // Genera l'immagine completa del template (stesso rendering del publish normale)
  const baseDataUrl = await generatePostImage(tmpl, productImageUrl, false, platform, values);

  const canvas = document.createElement('canvas');
  const canvasW = template.canvasW ?? 1024;
  const canvasH = template.canvasH ?? 1024;
  const canvasRef = Math.min(canvasW, canvasH);
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // Disegna l'immagine base del template
  const baseImg = await loadImage(baseDataUrl);
  ctx.drawImage(baseImg, 0, 0, canvasW, canvasH);

  // Grayscale opzionale sull'immagine finale
  if (config.grayscale) {
    const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // Testo "TERMINATA" sovrapposto
  if (config.overlayText) {
    const fs = (config.overlayTextSize / 100) * canvasRef;
    const tx = (config.overlayTextX / 100) * canvasW;
    const ty = (config.overlayTextY / 100) * canvasH;
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
