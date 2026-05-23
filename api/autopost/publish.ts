import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler } from '../_utils.js';
import { checkPostPrice } from '../_priceCheck.js';
import crypto from 'crypto';

// ── AliExpress auto-search helpers ────────────────────────────────────────────
const ALI_COUNTRY_MAP: Record<string, { currency: string; language: string }> = {
  IT: { currency: 'EUR', language: 'IT' }, US: { currency: 'USD', language: 'EN' },
  DE: { currency: 'EUR', language: 'DE' }, FR: { currency: 'EUR', language: 'FR' },
  ES: { currency: 'EUR', language: 'ES' }, UK: { currency: 'GBP', language: 'EN' },
  RU: { currency: 'RUB', language: 'RU' }, BR: { currency: 'BRL', language: 'PT' },
  PL: { currency: 'PLN', language: 'PL' }, NL: { currency: 'EUR', language: 'NL' },
};

function aliSignAuto(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const str = secret + sorted.map(k => `${k}${params[k]}`).join('') + secret;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function aliTsAuto(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function aliGenerateLink(productUrl: string, appKey: string, appSecret: string, trackingId: string, country?: string): Promise<string | null> {
  try {
    const params: Record<string, string> = {
      app_key: appKey.trim(), method: 'aliexpress.affiliate.link.generate',
      sign_method: 'md5', timestamp: aliTsAuto(), v: '2.0',
      promotion_link_type: '0', source_values: productUrl, tracking_id: trackingId,
    };
    if (country) params.ship_to_country = country.toUpperCase();
    params.sign = aliSignAuto(params, appSecret.trim());
    const res = await fetch('https://api-sg.aliexpress.com/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });
    const json = await res.json() as any;
    const link = json?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link;
    if (link) console.log('[autopost] aliGenerateLink ok:', link.slice(0, 60));
    else console.warn('[autopost] aliGenerateLink: nessun link restituito per', productUrl.slice(0, 60), '| resp:', JSON.stringify(json).slice(0, 200));
    return link || null;
  } catch (e: any) {
    console.warn('[autopost] aliGenerateLink error:', e.message);
    return null;
  }
}

async function aliAutoQuery(appKey: string, appSecret: string, extra: Record<string, string>): Promise<any[]> {
  try {
    const params: Record<string, string> = {
      app_key: appKey.trim(), method: 'aliexpress.affiliate.product.query',
      sign_method: 'md5', timestamp: aliTsAuto(), v: '2.0', ...extra,
    };
    params.sign = aliSignAuto(params, appSecret.trim());
    const res = await fetch('https://api-sg.aliexpress.com/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    const products = json?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product;
    return Array.isArray(products) ? products : [];
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
const MARKETPLACE_DOMAINS: Record<string, string> = {
  IT: 'www.amazon.it', US: 'www.amazon.com', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', ES: 'www.amazon.es', UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca',
};

const ALI_CURRENCY_SYM: Record<string, string> = {
  IT: '€', DE: '€', FR: '€', ES: '€', NL: '€',
  US: '$', BR: 'R$', UK: '£', RU: '₽', PL: 'zł',
};

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const COUNTRY_IT: Record<string, string> = {
  CN: 'Cina', FR: 'Francia', DE: 'Germania', IT: 'Italia', US: 'USA',
  GB: 'UK', ES: 'Spagna', JP: 'Giappone', KR: 'Corea del Sud',
  NL: 'Paesi Bassi', PL: 'Polonia', RU: 'Russia', BR: 'Brasile',
  TR: 'Turchia', AU: 'Australia', CA: 'Canada', IN: 'India',
  TH: 'Thailandia', VN: 'Vietnam', MY: 'Malaysia', SG: 'Singapore',
  ID: 'Indonesia', PH: 'Filippine', MX: 'Messico', UA: 'Ucraina',
  CZ: 'Rep. Ceca', HU: 'Ungheria', RO: 'Romania', SE: 'Svezia',
  NO: 'Norvegia', DK: 'Danimarca', FI: 'Finlandia', BE: 'Belgio',
  AT: 'Austria', CH: 'Svizzera', PT: 'Portogallo', GR: 'Grecia',
  SA: 'Arabia Saudita', AE: 'Emirati Arabi', IL: 'Israele', EG: 'Egitto',
};
function codeToFlag(code?: string): string | null {
  if (!code || code.length !== 2) return null;
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}
function codeToCountryName(code?: string): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return COUNTRY_IT[upper] ?? upper;
}

const IT_STOP = new Set(['di','da','in','con','su','per','tra','fra','del','della','dello','dei','degli','delle','al','allo','alla','agli','alle','un','una','uno','il','lo','la','i','gli','le','a','e','o','che','se','ma','non','ha','ho','nei','nelle','nel','alle','set','new','pro','con','the','for','and','with','kit']);
function extractKeywords(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .replace(/[^a-zàèéìòù0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !IT_STOP.has(w))
  );
}


// Genera immagine terminata server-side: grayscale + testo overlay (usa sharp)
async function generateTerminataImageServer(
  imageUrl: string,
  config: Record<string, any>,
): Promise<Buffer> {
  const sharpMod = await import('sharp').catch(() => null) as any;
  if (!sharpMod) throw new Error('sharp non installato — esegui: npm install sharp');
  const sharp = (sharpMod.default ?? sharpMod) as any;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let imgBuf: Buffer;
  try {
    const r = await fetch(imageUrl, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    imgBuf = Buffer.from(await r.arrayBuffer());
  } catch (e) { clearTimeout(timer); throw e; }

  const SIZE = 1024;

  // Step 1: resize + grayscale → buffer intermedio (JPEG RGB)
  let pipeline = sharp(imgBuf).resize(SIZE, SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } });
  if (config.grayscale !== false) pipeline = pipeline.grayscale();
  const step1 = await pipeline.jpeg({ quality: 95 }).toBuffer();

  // Step 2: testo overlay con canvas (supporta emoji) — fallback SVG senza emoji
  if (!config.overlayText) return step1;

  const fs  = Math.round(((Number(config.overlayTextSize) || 7) / 100) * SIZE);
  const tx  = Math.round(((Number(config.overlayTextX)    || 50) / 100) * SIZE);
  const ty  = Math.round(((Number(config.overlayTextY)    || 50) / 100) * SIZE);
  const sw  = Math.round(fs * 0.08);
  const col = String(config.overlayTextColor ?? '#ff0000');
  const rawTxt = String(config.overlayText);

  const canvasMod = await import('canvas').catch(() => null) as any;
  if (canvasMod) {
    const { createCanvas, loadImage } = canvasMod.default ?? canvasMod;
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const baseImg = await loadImage(step1);
    ctx.drawImage(baseImg, 0, 0, SIZE, SIZE);
    ctx.save();
    ctx.font = `bold ${fs}px Impact, "Noto Color Emoji", "Segoe UI Emoji", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = sw;
    ctx.lineJoin = 'round';
    ctx.strokeText(rawTxt, tx, ty);
    ctx.fillStyle = col;
    ctx.fillText(rawTxt, tx, ty);
    ctx.restore();
    return canvas.toBuffer('image/jpeg', { quality: 0.88 });
  }

  // Fallback SVG (senza emoji)
  const txt = rawTxt.replace(/[^\x00-\x7F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
  if (!txt) return step1;
  const svg = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}">` +
    `<text x="${tx}" y="${ty}" font-family="Impact,Arial Black,sans-serif"` +
    ` font-size="${fs}" font-weight="bold" fill="${col}"` +
    ` stroke="#000" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke fill"` +
    ` text-anchor="middle" dominant-baseline="middle">${txt}</text>` +
    `</svg>`,
  );
  return sharp(step1).composite([{ input: svg, blend: 'over' }]).jpeg({ quality: 88 }).toBuffer();
}

function computeScore(
  p: { discountPercent: number; reviewRating?: number; reviewCount?: number },
  w: { discount: number; rating: number; reviews: number },
): number {
  const normD = Math.min(Number(p.discountPercent) || 0, 80) / 80;
  const normR = (Number(p.reviewRating) || 0) / 5;
  const normV = Math.min(Number(p.reviewCount) || 0, 2000) / 2000;
  return (w.discount / 100) * normD + (w.rating / 100) * normR + (w.reviews / 100) * normV;
}

// Scraping stelle/recensioni dalla pagina prodotto Amazon (Creators API non supporta customerReviews)
async function scrapeAmazonRating(asin: string, domain: string): Promise<{ stelle: string; recensioni: string }> {
  const empty = { stelle: '', recensioni: '' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://${domain}/dp/${asin}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(t);
    if (!r.ok) return empty;
    const html = await r.text();
    const starM = html.match(/class="a-icon-alt">\s*([\d,.]+)\s*(?:su|out of)/i)
      ?? html.match(/"ratingValue"\s*:\s*"([\d,.]+)"/)
      ?? html.match(/(\d[,.]\d)\s*(?:su|out of)\s*5\s*stel/i);
    const stelle = starM ? starM[1].replace(',', '.') : '';
    const revM = html.match(/id="acrCustomerReviewText"[^>]*>([^<]+)/i)
      ?? html.match(/data-hook="total-review-count"[^>]*>([^<]+)/i);
    const recensioni = revM ? (revM[1].match(/[\d.,]+/)?.[0] ?? '') : '';
    console.log(`[autopost] scrape ${asin}: stelle=${stelle||'-'} rec=${recensioni||'-'}`);
    return { stelle, recensioni };
  } catch { return empty; }
}

// Genera immagine con template — prova canvas (rendering identico al browser),
// fallback su sharp+SVG se canvas non è installato.
async function generateTemplateImageServer(
  template: any,
  productImageUrl: string,
  platform: string,
  priceData: { prezzo: string; prezzoPrecedente: string; sconto: string },
  isHistoricalLow = false,
): Promise<string | null> {
  // ── Tentativo 1: node-canvas (rendering pixel-perfect) ────────────
  const canvasMod = await import('canvas').catch(() => null) as any;
  if (canvasMod) {
    try {
      const { createCanvas, loadImage, registerFont } = canvasMod;

      const impactPaths = [
        '/usr/share/fonts/truetype/msttcorefonts/Impact.ttf',
        '/usr/share/fonts/truetype/impact.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
      ];
      for (const p of impactPaths) {
        try {
          const { existsSync } = await import('fs');
          if (existsSync(p)) { registerFont(p, { family: 'Impact' }); break; }
        } catch { /* ignore */ }
      }

      const canvasW = Number(template.canvasW) || 1024;
      const canvasH = Number(template.canvasH) || 1024;
      const canvasRef = Math.min(canvasW, canvasH); // lato quadrato riferimento (come imageCompose)
      const canvas = createCanvas(canvasW, canvasH);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = template.bgColor || '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);

      async function fetchImgBufC(url: string): Promise<Buffer | null> {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
          clearTimeout(t);
          if (!r.ok) return null;
          return Buffer.from(await r.arrayBuffer());
        } catch { return null; }
      }

      if (productImageUrl?.startsWith('http')) {
        try {
          const buf = await fetchImgBufC(productImageUrl);
          if (buf) {
            const img = await loadImage(buf);
            const el = template.product ?? { x: 5, y: 5, size: 90 };
            const x = (el.x / 100) * canvasW; const y = (el.y / 100) * canvasH;
            const box = (el.size / 100) * canvasRef; // box quadrato
            const ratio = Math.min(box / img.width, box / img.height);
            const dw = img.width * ratio; const dh = img.height * ratio;
            ctx.drawImage(img, x + (box - dw) / 2, y + (box - dh) / 2, dw, dh);
          }
        } catch (e: any) { console.warn('[tpl] product:', e.message); }
      }

      if (template.overlay?.enabled && template.overlay?.src) {
        try {
          const src = String(template.overlay.src);
          const img = await loadImage(src.startsWith('http') ? (await fetchImgBufC(src) ?? src) : src);
          const el = template.overlay;
          // contain rettangolare: uguale a imageCompose e alla preview CSS objectFit:contain
          const boxX = (el.x / 100) * canvasW; const boxY = (el.y / 100) * canvasH;
          const boxW = (el.size / 100) * canvasW; const boxH = (el.size / 100) * canvasH;
          const ratio = Math.min(boxW / img.width, boxH / img.height);
          const dw = img.width * ratio; const dh = img.height * ratio;
          ctx.drawImage(img, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);
        } catch (e: any) { console.warn('[tpl] overlay:', e.message); }
      }

      const storeEl = platform === 'amazon' ? template.storeAmazon : template.storeAliexpress;
      const storeScale = platform === 'amazon' ? 1.0 : 5 / 11;
      if (storeEl?.enabled) {
        try {
          const { fileURLToPath } = await import('url');
          const { dirname, join } = await import('path');
          const __dir = dirname(fileURLToPath(import.meta.url));
          const pngPath = join(__dir, '../../public', platform === 'amazon' ? 'store-amazon.png' : 'store-aliexpress.png');
          const img = await loadImage(pngPath);
          const h = (storeEl.size / 100) * storeScale * canvasRef;
          const w = h * (img.width / img.height);
          ctx.drawImage(img, (storeEl.x / 100) * canvasW, (storeEl.y / 100) * canvasH, w, h);
        } catch (e: any) { console.warn('[tpl] store:', e.message); }
      }

      const drawTextEl = (el: any, text: string, debugName?: string) => {
        if (!el?.enabled || !text?.trim()) return;
        const fs = (Number(el.fontSize) || 36) * 2;
        const x = (el.x / 100) * canvasW; const y = (el.y / 100) * canvasH;
        const anchor = el.textAnchor === 'right' ? 'right' : el.textAnchor === 'center' ? 'center' : 'left';
        if (debugName) console.log(`[tpl] ${debugName}: color=${JSON.stringify(el.color)} strikethroughColor=${JSON.stringify(el.strikethroughColor)} strokeColor=${JSON.stringify(el.strokeColor)} strikethrough=${el.strikethrough}`);
        ctx.save();
        ctx.font = `${el.bold ? 'bold ' : ''}${fs}px ${el.fontFamily || 'Impact'}, sans-serif`;
        ctx.textBaseline = 'top'; ctx.textAlign = anchor as CanvasTextAlign;
        if (el.strokeEnabled && el.strokeWidth > 0) {
          ctx.strokeStyle = el.strokeColor || '#000';
          ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round';
          ctx.strokeText(text, x, y);
        }
        ctx.fillStyle = el.color || '#fff'; ctx.fillText(text, x, y);
        if (el.strikethrough) {
          const tw = ctx.measureText(text).width;
          const sx = anchor === 'right' ? x - tw : anchor === 'center' ? x - tw / 2 : x;
          const strkColor = el.strikethroughColor || el.color || '#fff';
          if (debugName) console.log(`[tpl] ${debugName} strikethrough: usando colore=${JSON.stringify(strkColor)}`);
          ctx.strokeStyle = strkColor;
          ctx.lineWidth = Math.max(1, fs * 0.06);
          ctx.beginPath(); ctx.moveTo(sx, y + fs * 0.55); ctx.lineTo(sx + tw, y + fs * 0.55); ctx.stroke();
        }
        ctx.restore();
      };

      drawTextEl(template.prezzo, priceData.prezzo, 'prezzo');
      drawTextEl(template.prezzoPrecedente, priceData.prezzoPrecedente, 'prezzoPrecedente');
      drawTextEl(template.sconto, priceData.sconto, 'sconto');
      drawTextEl(template.testoCustom, template.testoCustom?.text ?? '');

      if (isHistoricalLow && template.badge?.enabled && template.badge?.src) {
        try {
          const src = String(template.badge.src);
          const badgeBuf = src.startsWith('http') ? (await fetchImgBufC(src) ?? null) : null;
          const badgeImg = await loadImage(badgeBuf ?? src);
          const el = template.badge;
          const w = ((el.size ?? 30) / 100) * canvasRef;
          const h = (badgeImg.height / badgeImg.width) * w;
          ctx.drawImage(badgeImg, ((el.x ?? 0) / 100) * canvasW, ((el.y ?? 0) / 100) * canvasH, w, h);
        } catch (e: any) { console.warn('[tpl] hl-badge:', e.message); }
      }

      const buf = canvas.toBuffer('image/jpeg', { quality: 0.88 });
      console.log('[tpl] canvas ok');
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (e: any) {
      console.warn('[tpl] canvas fallback su sharp:', e.message);
    }
  }

  // ── Fallback: sharp + SVG text ─────────────────────────────────────
  try {
    const sharpMod = await import('sharp').catch(() => null) as any;
    if (!sharpMod) { console.warn('[tpl] né canvas né sharp disponibili'); return null; }
    const sharp = (sharpMod.default ?? sharpMod) as any;

    const sW = Number(template.canvasW) || 1024;
    const sH = Number(template.canvasH) || 1024;
    const sRef = Math.min(sW, sH); // lato quadrato riferimento
    const bgHex = String(template.bgColor || '#ffffff').replace('#', '').padEnd(6, 'f');
    const bgR = parseInt(bgHex.slice(0, 2), 16) || 255;
    const bgG = parseInt(bgHex.slice(2, 4), 16) || 255;
    const bgB = parseInt(bgHex.slice(4, 6), 16) || 255;

    async function fetchImgBuf(url: string): Promise<Buffer | null> {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
        clearTimeout(t);
        if (!r.ok) return null;
        return Buffer.from(await r.arrayBuffer());
      } catch { return null; }
    }

    async function bufFromSrc(src: string): Promise<Buffer | null> {
      if (src.startsWith('data:')) { const b64 = src.split(',')[1]; return b64 ? Buffer.from(b64, 'base64') : null; }
      if (src.startsWith('http')) return fetchImgBuf(src);
      return null;
    }

    const composites: any[] = [];

    if (productImageUrl?.startsWith('http')) {
      try {
        const buf = await fetchImgBuf(productImageUrl);
        if (buf) {
          const el = template.product ?? { x: 5, y: 5, size: 90 };
          const box = Math.round((el.size / 100) * sRef); // box quadrato
          const elLeft = Math.round((el.x / 100) * sW); const elTop = Math.round((el.y / 100) * sH);
          const { data, info } = await sharp(buf).resize(box, box, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
          composites.push({ input: data, left: elLeft + Math.round((box - info.width) / 2), top: elTop + Math.round((box - info.height) / 2) });
        }
      } catch (e: any) { console.warn('[tpl] product:', e.message); }
    }

    if (template.overlay?.enabled && template.overlay?.src) {
      try {
        const buf = await bufFromSrc(String(template.overlay.src));
        if (buf) {
          const el = template.overlay;
          // contain rettangolare: box width×height proporzionato al canvas
          const boxW = Math.round((el.size / 100) * sW); const boxH = Math.round((el.size / 100) * sH);
          const resized = await sharp(buf).resize(boxW, boxH, { fit: 'inside' }).png().toBuffer();
          composites.push({ input: resized, left: Math.round((el.x / 100) * sW), top: Math.round((el.y / 100) * sH) });
        }
      } catch (e: any) { console.warn('[tpl] overlay:', e.message); }
    }

    const storeElS = platform === 'amazon' ? template.storeAmazon : template.storeAliexpress;
    const storeScaleS = platform === 'amazon' ? 1.0 : 5 / 11;
    if (storeElS?.enabled) {
      try {
        const { fileURLToPath } = await import('url'); const { dirname, join } = await import('path'); const { promises: fs } = await import('fs');
        const __dir = dirname(fileURLToPath(import.meta.url));
        const pngPath = join(__dir, '../../public', platform === 'amazon' ? 'store-amazon.png' : 'store-aliexpress.png');
        const storeBuf = await fs.readFile(pngPath); const meta = await sharp(storeBuf).metadata();
        const h = Math.round((storeElS.size / 100) * storeScaleS * sRef);
        const w = Math.round(h * ((meta.width ?? 1) / (meta.height ?? 1)));
        composites.push({ input: await sharp(storeBuf).resize(w, h).toBuffer(), left: Math.round((storeElS.x / 100) * sW), top: Math.round((storeElS.y / 100) * sH) });
      } catch (e: any) { console.warn('[tpl] store:', e.message); }
    }

    const svgEls: string[] = [];
    function textElToSvg(el: any, text: string) {
      if (!el?.enabled || !text?.trim()) return;
      const fs = (Number(el.fontSize) || 36) * 2;
      const xTop = Math.round((el.x / 100) * sW);
      const yTop = Math.round((el.y / 100) * sH);
      // librsvg usa baseline alfabetico: sposta y in giù di ~0.80*fs per allineare il bordo superiore a yTop
      const y = yTop + Math.round(fs * 0.80);
      const anchor = el.textAnchor === 'right' ? 'end' : el.textAnchor === 'center' ? 'middle' : 'start';
      const family = String(el.fontFamily || 'Impact').replace(/"/g, '');
      const fill = String(el.color || '#ffffff');
      const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const common = `x="${xTop}" y="${y}" font-family="${family}, Impact, Arial Black, sans-serif" font-size="${fs}" font-weight="${el.bold ? 'bold' : 'normal'}" text-anchor="${anchor}"`;
      if (el.strokeEnabled && Number(el.strokeWidth) > 0) {
        svgEls.push(`<text ${common} stroke="${el.strokeColor || '#000'}" stroke-width="${Number(el.strokeWidth) * 2}" stroke-linejoin="round" paint-order="stroke" fill="${fill}">${safe}</text>`);
      } else {
        svgEls.push(`<text ${common} fill="${fill}">${safe}</text>`);
      }
      // Barrato come linea SVG separata con colore esplicito (text-decoration ignora il fill in librsvg)
      if (el.strikethrough) {
        const strkColor = String(el.strikethroughColor || el.color || '#ffffff');
        // Stima larghezza testo: ~0.55*fs per carattere (approssimazione conservativa)
        const approxWidth = Math.round(text.length * fs * 0.55);
        const lx = anchor === 'end' ? xTop - approxWidth : anchor === 'middle' ? xTop - approxWidth / 2 : xTop;
        // Posizione verticale della barra: ~0.35*fs sopra la baseline = yTop + 0.45*fs
        const ly = yTop + Math.round(fs * 0.45);
        const lw = Math.max(1, Math.round(fs * 0.06));
        svgEls.push(`<line x1="${lx}" y1="${ly}" x2="${lx + approxWidth}" y2="${ly}" stroke="${strkColor}" stroke-width="${lw}" stroke-linecap="round"/>`);
      }
    }
    textElToSvg(template.prezzo, priceData.prezzo);
    textElToSvg(template.prezzoPrecedente, priceData.prezzoPrecedente);
    textElToSvg(template.sconto, priceData.sconto);
    textElToSvg(template.testoCustom, template.testoCustom?.text ?? '');
    if (svgEls.length > 0) composites.push({ input: Buffer.from(`<svg width="${sW}" height="${sH}" xmlns="http://www.w3.org/2000/svg">${svgEls.join('')}</svg>`) });

    if (isHistoricalLow && template.badge?.enabled && template.badge?.src) {
      try {
        const buf = await bufFromSrc(String(template.badge.src));
        if (buf) {
          const el = template.badge; const meta = await sharp(buf).metadata();
          const w = Math.round(((el.size ?? 30) / 100) * sRef); const h = Math.round(w * ((meta.height ?? 1) / (meta.width ?? 1)));
          composites.push({ input: await sharp(buf).resize(w, h).png().toBuffer(), left: Math.round(((el.x ?? 0) / 100) * sW), top: Math.round(((el.y ?? 0) / 100) * sH) });
        }
      } catch (e: any) { console.warn('[tpl] hl-badge:', e.message); }
    }

    const result = await sharp({
      create: { width: sW, height: sH, channels: 3, background: { r: bgR, g: bgG, b: bgB } },
    })
      .composite(composites)
      .jpeg({ quality: 88 })
      .toBuffer();

    return `data:image/jpeg;base64,${result.toString('base64')}`;
  } catch (e: any) {
    console.warn('[tpl] generate failed:', e.message);
    return null;
  }
}

// Genera immagine composita (griglia) per post multipli lato server — replica la logica
// di generateMultiPostImage (imageCompose.ts) usando sharp invece di canvas browser.
async function generateMultiImageServer(imageUrls: string[]): Promise<string | null> {
  const n = imageUrls.filter(Boolean).length;
  if (n === 0) return null;
  try {
    const sharpMod = await import('sharp').catch(() => null) as any;
    if (!sharpMod) return null;
    const sharp = (sharpMod.default ?? sharpMod) as any;

    const cols = n <= 3 ? n : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const cellSize = Math.round(1024 / cols);
    const canvasW = cellSize * cols;
    const canvasH = cellSize * rows;
    const PAD = 4;

    async function fetchBuf(url: string): Promise<Buffer | null> {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
        clearTimeout(t);
        if (!r.ok) return null;
        return Buffer.from(await r.arrayBuffer());
      } catch { return null; }
    }

    const base = await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    const composites: any[] = [];
    const validUrls = imageUrls.filter(Boolean);

    for (let i = 0; i < validUrls.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const itemsInRow = Math.min(cols, validUrls.length - row * cols);
      const rowOffsetX = Math.floor(((cols - itemsInRow) * cellSize) / 2);
      const cellX = rowOffsetX + col * cellSize;
      const cellY = row * cellSize;
      const buf = await fetchBuf(validUrls[i]);
      if (!buf) continue;
      const availW = cellSize - PAD * 2;
      const availH = cellSize - PAD * 2;
      const { data, info } = await sharp(buf).resize(availW, availH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
      const left = cellX + PAD + Math.round((availW - info.width) / 2);
      const top  = cellY + PAD + Math.round((availH - info.height) / 2);
      composites.push({ input: data, left, top });
    }

    const result = await sharp(base).composite(composites).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${result.toString('base64')}`;
  } catch (e: any) {
    console.warn('[multiImg] errore composita:', e.message);
    return null;
  }
}

function safeCaption(html: string, maxLen: number): string {
  if (html.length <= maxLen) return html;
  const stack: string[] = [];
  const voidTags = new Set(['br', 'hr', 'img']);
  let i = 0, visLen = 0, out = '';
  while (i < html.length && visLen < maxLen) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) break;
      const inner = html.slice(i + 1, end).trim();
      const isClose = inner.startsWith('/');
      const tagName = (isClose ? inner.slice(1) : inner.split(/[\s/]/)[0]).toLowerCase();
      if (isClose) {
        const idx = stack.lastIndexOf(tagName);
        if (idx !== -1) stack.splice(idx, 1);
      } else if (!voidTags.has(tagName) && !inner.endsWith('/')) {
        stack.push(tagName);
      }
      out += html.slice(i, end + 1);
      i = end + 1;
    } else {
      out += html[i];
      visLen++;
      i++;
    }
  }
  for (let j = stack.length - 1; j >= 0; j--) out += `</${stack[j]}>`;
  return out.trimEnd() + (html.length > maxLen ? '…' : '');
}

function buildMessage(
  contenuto: string,
  post: Record<string, any>,
  affiliateUrl: string,
  currency?: string,
  customTags: Record<string, string> = {},
): string {
  const now = new Date();
  const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const pad = (n: number) => n < 10 ? `0${n}` : String(n);
  const valuta = currency ?? (post.platform === 'aliexpress' ? '$' : '€');
  const discPrice = Number(post.discountedPrice).toFixed(2);
  const origPrice = Number(post.originalPrice).toFixed(2);
  const disc = Number(post.discountPercent);
  const titleShort = (post.title || '').length > 60 ? (post.title || '').slice(0, 57) + '...' : (post.title || '');

  const tags: Record<string, string> = {
    // Tag personalizzati dal DB — le assegnazioni esplicite sotto hanno priorità
    ...customTags,
    // Assegnazioni esplicite: sovrascrivono sempre i tag del DB
    '{titolo}':          esc(post.title),
    '{titoloup}':        esc((post.title || '').toUpperCase()),
    '{titoloshort}':     esc(titleShort),
    '{prezzo}':          discPrice,
    '{prezzo_scontato}': discPrice,
    '{oldprezzo}':       origPrice,
    '{sconto}':          String(disc),
    '{perc}':            `-${disc}%`,
    '{valuta}':          valuta,
    '{link_affiliato}':  affiliateUrl,
    '{link}':            affiliateUrl,
    '{minimo_storico}':  post.isHistoricalLow ? (customTags['{minimo_storico}'] || '🏆 MINIMO STORICO!') : '',
    '{custom}':          esc(post.customText || ''),
    '{store}':           post.platform === 'amazon' ? 'Amazon' : 'AliExpress',
    '{storeup}':         post.platform === 'amazon' ? 'AMAZON' : 'ALIEXPRESS',
    '{countryflag}':     codeToFlag(post.shipFromCountry) ?? (post.platform === 'aliexpress' ? '' : '🇮🇹'),
    '{country}':         codeToCountryName(post.shipFromCountry) ?? (post.platform === 'aliexpress' ? '' : 'Italia'),
    '{countryup}':       (codeToCountryName(post.shipFromCountry) ?? (post.platform === 'aliexpress' ? '' : 'Italia')).toUpperCase(),
    '{giorno}':          giorni[now.getDay()],
    '{ora}':             `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    '{data}':            `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    '{stelle}':          post.stelle || '',
    '{recensioni}':      post.recensioni || '',
    '{cat}':             post.cat || '',
    '{author}':          esc(post.author || ''),
    '{coupon}':          post.coupon || '',
    '{boxcoupon}':       post.boxcoupon || '',
  };

  const tagOverrides = (post.tagOverrides ?? {}) as Record<string, string>;
  for (const [tagName, val] of Object.entries(tagOverrides)) {
    if (!(tagName in tags)) tags[tagName] = val || '';
  }

  const SENTINEL = '\x01';
  const knownTagNames = new Set(Object.keys(tags));

  let t = contenuto;
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(/\{_((?:(?!\{_)[\s\S])*?)_\}/g, (_, inner) => {
      let hasEmpty = false;
      let resolved = inner;
      for (const [tag, val] of Object.entries(tags)) {
        if (inner.includes(tag)) {
          if (!val || val.trim() === '') hasEmpty = true;
          resolved = resolved.split(tag).join(val);
        }
      }
      const found = inner.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [];
      for (const tn of found) {
        if (!knownTagNames.has(tn)) { hasEmpty = true; break; }
      }
      return hasEmpty ? SENTINEL : resolved;
    });
  }

  for (const [tag, val] of Object.entries(tags)) {
    t = t.split(tag).join(val);
  }
  // Tag {emoji_...} non risolti (emoji non salvata nel DB) → rimuovi silenziosamente
  t = t.replace(/\{emoji_[a-zA-Z0-9_]+\}/g, '');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  t = t.split('\n').filter(line => {
    if (!line.includes(SENTINEL)) return true;
    return line.replace(/\x01/g, '').trim() !== '';
  }).map(line => line.replace(/\x01/g, '')).join('\n');

  return t;
}

function buildKeyboard(
  contenuto: string | undefined,
  post: Record<string, any>,
  affiliateUrl: string,
): object | undefined {
  if (!contenuto?.trim()) return undefined;

  const waText = encodeURIComponent(`${post.title ?? ''}\n${affiliateUrl}`);
  const urlTags: Record<string, string> = {
    '{link}':            affiliateUrl,
    '{link_affiliato}':  affiliateUrl,
    '{whatsapp}':        `https://api.whatsapp.com/send?text=${waText}`,
    '{app}':             affiliateUrl,
    '{amici}':           affiliateUrl,
    '{grafico}':         affiliateUrl,
  };

  const COLOR_MAP: Record<string, string> = { g: 'success', r: 'danger', b: 'primary' };

  const rows = contenuto.trim().split('\n').filter(r => r.trim());
  const keyboard = rows.map(row => {
    const btns = row.split('&&').map(b => b.trim()).filter(Boolean);
    return btns.map(btn => {
      const colorMatch = btn.match(/^#([grb])\s+/);
      const style = colorMatch ? COLOR_MAP[colorMatch[1]] : undefined;
      const clean = colorMatch ? btn.slice(colorMatch[0].length) : btn;
      const lastDash = clean.lastIndexOf(' - ');
      if (lastDash === -1) return null;
      const text = clean.slice(0, lastDash).trim();
      let url = clean.slice(lastDash + 3).trim();
      for (const [tag, val] of Object.entries(urlTags)) {
        url = url.split(tag).join(val);
      }
      if (!text) return null;
      if (url === '{poll}' || url.includes('{poll}')) {
        return { text, callback_data: 'poll_' + Math.random().toString(36).slice(2, 6), ...(style ? { style } : {}) };
      }
      if (!url) return null;
      return { text, url, ...(style ? { style } : {}) };
    }).filter(Boolean);
  }).filter(r => r.length > 0);

  if (!keyboard.length) return undefined;
  return { inline_keyboard: keyboard };
}

// Converte "HH:MM" in minuti dalla mezzanotte
function timeToMin(t: string): number {
  const [h, m] = (t ?? '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Ora corrente in minuti (fuso Europe/Rome)
function nowMinutesRome(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: 'numeric', hour12: false, timeZone: 'Europe/Rome',
  }).formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return h * 60 + m;
}

let migrationDone = false;

// Lock in-memory per userId: evita doppia pubblicazione quando due cron run si sovrappongono
const publishingUsers = new Set<string>();

// Legge config template dal DB e applica la migration store→storeAmazon/storeAliexpress
function parseTemplateCfg(row: any): Record<string, any> | null {
  if (!row) return null;
  const raw = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config ?? {});
  const cfg: Record<string, any> = { id: row.id, ...raw };
  if (cfg.store && !cfg.storeAmazon) {
    cfg.storeAmazon = cfg.store;
    cfg.storeAliexpress = cfg.store;
  }
  return cfg;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  // Vercel invia CRON_SECRET come Bearer token nell'header Authorization
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }

  if (!migrationDone) {
    await sql`ALTER TABLE autopost_queue ADD COLUMN IF NOT EXISTS silenzioso boolean`.catch(() => {});
    await sql`
      CREATE TABLE IF NOT EXISTS price_history (
        id        BIGSERIAL PRIMARY KEY,
        product_id TEXT NOT NULL,
        platform   TEXT NOT NULL,
        price      NUMERIC(10,2) NOT NULL,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(() => {});
    await sql`CREATE INDEX IF NOT EXISTS price_history_lookup ON price_history (product_id, platform)`.catch(() => {});
    await sql`ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ`.catch(() => {});
    await sql`ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS terminata BOOLEAN DEFAULT false`.catch(() => {});
    await sql`ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS is_multi BOOLEAN DEFAULT false`.catch(() => {});
    await sql`ALTER TABLE autopost_queue ADD COLUMN IF NOT EXISTS auto BOOLEAN DEFAULT false`.catch(() => {});
    // Pulizia storico prezzi oltre 180 giorni (fire-and-forget)
    sql`DELETE FROM price_history WHERE recorded_at < now() - interval '180 days'`.catch(() => {});
    migrationDone = true;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) { res.json({ ok: true, note: 'TELEGRAM_BOT_TOKEN non configurato' }); return; }
  const tgBase = `https://api.telegram.org/bot${botToken}`;

  // Ogni processo gestisce solo i propri utenti: dev (_dev) non pubblica per stable e viceversa
  const userSuffix = process.env.USER_SUFFIX || '';
  const allSettingsRows = await sql`SELECT user_id, data FROM settings WHERE user_id IS NOT NULL`;
  const settingsRows = (allSettingsRows as any[]).filter(row => {
    const uid = String(row.user_id);
    return userSuffix ? uid.endsWith(userSuffix) : !uid.includes('_');
  });

  const published: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const row of settingsRows) {
    const userId = row.user_id as string;
    const rawData = row.data ?? {};
    const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

    // AutoPost disabilitato
    if (!cfg.attivo) { skipped.push(`${userId}: disabled`); continue; }

    // Lock per-userId: evita doppia pubblicazione se due run cron si sovrappongono
    if (publishingUsers.has(userId)) { skipped.push(`${userId}: run già in corso`); continue; }
    publishingUsers.add(userId);
    try {

    const oraI   = cfg.oraI   ?? '08:00';
    const oraF   = cfg.oraF   ?? '22:00';
    const interv = Math.max(1, Number(cfg.interv ?? 60));
    const channelOverride = process.env.CHANNEL_OVERRIDE || '';
    const channels: string[] = channelOverride
      ? [channelOverride]
      : Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];

    if (!channels.length) { skipped.push(`${userId}: no channels`); continue; }

    // Controlla finestra oraria (fuso Europe/Rome)
    const currentMin = nowMinutesRome();
    if (currentMin < timeToMin(oraI) || currentMin >= timeToMin(oraF)) {
      skipped.push(`${userId}: fuori finestra ${oraI}-${oraF}`); continue;
    }

    // Controlla intervallo: quanti minuti dall'ultimo post pubblicato?
    const [lastPub] = await sql`
      SELECT published_at FROM published_posts
      WHERE user_id = ${userId}
      ORDER BY published_at DESC LIMIT 1
    `;

    if (lastPub?.published_at) {
      const minSinceLast = (Date.now() - new Date(lastPub.published_at as string).getTime()) / 60000;
      if (minSinceLast < interv - 0.5) {
        skipped.push(`${userId}: troppo presto (${minSinceLast.toFixed(1)}/${interv}min)`); continue;
      }
    }

    // Allinea l'orario ai multipli dell'intervallo (es. ogni 5 min → 11:50, 11:55, 12:00)
    // Pubblica solo se siamo entro i primi 60s della "finestra" multipla dell'intervallo
    if (interv > 1) {
      const nowRome = nowMinutesRome();
      const minuteInCycle = (nowRome - timeToMin(oraI) + 1440) % interv;
      if (minuteInCycle > 0) {
        skipped.push(`${userId}: attendo finestra (${minuteInCycle}/${interv}min)`); continue;
      }
    }

    // Scorre la coda finché trova un post con prezzo ancora valido (max 5 tentativi)
    let queueItem: Record<string, any> | null = null;
    let post: Record<string, any> | null = null;
    let postsArr: Record<string, any>[] = [];
    let isMulti = false;
    const triedIds: string[] = [];

    for (let attempt = 0; attempt < 5; attempt++) {
      const excludeClause = triedIds.length
        ? sql`AND id NOT IN (${sql(triedIds)})`
        : sql``;

      const [candidate] = await sql`
        SELECT id, posts, silenzioso FROM autopost_queue
        WHERE user_id = ${userId} AND status = 'draft' ${excludeClause}
        ORDER BY created_at ASC LIMIT 1
      `;
      if (!candidate) break;

      postsArr = typeof candidate.posts === 'string' ? JSON.parse(candidate.posts) : candidate.posts;
      const candidatePost = Array.isArray(postsArr) ? postsArr[0] : null;
      if (!candidatePost) {
        await sql`DELETE FROM autopost_queue WHERE id = ${candidate.id}`.catch(() => {});
        triedIds.push(candidate.id as string);
        continue;
      }
      isMulti = Array.isArray(postsArr) && postsArr.length > 1;

      // Salta se il post è già stato terminato manualmente
      if (!isMulti && candidatePost.id) {
        const [alreadyTerm] = await sql`
          SELECT 1 FROM published_posts
          WHERE id = ${candidatePost.id} AND user_id = ${userId} AND terminata = true
        `.catch(() => [null]);
        if (alreadyTerm) {
          console.log(`[autopost] skip terminata in coda: ${String(candidatePost.title ?? '').slice(0, 40)}`);
          await sql`DELETE FROM autopost_queue WHERE id = ${candidate.id}`.catch(() => {});
          triedIds.push(candidate.id as string);
          continue;
        }
      }

      // Verifica prezzo prima di bloccare l'item (solo per post singoli)
      if (!isMulti) {
        const priceCheck = await checkPostPrice(candidatePost, cfg);
        if (!priceCheck.valid) {
          console.log(`[autopost] prezzo scaduto userId=${userId} postId=${candidatePost.id}: ${priceCheck.reason}`);
          await sql`DELETE FROM autopost_queue WHERE id = ${candidate.id}`.catch(() => {});
          skipped.push(`${userId}: offerta scaduta — ${String(candidatePost.title ?? '').slice(0, 40)} (${priceCheck.reason})`);
          triedIds.push(candidate.id as string);
          continue;
        }
      }

      // Blocca atomicamente — evita doppia pubblicazione in caso di cron sovrapposti
      const updated = await sql`
        UPDATE autopost_queue SET status = 'published'
        WHERE id = ${candidate.id} AND user_id = ${userId} AND status = 'draft'
        RETURNING id
      `;
      if (!updated.length) { triedIds.push(candidate.id as string); continue; }

      queueItem = candidate;
      post = candidatePost;
      break;
    }

    // ── Auto-search AliExpress quando coda è vuota ────────────────────────────
    if (!queueItem && cfg.dealSearch?.autoPublishAliexpress) {
      const ds     = cfg.dealSearch?.ali ?? {};
      const appKey = cfg.aliexpress?.appKey     || process.env.ALIEXPRESS_APP_KEY     || '';
      const appSec = cfg.aliexpress?.appSecret  || process.env.ALIEXPRESS_APP_SECRET  || '';
      const trackId = cfg.aliexpress?.trackingId || process.env.ALIEXPRESS_TRACKING_ID || '';
      const country = (cfg.aliexpress?.targetCountry || 'IT').toUpperCase();
      const { currency, language } = ALI_COUNTRY_MAP[country] ?? { currency: 'EUR', language: 'IT' };

      // Richiede almeno parole chiave o categoria: senza filtri si pubblicherebbe spazzatura generica
      const hasSearchCriteria = !!(ds.keywords?.trim() || ds.categoryIds?.trim());
      if (!hasSearchCriteria) {
        console.log(`[autopost] auto-search saltato userId=${userId}: configura parole chiave o categoria in Cerca Offerte → Salva filtri`);
      }

      if (appKey && appSec && hasSearchCriteria) {
        const extra: Record<string, string> = {
          tracking_id: trackId, target_currency: currency, target_language: language,
          ship_to_country: country, sort: ds.sort || 'DEFAULT_SORT',
          page_size: '20', page_no: '1',
          fields: 'product_id,product_title,product_main_image_url,target_sale_price,target_original_price,target_sale_price_currency,discount,promotion_link,product_country',
        };
        if (ds.keywords)                      extra.keywords       = ds.keywords;
        if (Number(ds.minPrice)  > 0)         extra.min_sale_price = String(Math.round(Number(ds.minPrice) * 100));
        if (Number(ds.maxPrice)  > 0)         extra.max_sale_price = String(Math.round(Number(ds.maxPrice) * 100));
        if (Number(ds.deliveryDays) > 0)      extra.delivery_days  = String(ds.deliveryDays);
        if (ds.categoryIds)                   extra.category_ids   = ds.categoryIds;

        const products = await aliAutoQuery(appKey, appSec, extra);
        const minDisc  = Number(ds.minDiscount ?? 0);

        // Filtra già pubblicati nelle ultime 24h
        const recentRows = await sql`
          SELECT source_url FROM published_posts
          WHERE user_id = ${userId} AND published_at > now() - interval '24 hours'
        `;
        const publishedUrls = new Set(recentRows.map((r: any) => String(r.source_url)));

        const candidate = products.find((p: any) => {
          const disc = parseInt(String(p.discount ?? '0').replace('%', '')) || 0;
          if (disc < minDisc) return false;
          const url = p.promotion_link || `https://www.aliexpress.com/item/${p.product_id}.html`;
          return !publishedUrls.has(url);
        });

        if (candidate) {
          const discPct   = parseInt(String(candidate.discount ?? '0').replace('%', '')) || 0;
          const salePrice = parseFloat(candidate.target_sale_price ?? '0') || 0;
          const origPrice = parseFloat(candidate.target_original_price ?? '0') || salePrice;
          const affUrl    = candidate.promotion_link || `https://www.aliexpress.com/item/${candidate.product_id}.html`;
          const aliCurrSym2 = ALI_CURRENCY_SYM[country] ?? '€';

          // Carica template e layout utente (come per Amazon)
          const aliTplRow = await sql`SELECT id, config FROM templates WHERE user_id = ${userId} AND tipo NOT IN ('historical_low') ORDER BY (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1`;
          const aliTemplateId = aliTplRow[0]?.id ?? 'tpl1';
          const aliTemplateCfg = parseTemplateCfg(aliTplRow[0]);
          const aliLayoutRows = await sql`SELECT id FROM layouts WHERE user_id = ${userId} AND tipo IN ('aliexpress', 'normal') ORDER BY tipo = 'aliexpress' DESC, created_at ASC LIMIT 1`;
          const aliLayoutId = aliLayoutRows[0]?.id ?? '';

          post = {
            id: crypto.randomUUID(), platform: 'aliexpress',
            sourceUrl: affUrl, productId: String(candidate.product_id),
            title: candidate.product_title ?? '',
            image: candidate.product_main_image_url ?? '',
            originalPrice: origPrice, discountedPrice: salePrice,
            discountPercent: discPct,
            customText: '', isHistoricalLow: false,
            templateId: aliTemplateId, layoutId: aliLayoutId, keyboardId: '', emoji: '🔴',
            shipFromCountry: String(candidate.product_country || '').toUpperCase() || undefined,
          };

          const _aliAutoId = crypto.randomUUID();
          await sql`INSERT INTO autopost_queue (id, user_id, posts, status, auto) VALUES (${_aliAutoId}, ${userId}, ${sql.json([post])}, 'draft', true)`.catch(e => console.warn('[autopost] ali auto-queue insert:', e.message));
          console.log(`[autopost] auto-search in coda (draft): ${post.title?.slice(0, 50)}`);
          continue;
        } else {
          console.log(`[autopost] auto-search: nessun prodotto nuovo trovato per userId=${userId}`);
        }
      }
    }

    // ── Auto-publish Amazon dal pool deals_cache ─────────────────────────────
    if (!queueItem && cfg.dealSearch?.autoPublishAmazon) {
      const dsAmz       = cfg.dealSearch?.amazon ?? {};
      const minDisc     = Number(dsAmz.minDiscount ?? 0);
      const maxDisc     = Number(dsAmz.maxDiscount ?? 0);
      const searchIdxs  = (dsAmz.searchIndexes ?? '').trim()
        ? (dsAmz.searchIndexes as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const sortMode    = cfg.dealSearch?.autoPublishSort ?? 'discount';
      const wDiscount   = Number(cfg.dealSearch?.scoreWeightDiscount ?? 50);
      const wRating     = Number(cfg.dealSearch?.scoreWeightRating   ?? 30);
      const wReviews    = Number(cfg.dealSearch?.scoreWeightReviews  ?? 20);
      const noDupeCat   = cfg.dealSearch?.noDupeCategory ?? false;

      // Categoria dell'ultimo post pubblicato (per evitare consecutivi)
      let lastCategory = '';
      if (noDupeCat) {
        const [lastPubAmz] = await sql`
          SELECT category FROM published_posts
          WHERE user_id = ${userId} AND platform = 'amazon'
          ORDER BY published_at DESC LIMIT 1
        `.catch(() => []);
        lastCategory = String(lastPubAmz?.category ?? '');
      }

      // Escludi prodotti già pubblicati nelle ultime 48h + tutti i terminati
      const recentAmz = await sql`
        SELECT product_id FROM published_posts
        WHERE user_id = ${userId} AND platform = 'amazon'
          AND (published_at > now() - interval '48 hours' OR COALESCE(terminata, false) = true)
      `.catch(() => []);
      const recentAmzIds = new Set(recentAmz.map((r: any) => String(r.product_id)));

      // Titoli recenti per diversificazione keyword
      const recentTitlesAmz = await sql`
        SELECT title FROM published_posts
        WHERE user_id = ${userId} AND platform = 'amazon'
        ORDER BY published_at DESC LIMIT 5
      `.catch(() => []);
      const recentKwSets = recentTitlesAmz.map((r: any) => extractKeywords(String(r.title ?? '')));

      // Verifica se è ora di pubblicare un multi-post automatico
      const autoMultiEvery = Number(cfg.dealSearch?.autoMultiEvery ?? 0);
      let shouldPublishMulti = false;
      if (autoMultiEvery > 0) {
        const [sinceMultiRow] = await sql`
          SELECT COUNT(*)::int AS cnt FROM published_posts
          WHERE user_id = ${userId} AND platform = 'amazon'
            AND NOT COALESCE(is_multi, false)
            AND published_at > COALESCE(
              (SELECT MAX(published_at) FROM published_posts
               WHERE user_id = ${userId} AND platform = 'amazon' AND COALESCE(is_multi, false) = true),
              now() - interval '30 days'
            )
        `.catch(() => [{ cnt: 0 }]);
        shouldPublishMulti = Number(sinceMultiRow?.cnt ?? 0) >= autoMultiEvery;
      }

      const cacheRows = await sql`
        SELECT product_id, title, image, original_price::float, discounted_price::float,
               discount_percent, currency, category, search_index, url, affiliate_url,
               COALESCE(rating, 0)::float AS review_rating,
               COALESCE(review_count, 0) AS review_count
        FROM deals_cache
        WHERE user_id = ${userId} AND platform = 'amazon'
          AND (${minDisc} = 0 OR discount_percent >= ${minDisc})
          AND (${maxDisc} = 0 OR discount_percent <= ${maxDisc})
        LIMIT 500
      `;

      // Filtra: già pubblicati, categoria (fix null), no dupe cat, keyword diversity
      let candidates = cacheRows.filter((r: any) => {
        if (recentAmzIds.has(String(r.product_id))) return false;
        if (searchIdxs.length > 0 && !searchIdxs.includes(String(r.search_index ?? ''))) return false;
        if (noDupeCat && lastCategory && String(r.category) === lastCategory) return false;
        const candKws = extractKeywords(String(r.title ?? ''));
        if (recentKwSets.some(kws => [...candKws].filter(w => kws.has(w)).length >= 2)) return false;
        return true;
      });

      // Ordina per score o per sconto
      if (sortMode === 'score') {
        candidates = candidates.sort((a: any, b: any) =>
          computeScore(
            { discountPercent: b.discount_percent, reviewRating: b.review_rating, reviewCount: b.review_count },
            { discount: wDiscount, rating: wRating, reviews: wReviews },
          ) -
          computeScore(
            { discountPercent: a.discount_percent, reviewRating: a.review_rating, reviewCount: a.review_count },
            { discount: wDiscount, rating: wRating, reviews: wReviews },
          )
        );
      } else {
        candidates = candidates.sort((a: any, b: any) => b.discount_percent - a.discount_percent);
      }

      // ── Auto multi-post: raggruppa per keyword simile ──────────────────────
      if (shouldPublishMulti && candidates.length >= 2) {
        const multiSize = Math.min(6, candidates.length);
        const kwMap = new Map<string, any[]>();
        for (const cand of candidates) {
          for (const kw of extractKeywords(String(cand.title ?? ''))) {
            if (!kwMap.has(kw)) kwMap.set(kw, []);
            kwMap.get(kw)!.push(cand);
          }
        }
        let multiCandidates: any[] = [];
        for (const cluster of kwMap.values()) {
          if (cluster.length > multiCandidates.length) multiCandidates = cluster;
        }
        if (multiCandidates.length < 2) multiCandidates = candidates;
        multiCandidates = multiCandidates.slice(0, multiSize);

        const mTplRow = await sql`SELECT id, config FROM templates WHERE user_id = ${userId} AND tipo NOT IN ('historical_low') ORDER BY (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1`;
        const mTemplateId = mTplRow[0]?.id ?? 'tpl1';
        const mTemplateCfg = parseTemplateCfg(mTplRow[0]);
        const mLayoutRows = await sql`SELECT id FROM layouts WHERE user_id = ${userId} AND tipo = 'multi' ORDER BY created_at ASC LIMIT 1`.catch(() => []);
        const mLayoutId = mLayoutRows[0]?.id ?? '';
        const CSYM_M: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CAD: 'CA$', BRL: 'R$', PLN: 'zł', RUB: '₽' };

        const multiPosts = multiCandidates.map((cand: any) => ({
          id: crypto.randomUUID(), platform: 'amazon',
          sourceUrl: String(cand.affiliate_url || cand.url),
          productId: String(cand.product_id),
          title: cand.title ?? '', image: cand.image ?? '',
          originalPrice: Number(cand.original_price), discountedPrice: Number(cand.discounted_price),
          discountPercent: Number(cand.discount_percent),
          customText: '', isHistoricalLow: false,
          templateId: mTemplateId, layoutId: mLayoutId, keyboardId: '', emoji: '🟡',
          cat: cand.category || undefined,
        }));

        const _multiAutoId = crypto.randomUUID();
        await sql`INSERT INTO autopost_queue (id, user_id, posts, status, auto) VALUES (${_multiAutoId}, ${userId}, ${sql.json(multiPosts)}, 'draft', true)`.catch(e => console.warn('[autopost] multi auto-queue insert:', e.message));
        console.log(`[autopost] Amazon multi-post in coda (draft): ${multiPosts.length} prodotti`);
        continue;
      } else {

      const amzCandidate = candidates[0] ?? null;

      if (amzCandidate) {
        const amzLayouts = await sql`
          SELECT id FROM layouts WHERE user_id = ${userId}
            AND tipo IN ('amazon', 'normal', 'historical_low')
          ORDER BY tipo = 'amazon' DESC, created_at ASC LIMIT 1
        `;
        const layoutId = amzLayouts[0]?.id ?? '';
        const tplRow = await sql`SELECT id, config FROM templates WHERE user_id = ${userId} AND tipo NOT IN ('historical_low') ORDER BY (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1`;
        const templateId  = tplRow[0]?.id ?? 'tpl1';
        const templateCfg = parseTemplateCfg(tplRow[0]);

        const discountedPrice = Number(amzCandidate.discounted_price);
        const originalPrice   = Number(amzCandidate.original_price);
        const discountPercent = Number(amzCandidate.discount_percent);
        const CURRENCY_SYM: Record<string, string> = {
          EUR: '€', USD: '$', GBP: '£', JPY: '¥', CAD: 'CA$', BRL: 'R$', PLN: 'zł', RUB: '₽',
        };
        const currSym = CURRENCY_SYM[String(amzCandidate.currency ?? 'EUR').toUpperCase()] ?? '€';

        const reviewRating  = Number(amzCandidate.review_rating  ?? 0);
        const reviewCount   = Number(amzCandidate.review_count   ?? 0);

        let stelleStr     = reviewRating > 0 ? String(reviewRating.toFixed(1)) : '';
        let recensioniStr = reviewCount  > 0 ? String(reviewCount)             : '';

        // Creators API non supporta customerReviews → scraping dalla pagina prodotto
        if (!stelleStr) {
          const mktCode   = (cfg.amazon?.marketplace || 'IT').toUpperCase();
          const mktDomain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
          const scraped   = await scrapeAmazonRating(String(amzCandidate.product_id), mktDomain);
          if (scraped.stelle) {
            stelleStr     = scraped.stelle;
            recensioniStr = scraped.recensioni;
            // Aggiorna cache per evitare scraping al prossimo giro
            const nr = parseFloat(scraped.stelle) || 0;
            const nc = parseInt(scraped.recensioni.replace(/\D/g, '')) || 0;
            if (nr > 0 || nc > 0) {
              sql`UPDATE deals_cache SET rating = ${nr}, review_count = ${nc}
                  WHERE user_id = ${userId} AND platform = 'amazon'
                    AND product_id = ${String(amzCandidate.product_id)}`.catch(() => {});
            }
          }
        }

        post = {
          id: crypto.randomUUID(), platform: 'amazon',
          sourceUrl: amzCandidate.affiliate_url || amzCandidate.url,
          productId: String(amzCandidate.product_id),
          title: amzCandidate.title ?? '', image: amzCandidate.image ?? '',
          originalPrice, discountedPrice, discountPercent,
          customText: '', isHistoricalLow: false,
          templateId, layoutId, keyboardId: '', emoji: '🟡',
          stelle:     stelleStr     || undefined,
          recensioni: recensioniStr || undefined,
          cat:        amzCandidate.category || undefined,
        };

        const _amzAutoId = crypto.randomUUID();
        await sql`INSERT INTO autopost_queue (id, user_id, posts, status, auto) VALUES (${_amzAutoId}, ${userId}, ${sql.json([post])}, 'draft', true)`.catch(e => console.warn('[autopost] amz auto-queue insert:', e.message));
        const scoreLog = sortMode === 'score'
          ? ` score=${computeScore({ discountPercent, reviewRating: amzCandidate.review_rating, reviewCount: amzCandidate.review_count }, { discount: wDiscount, rating: wRating, reviews: wReviews }).toFixed(2)}`
          : '';
        console.log(`[autopost] Amazon pool in coda (draft): ${post.title?.slice(0, 50)} (${discountPercent}%${scoreLog})`);
        continue;
      } else {
        console.log(`[autopost] Amazon pool vuoto o tutti già pubblicati userId=${userId}`);
      }
      } // fine else (single post vs multi)
    }

    if (!queueItem || !post) {
      skipped.push(`${userId}: coda vuota o tutti i prezzi scaduti`);
    } else {

    // ── Seleziona layout se il post non ne ha uno ────────────────────────────
    if (!post.layoutId) {
      const platform = String(post.platform ?? 'amazon');
      const [autoLayout] = await sql`
        SELECT id FROM layouts WHERE user_id = ${userId}
          AND tipo IN ('amazon', 'normal', 'aliexpress')
        ORDER BY
          (tipo = ${platform === 'aliexpress' ? 'aliexpress' : 'amazon'}) DESC,
          (tipo = 'normal') DESC,
          created_at ASC
        LIMIT 1
      `.catch(() => [null]);
      if (autoLayout?.id) {
        post = { ...post, layoutId: String(autoLayout.id) };
        console.log(`[autopost] layout assegnato al publish: ${autoLayout.id}`);
      }
    }

    // ── Genera immagine dal template al momento della pubblicazione ───────────
    // Si applica ai post senza generatedImage (es. da tg-monitor, o auto-ricerca
    // senza template configurato al momento della creazione).
    // Garantisce che l'immagine usi sempre il template corrente al publish.
    if (!post.generatedImage && post.image && String(post.image).startsWith('http')
        && Number(post.discountedPrice ?? 0) > 0) {
      const CSYM: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CAD: 'CA$', BRL: 'R$', PLN: 'zł', RUB: '₽' };
      const currSym = post.platform === 'aliexpress'
        ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€')
        : (CSYM[String(cfg.amazon?.currency ?? 'EUR').toUpperCase()] ?? '€');

      const [pubTpl] = await sql`
        SELECT id, config FROM templates WHERE user_id = ${userId}
          AND tipo NOT IN ('historical_low')
        ORDER BY (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1
      `.catch(() => [null]);

      if (pubTpl) {
        const pubCfg = parseTemplateCfg(pubTpl);
        if (pubCfg) {
          const genImg = await generateTemplateImageServer(pubCfg, String(post.image), String(post.platform ?? 'amazon'), {
            prezzo:           `${currSym}${Number(post.discountedPrice).toFixed(2)}`,
            prezzoPrecedente: `${currSym}${Number(post.originalPrice).toFixed(2)}`,
            sconto:           `-${Number(post.discountPercent)}%`,
          }).catch(() => null);
          if (genImg) {
            post = { ...post, generatedImage: genImg };
            console.log(`[autopost] immagine generata al publish con template ${pubTpl.id}`);
          }
        }
      }
    }

    // ── Controlla minimo storico ──────────────────────────────────────────────
    if (post.productId && Number(post.discountedPrice ?? 0) > 0) {
      const [histRow] = await sql`
        SELECT MIN(price)::float AS min_price, COUNT(*)::int AS cnt
        FROM price_history WHERE product_id = ${post.productId} AND platform = ${post.platform}
      `.catch(() => [null]);
      if (histRow && Number(histRow.cnt) > 0 && Number(post.discountedPrice) <= Number(histRow.min_price)) {
        post = { ...post, isHistoricalLow: true };
        // Usa layout "minimo storico" se disponibile
        const [hlLayout] = await sql`
          SELECT id FROM layouts WHERE user_id = ${userId} AND tipo = 'historical_low'
          ORDER BY created_at ASC LIMIT 1
        `.catch(() => [null]);
        if (hlLayout?.id) post = { ...post, layoutId: String(hlLayout.id) };

        // Rigenera immagine con badge minimo storico
        const [hlTpl] = await sql`
          SELECT id, config FROM templates WHERE user_id = ${userId} AND tipo = 'historical_low'
          ORDER BY created_at ASC LIMIT 1
        `.catch(() => [null]);
        if (post.image && String(post.image).startsWith('http')) {
          const hlDiscountedPrice = Number(post.discountedPrice);
          const hlOriginalPrice   = Number(post.originalPrice);
          const hlDiscountPercent = Number(post.discountPercent);
          const hlCurrSym = post.platform === 'aliexpress'
            ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€')
            : '€';
          const hlPriceData = {
            prezzo:           `${hlCurrSym}${hlDiscountedPrice.toFixed(2)}`,
            prezzoPrecedente: `${hlCurrSym}${hlOriginalPrice.toFixed(2)}`,
            sconto:           `-${hlDiscountPercent}%`,
          };
          if (hlTpl) {
            const hlCfg = parseTemplateCfg(hlTpl)!;
            const genImg = await generateTemplateImageServer(hlCfg, String(post.image), post.platform, hlPriceData, true).catch(() => null);
            if (genImg) post = { ...post, generatedImage: genImg };
          } else {
            // Nessun template dedicato: rigenera con template base + badge
            const [baseTpl] = await sql`SELECT id, config FROM templates WHERE user_id = ${userId} LIMIT 1`.catch(() => [null]);
            if (baseTpl) {
              const baseCfg = parseTemplateCfg(baseTpl)!;
              const genImg = await generateTemplateImageServer(baseCfg, String(post.image), post.platform, hlPriceData, true).catch(() => null);
              if (genImg) post = { ...post, generatedImage: genImg };
            }
          }
        }

        console.log(`[autopost] MINIMO STORICO userId=${userId} productId=${post.productId} price=${post.discountedPrice} minPrice=${histRow.min_price} hlLayout=${hlLayout?.id ?? 'nessuno'} hlTpl=${hlTpl?.id ?? 'nessuno'}`);
      }
    }

    // Determina disable_notification:
    // silenzioso=true → sempre silenzioso; false → sempre notifica; null/undefined → usa soglia settings
    const silenzioso = (queueItem as any).silenzioso;
    const notifThreshold = typeof cfg.notifThreshold === 'number' ? cfg.notifThreshold : null;
    let disableNotification: boolean;
    if (silenzioso === true) {
      disableNotification = true;
    } else if (silenzioso === false) {
      disableNotification = false;
    } else {
      // Auto: notifica solo se lo sconto supera la soglia configurata
      disableNotification = notifThreshold === null || Number(post.discountPercent ?? 0) < notifThreshold;
    }
    console.log(`[autopost] notifica: sil=${silenzioso} threshold=${notifThreshold} disc=${post.discountPercent} → disableNotif=${disableNotification}`);

    try {
      // Carica layout testo (con eventuale tastiera associata)
      // Per post multiplo usa il layout di tipo 'multi'; altrimenti usa layoutId del post (mai multi)
      let layoutRow: any = null;
      if (isMulti) {
        [layoutRow] = await sql`SELECT body, keyboard_id FROM layouts WHERE user_id = ${userId} AND tipo = 'multi' ORDER BY created_at ASC LIMIT 1`;
      } else if (post.layoutId) {
        // Prende il layout per ID solo se NON è di tipo multi
        [layoutRow] = await sql`SELECT body, keyboard_id FROM layouts WHERE id = ${post.layoutId} AND user_id = ${userId} AND tipo != 'multi'`;
        // Fallback: se layoutId punta a un multi, seleziona il layout singolo corretto
        if (!layoutRow) {
          const platform = String(post.platform ?? 'amazon');
          [layoutRow] = await sql`
            SELECT body, keyboard_id FROM layouts WHERE user_id = ${userId}
              AND tipo IN ('amazon', 'normal', 'aliexpress')
            ORDER BY
              (tipo = ${platform === 'aliexpress' ? 'aliexpress' : 'amazon'}) DESC,
              (tipo = 'normal') DESC,
              created_at ASC
            LIMIT 1
          `.catch(() => [null]);
        }
      }

      // Tastiera: usa quella del layout se impostata, altrimenti quella del post
      const effectiveKeyboardId = layoutRow?.keyboard_id || post.keyboardId;
      const [keyboardRow] = effectiveKeyboardId ? await sql`
        SELECT body FROM keyboards WHERE id = ${effectiveKeyboardId} AND user_id = ${userId}
      ` : [null];

      // Carica tag personalizzati: prima 'legacy' (vecchio default), poi user-specifici (sovrascrivono)
      const tagRows = await sql`
        SELECT name, value FROM tags
        WHERE user_id = ${userId} OR user_id = 'legacy'
        ORDER BY (user_id = ${userId}) ASC
      `;
      const customTags: Record<string, string> = {};
      for (const t of tagRows) {
        const override = post.tagOverrides?.[t.name as string];
        customTags[t.name as string] = override !== undefined ? override : (t.value as string);
      }
      const emojiTagsInDb = Object.keys(customTags).filter(k => k.startsWith('{emoji_'));
      console.log(`[autopost] userId=${userId} totalTags=${tagRows.length} emojiTags(${emojiTagsInDb.length}):`, emojiTagsInDb);

      // Costruisce URL affiliato (primo post)
      let affiliateUrl: string = post.sourceUrl ?? '';
      if (!affiliateUrl && post.platform === 'amazon' && post.productId) {
        const mktCode = (cfg.amazon?.marketplace ?? 'IT').toUpperCase();
        const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
        affiliateUrl = `https://${domain}/dp/${post.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}`;
      }

      // Per AliExpress: se il link non è un link affiliato tracciato, generane uno al volo.
      // Questo copre il caso in cui il prodotto è stato aggiunto da "Cerca Offerte" e
      // promotion_link era null nell'API query (prodotto non in programma affiliati o tracking_id errato).
      if (post.platform === 'aliexpress' && post.productId && affiliateUrl && !affiliateUrl.includes('s.click.aliexpress.com')) {
        const aliAppKey = cfg.aliexpress?.appKey || process.env.ALIEXPRESS_APP_KEY || '';
        const aliAppSec = cfg.aliexpress?.appSecret || process.env.ALIEXPRESS_APP_SECRET || '';
        const aliTrackId = cfg.aliexpress?.trackingId || process.env.ALIEXPRESS_TRACKING_ID || '';
        const aliCountry = (cfg.aliexpress?.targetCountry || process.env.ALIEXPRESS_COUNTRY || 'IT').toUpperCase();
        if (aliAppKey && aliAppSec && aliTrackId) {
          const productPageUrl = `https://www.aliexpress.com/item/${post.productId}.html`;
          console.log(`[autopost] AliExpress link non affiliato — genero link per ${post.productId}`);
          const generated = await aliGenerateLink(productPageUrl, aliAppKey, aliAppSec, aliTrackId, aliCountry);
          if (generated) affiliateUrl = generated;
        }
      }

      const aliCurrency = post.platform === 'aliexpress'
        ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€')
        : '€';

      let messageText: string;
      let replyMarkup: object | undefined;

      if (isMulti) {
        // ── Post multiplo ──
        const layoutText: string | undefined = layoutRow?.body;
        const defaultMultiLayout = '{_<b>{custom}</b>_}\n<b>{titoloshort}</b>\n🟥#{store}\n💶 A soli: <b>{prezzo}{valuta}</b> invece di: <s>{oldprezzo}€</s>\n{_🎟 <b>Coupon:</b> {coupon}_}\n👉 <a href="{link}">ACQUISTA ORA</a>\n➿➿➿➿➿➿➿➿➿➿➿➿';

        if (layoutText?.includes('{lista_prodotti}')) {
          // Backward compat: layout vecchio con {lista_prodotti}
          const lista = (postsArr as Record<string, any>[]).map((mp, i) => {
            const cur = mp.platform === 'aliexpress'
              ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€') : '€';
            const title = String(mp.title ?? '');
            const shortTitle = title.length > 55 ? title.slice(0, 55) + '…' : title;
            return `${i + 1}. ${mp.emoji || '📦'} ${shortTitle}\n💰 ${cur}${Number(mp.discountedPrice).toFixed(2)} (-${Number(mp.discountPercent)}%)`;
          }).join('\n\n');
          messageText = buildMessage(layoutText.replace('{lista_prodotti}', lista), post, affiliateUrl, aliCurrency, customTags);
        } else {
          // Nuovo comportamento: ripeti il template per ogni prodotto
          const template = layoutText || defaultMultiLayout;
          const perProductTexts = (postsArr as Record<string, any>[]).map(mp => {
            let mpUrl = String(mp.sourceUrl ?? '');
            if (!mpUrl && mp.platform === 'amazon' && mp.productId) {
              const mktCode = (cfg.amazon?.marketplace ?? 'IT').toUpperCase();
              const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
              mpUrl = `https://${domain}/dp/${mp.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}`;
            }
            const mpCurrency = mp.platform === 'aliexpress'
              ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€') : '€';
            const mpCustomTags: Record<string, string> = {};
            for (const t of tagRows) {
              const override = mp.tagOverrides?.[t.name as string];
              mpCustomTags[t.name as string] = override !== undefined ? override : (t.value as string);
            }
            return buildMessage(template, mp, mpUrl, mpCurrency, mpCustomTags);
          });
          messageText = perProductTexts.join('\n');
        }

        // Solo la tastiera del layout (se impostata), nessun pulsante prodotto hardcoded
        if (keyboardRow?.body) {
          replyMarkup = buildKeyboard(keyboardRow.body, post, affiliateUrl)
            ?? undefined;
        }
      } else {
        const defaultLayout = `🔥 <b>{titolo}</b>\n\n💰 {prezzo_scontato}{valuta} <s>{oldprezzo}{valuta}</s>\n🏷️ Sconto: -{sconto}%\n\n{_ {custom} _}`;
        messageText = buildMessage(
          layoutRow?.body || defaultLayout,
          post, affiliateUrl, aliCurrency, customTags,
        );
        console.log(`[autopost] messageText preview (100ch): ${messageText.slice(0, 100).replace(/\n/g, '↵')}`);
        replyMarkup = buildKeyboard(keyboardRow?.body, post, affiliateUrl)
          ?? (affiliateUrl ? { inline_keyboard: [[{ text: post.platform === 'amazon' ? '🛒 Acquista su Amazon' : '🛒 Acquista su AliExpress', url: affiliateUrl }]] } : undefined);
      }

      const channel = channels[0];

      // Per post multipli senza immagine composita: genera griglia server-side
      if (isMulti && !post.generatedImage) {
        const multiImgUrls = (postsArr as Record<string, any>[])
          .map(p => String(p.image ?? ''))
          .filter(u => u.startsWith('http'));
        if (multiImgUrls.length > 0) {
          const composita = await generateMultiImageServer(multiImgUrls);
          if (composita) {
            post = { ...post, generatedImage: composita };
            console.log(`[autopost] immagine composita multi generata (${multiImgUrls.length} prodotti)`);
          }
        }
      }

      const hasGeneratedImage = post.generatedImage && String(post.generatedImage).startsWith('data:image/');
      const hasUrlImage = !hasGeneratedImage && post.image && post.image !== 'placeholder.jpg' && String(post.image).startsWith('http');

      // disable_notification: incluso SOLO quando true — omesso = Telegram notifica per default
      console.log(`[autopost] disable_notification: ${disableNotification} (sil=${silenzioso} disc=${post.discountPercent} threshold=${notifThreshold})`);

      let tgRes: Response;
      if (hasGeneratedImage) {
        const base64Data = String(post.generatedImage).replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const formData = new FormData();
        formData.append('chat_id', channel);
        formData.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');
        formData.append('caption', safeCaption(messageText, 1024));
        formData.append('parse_mode', 'HTML');
        if (disableNotification) formData.append('disable_notification', 'true');
        if (replyMarkup) formData.append('reply_markup', JSON.stringify(replyMarkup));
        tgRes = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: formData });
      } else if (hasUrlImage) {
        tgRes = await fetch(`${tgBase}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: channel,
            photo: post.image,
            caption: safeCaption(messageText, 1024),
            parse_mode: 'HTML',
            ...(disableNotification ? { disable_notification: true } : {}),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
        });
      } else {
        tgRes = await fetch(`${tgBase}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: channel,
            text: messageText.slice(0, 4096),
            parse_mode: 'HTML',
            ...(disableNotification ? { disable_notification: true } : {}),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
        });
      }

      const tgData = await tgRes.json() as { ok: boolean; result?: { message_id: number; chat?: { id: number } }; description?: string };
      console.log('[autopost]', channel, hasGeneratedImage ? 'genImg' : hasUrlImage ? 'urlImg' : 'text', tgRes.status, tgData.ok ? 'ok' : tgData.description);
      if (!tgData.ok) throw new Error(`Telegram: ${tgData.description ?? 'errore sconosciuto'}`);

      const messageId = tgData.result?.message_id ?? 0;
      const chatId = String(tgData.result?.chat?.id ?? channel);

      // Salva in published_posts
      await sql`
        INSERT INTO published_posts (
          id, user_id, emoji, title, image,
          original_price, discounted_price, discount_percent,
          platform, source_url, product_id, custom_text,
          layout_id, is_historical_low, is_multi, chat_id, message_id, published_at, last_checked_at
        ) VALUES (
          ${post.id}, ${userId}, ${post.emoji ?? ''}, ${post.title ?? ''}, ${post.image ?? ''},
          ${post.originalPrice ?? 0}, ${post.discountedPrice ?? 0}, ${post.discountPercent ?? 0},
          ${post.platform ?? 'amazon'}, ${post.sourceUrl ?? ''}, ${post.productId ?? ''},
          ${post.customText ?? ''}, ${post.layoutId ?? ''}, ${post.isHistoricalLow ?? false},
          ${isMulti}, ${chatId}, ${messageId}, now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          chat_id = EXCLUDED.chat_id,
          message_id = EXCLUDED.message_id,
          is_multi = EXCLUDED.is_multi
      `.catch((e: any) => console.error('[autopost] published_posts insert error:', e?.message));

      // Registra prezzo in storico (fire-and-forget)
      if (post.productId && Number(post.discountedPrice ?? 0) > 0) {
        sql`INSERT INTO price_history (product_id, platform, price)
            VALUES (${post.productId}, ${String(post.platform ?? 'amazon')}, ${post.discountedPrice})
        `.catch(() => {});
      }

      // Rimuove dalla coda
      await sql`DELETE FROM autopost_queue WHERE id = ${queueItem.id}`.catch(() => {});

      published.push(`${userId}: "${String(post.title ?? '').slice(0, 50)}"`);
      console.log(`[autopost] pubblicato userId=${userId} postId=${post.id}`);

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${userId}: ${msg}`);
      console.error(`[autopost] errore userId=${userId}:`, msg);
      // Ripristina a draft per il prossimo ciclo
      await sql`UPDATE autopost_queue SET status = 'draft' WHERE id = ${queueItem.id}`.catch(() => {});
    }

    } // ← chiude: else (queueItem && post)

    // ── Controlla offerte scadute (max 3 per run, anche con coda vuota) ────────
    try {
      const toCheck = await sql`
        SELECT id, product_id AS "productId", platform,
               discounted_price::float AS "discountedPrice",
               source_url AS "sourceUrl", image,
               chat_id AS "chatId", message_id AS "messageId",
               title, original_price::float AS "originalPrice",
               discount_percent AS "discountPercent",
               custom_text AS "customText", emoji
        FROM published_posts
        WHERE user_id = ${userId}
          AND NOT COALESCE(terminata, false)
          AND published_at < now() - interval '30 minutes'
          AND (last_checked_at IS NULL OR last_checked_at < now() - interval '1 hour')
        ORDER BY last_checked_at ASC NULLS FIRST
        LIMIT 5
      `.catch(() => []);

      for (const pub of toCheck) {
        // Aggiorna subito per evitare doppio check in run sovrapposti
        await sql`UPDATE published_posts SET last_checked_at = now() WHERE id = ${pub.id}`.catch(() => {});

        const check = await checkPostPrice(pub as any, cfg).catch(() => ({ valid: true as const, currentPrice: undefined as number | undefined }));

        // Registra il prezzo corrente nello storico anche se valido
        if (check.currentPrice && pub.productId) {
          sql`INSERT INTO price_history (product_id, platform, price)
              VALUES (${String(pub.productId)}, ${String(pub.platform ?? 'amazon')}, ${check.currentPrice})
          `.catch(() => {});
        }

        if (!check.valid) {
          console.log(`[autopost] offerta scaduta: ${String(pub.title ?? '').slice(0, 40)}`);
          const termCfg = (cfg.terminata ?? {}) as Record<string, any>;

          // Genera immagine terminata (grayscale + overlay)
          let termImg: Buffer | null = null;
          if (pub.image && String(pub.image).startsWith('http')) {
            termImg = await generateTerminataImageServer(String(pub.image), termCfg).catch((e: any) => {
              console.warn('[autopost] terminata img:', e?.message ?? e);
              return null;
            });
          }

          // Carica layout testo terminata
          const [termLayoutRow] = termCfg.layoutId ? await sql`
            SELECT body FROM layouts WHERE id = ${termCfg.layoutId} AND user_id = ${userId}
          `.catch(() => [null]) : [null];

          const affUrl     = String(pub.sourceUrl ?? '');
          const termCaption = termLayoutRow?.body
            ? buildMessage(String(termLayoutRow.body), pub as any, affUrl)
            : `❌ <b>OFFERTA TERMINATA</b>\n\n${esc(String(pub.title ?? ''))}`;

          const chatIdStr = String(pub.chatId ?? channels[0] ?? '');
          const msgIdNum  = Number(pub.messageId ?? 0);

          if (chatIdStr && msgIdNum) {
            if (termImg) {
              const form = new FormData();
              form.append('chat_id', chatIdStr);
              form.append('message_id', String(msgIdNum));
              form.append('media', JSON.stringify({ type: 'photo', media: 'attach://photo', caption: termCaption.slice(0, 1024), parse_mode: 'HTML' }));
              form.append('photo', new Blob([termImg], { type: 'image/jpeg' }), 'photo');
              await fetch(`${tgBase}/editMessageMedia`, { method: 'POST', body: form }).catch(() => {});
            } else {
              // Fallback: solo caption
              const captR = await fetch(`${tgBase}/editMessageCaption`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatIdStr, message_id: msgIdNum, caption: termCaption.slice(0, 1024), parse_mode: 'HTML' }),
              }).catch(() => null);
              const captD = captR ? await captR.json().catch(() => ({ ok: false })) as { ok: boolean } : { ok: false };
              if (!captD.ok) {
                await fetch(`${tgBase}/editMessageText`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatIdStr, message_id: msgIdNum, text: termCaption.slice(0, 4096), parse_mode: 'HTML' }),
                }).catch(() => {});
              }
            }
            await sql`UPDATE published_posts SET terminata = true WHERE id = ${pub.id}`.catch(() => {});
          }
        }
      }
    } catch (e) {
      console.warn('[autopost] check expired:', e instanceof Error ? e.message : e);
    }

    } finally { publishingUsers.delete(userId); } // ← rilascia lock per-userId
  }

  res.json({ ok: true, published, skipped, errors });
});
