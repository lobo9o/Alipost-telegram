import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler } from '../_utils.js';
import { checkPostPrice } from '../_priceCheck.js';
import { getProductEmoji } from '../_titleFormat.js';
import { applyCustomEmoji } from '../../lib/applyCustomEmoji.js';
import { generateTerminataImageServer } from '../_imageServer.js';
import { wrapWithPostTap, type PostTapConfig } from '../../lib/postTap.js';
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

function applyCurrPos(text: string, pos?: 'before' | 'after'): string {
  if (pos !== 'after') return text;
  const m = text.match(/^([^0-9]+)([\d].*)/);
  return m ? `${m[2]}${m[1].trimEnd()}` : text;
}

function splitAtDecimal(text: string): { main: string; dec: string; suffix: string } | null {
  const m = text.match(/^(.*?)([.,]\d{1,3})([\D]*)$/);
  if (!m) return null;
  return { main: m[1], dec: m[2], suffix: m[3] };
}

function applyDecimalSep(text: string, sep?: '.' | ','): string {
  if (!sep) return text;
  return text.replace(/([.,])(\d{1,3})([\D]*)$/, (_, _d, dec, suf) => `${sep}${dec}${suf}`);
}

function applySconto(text: string, hidePercent?: boolean, hideMinus?: boolean): string {
  let t = text;
  if (hideMinus) t = t.replace(/^-/, '');
  if (hidePercent) t = t.replace(/%$/, '');
  return t;
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
// imageSource: URL prodotto (string) oppure buffer già pronto (es. immagine template generata)
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
export async function generateTemplateImageServer(
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
      const { createCanvas, loadImage } = canvasMod.default ?? canvasMod;

      // I font sono installati a livello di sistema via fc-cache (/usr/local/share/fonts/postdealbot/)
      // NON chiamare registerFont(): sovrascrive i font di sistema con un rendering errato (sans-serif)
      // anche quando il file .ttf è identico. I font di sistema (fontconfig) renderizzano correttamente.

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
          const t = setTimeout(() => ctrl.abort(), 12000);
          const isAli = /alicdn\.com|aliexpress\.com/i.test(url);
          const r = await fetch(url, {
            signal: ctrl.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              ...(isAli ? { 'Referer': 'https://www.aliexpress.com/' } : {}),
            },
          });
          clearTimeout(t);
          if (!r.ok) { console.warn(`[tpl] fetchImgBuf HTTP ${r.status}: ${url.slice(0, 100)}`); return null; }
          return Buffer.from(await r.arrayBuffer());
        } catch (e: any) { console.warn(`[tpl] fetchImgBuf errore: ${e.message} | ${url.slice(0, 100)}`); return null; }
      }

      if (productImageUrl?.startsWith('http')) {
        try {
          const buf = await fetchImgBufC(productImageUrl);
          if (!buf) {
            console.warn(`[tpl] product immagine non scaricata: ${productImageUrl.slice(0, 100)}`);
          } else {
            // Converti a JPEG con sharp prima di loadImage:
            // node-canvas non decodifica WebP → img.width/height = 0 → drawImage no-op silenzioso
            let loadBuf = buf;
            const sharpMod2 = await import('sharp').catch(() => null) as any;
            const sharp2 = sharpMod2?.default ?? sharpMod2;
            if (sharp2) {
              try {
                loadBuf = await sharp2(buf).jpeg({ quality: 95 }).toBuffer();
              } catch (se: any) { console.warn('[tpl] product sharp convert:', se.message); }
            }
            const img = await loadImage(loadBuf);
            console.log(`[tpl] product image: ${img.width}x${img.height} url=${productImageUrl.slice(0, 60)}`);
            if (img.width > 0 && img.height > 0) {
              const el = template.product ?? { x: 5, y: 5, size: 90 };
              const x = (el.x / 100) * canvasW; const y = (el.y / 100) * canvasH;
              const box = (el.size / 100) * canvasRef; // box quadrato
              const ratio = Math.min(box / img.width, box / img.height);
              const dw = img.width * ratio; const dh = img.height * ratio;
              ctx.drawImage(img, x + (box - dw) / 2, y + (box - dh) / 2, dw, dh);
            } else {
              console.warn(`[tpl] product image dimensioni zero — salto drawImage`);
            }
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
        if (debugName) console.log(`[tpl] ${debugName}: fontFamily=${JSON.stringify(el.fontFamily)} boxW=${el.boxW} boxH=${el.boxH}`);
        const fontStr = (size: number) => `${el.bold ? 'bold ' : ''}${size}px '${el.fontFamily || 'Impact'}', 'Open Sans', sans-serif`;
        const scale = el.decimalFontScale != null && el.decimalFontScale < 1 ? el.decimalFontScale : 1;
        const parts = scale < 1 ? splitAtDecimal(text) : null;

        ctx.save();
        if (el.letterSpacing) try { (ctx as any).letterSpacing = (Number(el.letterSpacing) * 2) + 'px'; } catch { /* node-canvas older */ }

        // Nuovo sistema: riquadro auto-fit centrato
        if (el.boxW && el.boxH) {
          const boxWpx = (el.boxW / 100) * canvasW;
          const boxHpx = (el.boxH / 100) * canvasH;
          const boxX   = (el.x / 100) * canvasW;
          const boxY   = (el.y / 100) * canvasH;
          let fs = Math.round(boxHpx * 0.82);

          // auto-fit: misura testo combinato e riduce fontSize finché entra
          const combinedText = parts ? (parts.main + parts.dec + (parts.suffix || '')) : text;
          ctx.font = fontStr(fs);
          while (fs > 6 && ctx.measureText(combinedText).width > boxWpx * 0.92) {
            fs--;
            ctx.font = fontStr(fs);
          }

          const fsDec = Math.round(fs * scale);
          ctx.textBaseline = 'alphabetic';
          const midY = boxY + boxHpx / 2;
          // baseline = midY + capH/2 → visual center of caps at midY (matches CSS align-items:center)
          ctx.font = fontStr(fs);
          const capH = (ctx.measureText('H') as any).actualBoundingBoxAscent ?? Math.round(fs * 0.72);
          const baselineY = Math.round(midY + capH / 2);

          // calcola larghezza totale per centrare
          let totalW: number;
          if (!parts) {
            ctx.font = fontStr(fs);
            totalW = ctx.measureText(text).width;
          } else {
            ctx.font = fontStr(fs);
            const mw = ctx.measureText(parts.main).width;
            ctx.font = fontStr(fsDec);
            const dw = ctx.measureText(parts.dec).width;
            ctx.font = fontStr(fs);
            const sw = parts.suffix ? ctx.measureText(parts.suffix).width : 0;
            totalW = mw + dw + sw;
          }
          const sx = (el as any).textAnchor === 'left' ? boxX : (el as any).textAnchor === 'right' ? boxX + boxWpx - totalW : boxX + (boxWpx - totalW) / 2;

          if (!parts) {
            ctx.font = fontStr(fs);
            if (el.strokeEnabled && el.strokeWidth > 0) {
              ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round';
              ctx.strokeText(text, sx, baselineY);
            }
            ctx.fillStyle = el.color || '#fff'; ctx.fillText(text, sx, baselineY);
            if (el.strikethrough) {
              const strkColor = el.strikethroughColor || el.color || '#fff';
              ctx.strokeStyle = strkColor; ctx.lineWidth = Math.max(1, fs * 0.06);
              ctx.beginPath(); ctx.moveTo(sx, midY); ctx.lineTo(sx + totalW, midY); ctx.stroke();
            }
          } else {
            ctx.font = fontStr(fs);
            let curX = sx;
            if (el.strokeEnabled && el.strokeWidth > 0) {
              ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round';
              ctx.strokeText(parts.main, curX, baselineY);
            }
            ctx.fillStyle = el.color || '#fff'; ctx.fillText(parts.main, curX, baselineY);
            curX += ctx.measureText(parts.main).width;

            ctx.font = fontStr(fsDec);
            if (el.strokeEnabled && el.strokeWidth > 0) {
              ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round';
              ctx.strokeText(parts.dec, curX, baselineY);
            }
            ctx.fillStyle = el.color || '#fff'; ctx.fillText(parts.dec, curX, baselineY);
            curX += ctx.measureText(parts.dec).width;

            if (parts.suffix) {
              ctx.font = fontStr(fs);
              if (el.strokeEnabled && el.strokeWidth > 0) {
                ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round';
                ctx.strokeText(parts.suffix, curX, baselineY);
              }
              ctx.fillStyle = el.color || '#fff'; ctx.fillText(parts.suffix, curX, baselineY);
            }
            if (el.strikethrough) {
              const strkColor = el.strikethroughColor || el.color || '#fff';
              ctx.strokeStyle = strkColor; ctx.lineWidth = Math.max(1, fs * 0.06);
              ctx.beginPath(); ctx.moveTo(sx, midY); ctx.lineTo(sx + totalW, midY); ctx.stroke();
            }
          }
        } else {
          // Legacy: fontSize + textAnchor
          const fs = (Number(el.fontSize) || 36) * 2;
          const x = (el.x / 100) * canvasW; const y = (el.y / 100) * canvasH;
          const anchor = el.textAnchor === 'right' ? 'right' : el.textAnchor === 'center' ? 'center' : 'left';
          ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
          ctx.font = fontStr(fs);
          const capH = (ctx.measureText('H') as any).actualBoundingBoxAscent ?? fs * 0.72;
          const baseline = y + capH;

          if (!parts) {
            const tw = ctx.measureText(text).width;
            const sx = anchor === 'right' ? x - tw : anchor === 'center' ? x - tw / 2 : x;
            if (el.strokeEnabled && el.strokeWidth > 0) {
              ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round';
              ctx.strokeText(text, sx, baseline);
            }
            ctx.fillStyle = el.color || '#fff'; ctx.fillText(text, sx, baseline);
            if (el.strikethrough) {
              const strkColor = el.strikethroughColor || el.color || '#fff';
              ctx.strokeStyle = strkColor; ctx.lineWidth = Math.max(1, fs * 0.06);
              ctx.beginPath(); ctx.moveTo(sx, baseline - capH * 0.5); ctx.lineTo(sx + tw, baseline - capH * 0.5); ctx.stroke();
            }
          } else {
            const fsDec = Math.round(fs * scale);
            ctx.font = fontStr(fs); const mainW = ctx.measureText(parts.main).width;
            ctx.font = fontStr(fsDec); const decW = ctx.measureText(parts.dec).width;
            ctx.font = fontStr(fs); const sufW = parts.suffix ? ctx.measureText(parts.suffix).width : 0;
            const totalW = mainW + decW + sufW;
            const sx = anchor === 'right' ? x - totalW : anchor === 'center' ? x - totalW / 2 : x;
            ctx.font = fontStr(fs);
            if (el.strokeEnabled && el.strokeWidth > 0) { ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round'; ctx.strokeText(parts.main, sx, baseline); }
            ctx.fillStyle = el.color || '#fff'; ctx.fillText(parts.main, sx, baseline);
            ctx.font = fontStr(fsDec);
            if (el.strokeEnabled && el.strokeWidth > 0) { ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round'; ctx.strokeText(parts.dec, sx + mainW, baseline); }
            ctx.fillStyle = el.color || '#fff'; ctx.fillText(parts.dec, sx + mainW, baseline);
            if (parts.suffix) {
              ctx.font = fontStr(fs);
              if (el.strokeEnabled && el.strokeWidth > 0) { ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = (el.strokeWidth || 3) * 2; ctx.lineJoin = 'round'; ctx.strokeText(parts.suffix, sx + mainW + decW, baseline); }
              ctx.fillStyle = el.color || '#fff'; ctx.fillText(parts.suffix, sx + mainW + decW, baseline);
            }
            if (el.strikethrough) {
              const strkColor = el.strikethroughColor || el.color || '#fff';
              ctx.strokeStyle = strkColor; ctx.lineWidth = Math.max(1, fs * 0.06);
              ctx.beginPath(); ctx.moveTo(sx, baseline - capH * 0.5); ctx.lineTo(sx + totalW, baseline - capH * 0.5); ctx.stroke();
            }
          }
        }
        ctx.restore();
      };

      drawTextEl(template.prezzo, applyDecimalSep(applyCurrPos(priceData.prezzo, template.prezzo?.currencyPos), template.prezzo?.decimalSep), 'prezzo');
      drawTextEl(template.prezzoPrecedente, applyDecimalSep(applyCurrPos(priceData.prezzoPrecedente, template.prezzoPrecedente?.currencyPos), template.prezzoPrecedente?.decimalSep), 'prezzoPrecedente');
      drawTextEl(template.sconto, applySconto(priceData.sconto, template.sconto?.hidePercent, template.sconto?.hideMinus), 'sconto');
      drawTextEl(template.testoCustom, template.testoCustom?.text ?? '');

      if (isHistoricalLow && template.badge?.enabled && template.badge?.src) {
        try {
          const src = String(template.badge.src);
          const badgeBuf = src.startsWith('http') ? (await fetchImgBufC(src) ?? null) : null;
          const badgeImg = await loadImage(badgeBuf ?? src);
          const el = template.badge;
          const w = ((el.size ?? 30) / 100) * canvasW;
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
        const t = setTimeout(() => ctrl.abort(), 12000);
        const isAli = /alicdn\.com|aliexpress\.com/i.test(url);
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            ...(isAli ? { 'Referer': 'https://www.aliexpress.com/' } : {}),
          },
        });
        clearTimeout(t);
        if (!r.ok) { console.warn(`[tpl] fetchImgBuf HTTP ${r.status}: ${url.slice(0, 100)}`); return null; }
        return Buffer.from(await r.arrayBuffer());
      } catch (e: any) { console.warn(`[tpl] fetchImgBuf errore: ${e.message} | ${url.slice(0, 100)}`); return null; }
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
      const family = String(el.fontFamily || 'Impact').replace(/"/g, '');
      const fill = String(el.color || '#ffffff');
      const safeStr = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const scale = el.decimalFontScale != null && el.decimalFontScale < 1 ? el.decimalFontScale : 1;
      const parts = scale < 1 ? splitAtDecimal(text) : null;
      const lsAttr = el.letterSpacing ? ` letter-spacing="${Number(el.letterSpacing) * 2}"` : '';

      // Nuovo sistema: riquadro auto-fit centrato
      if (el.boxW && el.boxH) {
        const boxWpx = Math.round((el.boxW / 100) * sW);
        const boxHpx = Math.round((el.boxH / 100) * sH);
        const boxX   = Math.round((el.x / 100) * sW);
        const boxY   = Math.round((el.y / 100) * sH);
        let fs = Math.round(boxHpx * 0.82);
        // stima larghezza: 0.6 char-width per carattere (conservativo)
        const combinedText = parts ? (parts.main + parts.dec + (parts.suffix || '')) : text;
        const avgCharW = fs * 0.60;
        if (combinedText.length * avgCharW > boxWpx * 0.92) {
          fs = Math.floor(fs * (boxWpx * 0.92) / (combinedText.length * avgCharW));
          fs = Math.max(fs, 6);
        }
        const fsDec = Math.round(fs * scale);
        // stima larghezza per la linea barrata: cifre e simboli valuta sono più stretti di 0.60
        // (0.53 è più accurato per testi tipo "€48,93" rispetto al generico 0.60)
        const estW = parts
          ? Math.round(parts.main.length * fs * 0.53 + parts.dec.length * fsDec * 0.53 + (parts.suffix?.length ?? 0) * fs * 0.53)
          : Math.round(combinedText.length * fs * 0.53);
        // Usa text-anchor nativo SVG: pixel-perfect senza stima
        const svgAnchor = el.textAnchor === 'right' ? 'end' : el.textAnchor === 'left' ? 'start' : 'middle';
        const svgX = el.textAnchor === 'right' ? boxX + boxWpx : el.textAnchor === 'left' ? boxX : boxX + Math.round(boxWpx / 2);
        // baseline alfabetica a midY + 0.36*fs → centro visivo delle maiuscole a midY
        // evita dominant-baseline (non supportato da librsvg vecchio su Pi)
        const midY = boxY + Math.round(boxHpx / 2);
        const svgBaseY = midY + Math.round(fs * 0.36);
        const common = `x="${svgX}" y="${svgBaseY}" font-family="${family}, Open Sans, Impact, Arial Black, sans-serif" font-size="${fs}" font-weight="${el.bold ? 'bold' : 'normal'}" text-anchor="${svgAnchor}"${lsAttr}`;
        if (!parts) {
          const safe = safeStr(text);
          if (el.strokeEnabled && Number(el.strokeWidth) > 0) {
            svgEls.push(`<text ${common} stroke="${el.strokeColor || '#000'}" stroke-width="${Number(el.strokeWidth) * 2}" stroke-linejoin="round" paint-order="stroke" fill="${fill}">${safe}</text>`);
          } else {
            svgEls.push(`<text ${common} fill="${fill}">${safe}</text>`);
          }
        } else {
          const dy = Math.round(0.20 * (fs - fsDec));
          const inner = `<tspan>${safeStr(parts.main)}</tspan><tspan font-size="${fsDec}" dy="${dy}">${safeStr(parts.dec)}</tspan>${parts.suffix ? `<tspan font-size="${fs}" dy="${-dy}">${safeStr(parts.suffix)}</tspan>` : ''}`;
          if (el.strokeEnabled && Number(el.strokeWidth) > 0) {
            svgEls.push(`<text ${common} stroke="${el.strokeColor || '#000'}" stroke-width="${Number(el.strokeWidth) * 2}" stroke-linejoin="round" paint-order="stroke" fill="${fill}">${inner}</text>`);
          } else {
            svgEls.push(`<text ${common} fill="${fill}">${inner}</text>`);
          }
        }
        if (el.strikethrough) {
          const strkColor = String(el.strikethroughColor || el.color || '#ffffff');
          const lw = Math.max(1, Math.round(fs * 0.06));
          // posizione linea basata su stima (senza canvas non si può misurare la larghezza reale)
          const lineX1 = el.textAnchor === 'right' ? boxX + boxWpx - estW : el.textAnchor === 'left' ? boxX : boxX + Math.round((boxWpx - estW) / 2);
          svgEls.push(`<line x1="${lineX1}" y1="${midY}" x2="${lineX1 + estW}" y2="${midY}" stroke="${strkColor}" stroke-width="${lw}" stroke-linecap="round"/>`);
        }
        return;
      }

      // Legacy: fontSize + textAnchor
      const fs = (Number(el.fontSize) || 36) * 2;
      const xTop = Math.round((el.x / 100) * sW);
      const yTop = Math.round((el.y / 100) * sH);
      const y = yTop + Math.round(fs * 0.80);
      const anchor = el.textAnchor === 'right' ? 'end' : el.textAnchor === 'center' ? 'middle' : 'start';
      const common = `x="${xTop}" y="${y}" font-family="${family}, Open Sans, Impact, Arial Black, sans-serif" font-size="${fs}" font-weight="${el.bold ? 'bold' : 'normal'}" text-anchor="${anchor}"${lsAttr}`;

      if (!parts) {
        const safe = safeStr(text);
        if (el.strokeEnabled && Number(el.strokeWidth) > 0) {
          svgEls.push(`<text ${common} stroke="${el.strokeColor || '#000'}" stroke-width="${Number(el.strokeWidth) * 2}" stroke-linejoin="round" paint-order="stroke" fill="${fill}">${safe}</text>`);
        } else {
          svgEls.push(`<text ${common} fill="${fill}">${safe}</text>`);
        }
      } else {
        const fsDec = Math.round(fs * scale);
        const dy = Math.round(0.20 * (fs - fsDec));
        const suffixSpan = parts.suffix ? `<tspan font-size="${fs}" dy="${-dy}">${safeStr(parts.suffix)}</tspan>` : '';
        const inner = `<tspan>${safeStr(parts.main)}</tspan><tspan font-size="${fsDec}" dy="${dy}">${safeStr(parts.dec)}</tspan>${suffixSpan}`;
        if (el.strokeEnabled && Number(el.strokeWidth) > 0) {
          svgEls.push(`<text ${common} stroke="${el.strokeColor || '#000'}" stroke-width="${Number(el.strokeWidth) * 2}" stroke-linejoin="round" paint-order="stroke" fill="${fill}">${inner}</text>`);
        } else {
          svgEls.push(`<text ${common} fill="${fill}">${inner}</text>`);
        }
      }
      if (el.strikethrough) {
        const strkColor = String(el.strikethroughColor || el.color || '#ffffff');
        const mainChars = parts ? parts.main.length : text.length;
        const decChars  = parts ? parts.dec.length  : 0;
        const sufChars  = parts ? (parts.suffix?.length ?? 0) : 0;
        const fsDec = parts ? Math.round(fs * scale) : fs;
        const approxWidth = Math.round(mainChars * fs * 0.50 + decChars * fsDec * 0.50 + sufChars * fs * 0.50);
        const lx = anchor === 'end' ? xTop - approxWidth : anchor === 'middle' ? xTop - approxWidth / 2 : xTop;
        const ly = yTop + Math.round(fs * 0.45);
        const lw = Math.max(1, Math.round(fs * 0.06));
        svgEls.push(`<line x1="${lx}" y1="${ly}" x2="${lx + approxWidth}" y2="${ly}" stroke="${strkColor}" stroke-width="${lw}" stroke-linecap="round"/>`);
      }
    }
    textElToSvg(template.prezzo, applyDecimalSep(applyCurrPos(priceData.prezzo, template.prezzo?.currencyPos), template.prezzo?.decimalSep));
    textElToSvg(template.prezzoPrecedente, applyDecimalSep(applyCurrPos(priceData.prezzoPrecedente, template.prezzoPrecedente?.currencyPos), template.prezzoPrecedente?.decimalSep));
    textElToSvg(template.sconto, applySconto(priceData.sconto, template.sconto?.hidePercent, template.sconto?.hideMinus));
    textElToSvg(template.testoCustom, template.testoCustom?.text ?? '');
    if (svgEls.length > 0) {
      const svgStr = `<svg width="${sW}" height="${sH}" xmlns="http://www.w3.org/2000/svg">${svgEls.join('')}</svg>`;
      console.log('[tpl] SVG fonts:', svgEls.map(s => { const m = s.match(/font-family="([^"]+)"/); return m?.[1] ?? '?'; }).join(' | '));
      composites.push({ input: Buffer.from(svgStr) });
    }

    if (isHistoricalLow && template.badge?.enabled && template.badge?.src) {
      try {
        const buf = await bufFromSrc(String(template.badge.src));
        if (buf) {
          const el = template.badge; const meta = await sharp(buf).metadata();
          const w = Math.round(((el.size ?? 30) / 100) * sW); const h = Math.round(w * ((meta.height ?? 1) / (meta.width ?? 1)));
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
async function generateMultiImageServer(
  imageUrls: string[],
  opts: {
    barEnabled?: boolean; barSrc?: string | null; barHeight?: number;
    priceEnabled?: boolean; prices?: string[]; priceBgColor?: string; priceTextColor?: string; priceHeight?: number; fontFamily?: string;
  } = {}
): Promise<string | null> {
  const n = imageUrls.filter(Boolean).length;
  if (n === 0) return null;
  try {
    const sharpMod = await import('sharp').catch(() => null) as any;
    if (!sharpMod) return null;
    const sharp = (sharpMod.default ?? sharpMod) as any;

    const cols = n <= 3 ? n : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const cellSize = Math.round(1024 / cols);
    const barH   = opts.barEnabled   ? Math.max(30, Math.min(150, Number(opts.barHeight   ?? 60))) : 0;
    const priceH = opts.priceEnabled ? Math.max(24, Math.min(64,  Number(opts.priceHeight ?? 36))) : 0;
    const canvasW = cellSize * cols;
    const canvasH = barH + (cellSize + priceH) * rows;
    const PAD = 4;

    const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

    // Barra superiore (immagine caricata dall'utente)
    if (barH > 0 && opts.barSrc) {
      try {
        const b64 = opts.barSrc.includes(',') ? opts.barSrc.split(',')[1] : opts.barSrc;
        const barBuf = Buffer.from(b64, 'base64');
        const resizedBar = await sharp(barBuf).resize(canvasW, barH, { fit: 'fill' }).toBuffer();
        composites.push({ input: resizedBar, left: 0, top: 0 });
      } catch (e: any) {
        console.warn('[multiImg] errore rendering barSrc:', e.message);
      }
    }

    for (let i = 0; i < validUrls.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const itemsInRow = Math.min(cols, validUrls.length - row * cols);
      const rowOffsetX = Math.floor(((cols - itemsInRow) * cellSize) / 2);
      const cellX = rowOffsetX + col * cellSize;
      const cellY = barH + row * (cellSize + priceH);
      const buf = await fetchBuf(validUrls[i]);
      if (!buf) continue;
      const availW = cellSize - PAD * 2;
      const availH = cellSize - PAD * 2;
      const { data, info } = await sharp(buf).resize(availW, availH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
      const left = cellX + PAD + Math.round((availW - info.width) / 2);
      const top  = cellY + PAD + Math.round((availH - info.height) / 2);
      composites.push({ input: data, left, top });

      // Etichetta prezzo sotto l'immagine
      if (priceH > 0) {
        const priceText = opts.prices?.[i] ?? '';
        const priceBg   = opts.priceBgColor  ?? '#1a1a1a';
        const priceTxt  = opts.priceTextColor ?? '#ffffff';
        const pfs = Math.round(Math.min(priceH * 0.9, cellSize * 0.10));
        const pFont = escXml(opts.fontFamily ?? 'Arial');
        const cellW = cellSize;
        const svgPrice = `<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${priceH}">
          <rect width="${cellW}" height="${priceH}" fill="${escXml(priceBg)}"/>
          ${priceText ? `<text x="${cellW / 2}" y="${Math.round(priceH * 0.75)}" font-family="${pFont}" font-size="${pfs}px" font-weight="bold" fill="${escXml(priceTxt)}" text-anchor="middle">${escXml(priceText)}</text>` : ''}
        </svg>`;
        composites.push({ input: Buffer.from(svgPrice), left: cellX, top: cellY + cellSize });
      }
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
  return out.trimEnd() + (visLen >= maxLen ? '…' : '');
}

function resolveDiscountRangeTag(jsonValue: string, percent: number): string {
  try {
    const ranges = JSON.parse(jsonValue) as Record<string, string>;
    for (const [range, text] of Object.entries(ranges)) {
      const parts = range.split('-');
      const min = Number(parts[0]);
      const max = Number(parts[1]);
      if (percent >= min && (max >= 100 ? percent <= max : percent < max)) {
        return text || '';
      }
    }
  } catch {}
  return '';
}

function buildMessage(
  contenuto: string,
  post: Record<string, any>,
  affiliateUrl: string,
  currency?: string,
  customTags: Record<string, string> = {},
  terminataValue?: string,
  maxTitleLen = 60,
): string {
  const now = new Date();
  const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const pad = (n: number) => n < 10 ? `0${n}` : String(n);
  const valuta = currency ?? (post.platform === 'aliexpress' ? '$' : '€');
  const discPrice = Number(post.discountedPrice).toFixed(2).replace('.', ',');
  const origPrice = Number(post.originalPrice).toFixed(2).replace('.', ',');
  const disc = Number(post.discountPercent);
  const titleShort = (post.title || '').length > maxTitleLen ? (post.title || '').slice(0, maxTitleLen - 3) + '...' : (post.title || '');

  // boxcoupon = coupon spuntabile su Amazon (nessun codice da digitare).
  // Trattato come boxcoupon: flag esplicito, stringa 'coupon', valore numerico/monetario
  // (es. '3.06', '3.06€', '10%') = importo badge. Solo stringhe con lettere = vero codice.
  const isBoxCoupon = post.boxcoupon || post.coupon === 'coupon' || /^\d+([.,]\d+)?[€%]?$/.test(String(post.coupon || '').trim());

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
    '{terminata}':       terminataValue ?? '',
    '{custom}':          esc(post.customText || ''),
    '{store}':           post.platform === 'amazon' ? 'Amazon' : 'AliExpress',
    '{storeup}':         post.platform === 'amazon' ? 'AMAZON' : 'ALIEXPRESS',
    '{store_emoji_amz}': post.platform === 'amazon' ? (customTags['{store_emoji_amz}'] || '') : '',
    '{store_emoji_ali}': post.platform === 'aliexpress' ? (customTags['{store_emoji_ali}'] || '') : '',
    '{testo_sconto}':    resolveDiscountRangeTag(customTags['{testo_sconto}'] || '', disc),
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
    '{coupon}':          isBoxCoupon ? '' : (post.coupon || ''),
    '{boxcoupon}':       isBoxCoupon ? (customTags['{boxcoupon}'] || 'Abilita il coupon prima di acquistare') : '',
    '{checkout}':        post.checkout || '',
    '{emojicat}':        getProductEmoji(post.title || '', post.cat || ''),
  };

  const tagOverrides = (post.tagOverrides ?? {}) as Record<string, string>;
  for (const [tagName, val] of Object.entries(tagOverrides)) {
    if (!(tagName in tags)) tags[tagName] = val || '';
  }

  console.log(`[dbg-testo_sconto] customRaw="${(customTags['{testo_sconto}']||'').slice(0,40)}" disc=${disc} resolved="${(tags['{testo_sconto}']||'').slice(0,40)}"`);

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
          const valStr = typeof val === 'string' ? val : String(val ?? '');
          if (!valStr || valStr.trim() === '') hasEmpty = true;
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

async function fetchOfferingId(domain: string, asin: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${domain}/dp/${asin}`, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"offerListingID"\s*:\s*"([^"]+)"/)
      ?? html.match(/name="offerListingID"\s+value="([^"]+)"/)
      ?? html.match(/value="([^"]+)"\s+name="offerListingID"/);
    const id = m ? m[1] : null;
    if (id) console.log('[buildKeyboard] offeringId estratto per', asin, id.slice(0, 20) + '...');
    else console.warn('[buildKeyboard] offeringId non trovato per', asin);
    return id;
  } catch (e: any) {
    console.warn('[buildKeyboard] fetchOfferingId error:', e.message);
    return null;
  }
}

async function buildKeyboard(
  contenuto: string | undefined,
  post: Record<string, any>,
  affiliateUrl: string,
  ptCtx?: { config: PostTapConfig; userId: string; botToken: string },
): Promise<object | undefined> {
  if (!contenuto?.trim()) return undefined;

  const waText = encodeURIComponent(`${post.title ?? ''}\n${affiliateUrl}`);

  // Costruisce URL "Aggiungi al carrello" e "Checkout diretto" Amazon
  let addToCartUrl = affiliateUrl;
  let buyNowUrl = affiliateUrl;
  if (post.platform === 'amazon' && post.productId) {
    try {
      const u = new URL(affiliateUrl);
      const tag = u.searchParams.get('tag') ?? '';
      addToCartUrl = `${u.origin}/gp/aws/cart/add.html?ASIN.1=${post.productId}&Quantity.1=1${tag ? `&tag=${tag}` : ''}`;
      if (contenuto.includes('{buynow}')) {
        const offeringId = await fetchOfferingId(u.hostname, post.productId);
        buyNowUrl = `${u.origin}/checkout/entry/buynow?buyNow=1&quantity=1&asin=${post.productId}${tag ? `&tag=${tag}` : ''}${offeringId ? `&offeringID=${encodeURIComponent(offeringId)}` : ''}`;
      } else {
        buyNowUrl = `${u.origin}/dp/${post.productId}${tag ? `?tag=${tag}` : ''}`;
      }
    } catch { /* fallback al link normale */ }
  }

  // PostTap: wrappa {link} e {buynow} se abilitato
  const ptName = (post.title ?? '').slice(0, 120);
  const ptCfg = ptCtx?.config;
  const ptOpts = ptCtx ? { userId: ptCtx.userId, botToken: ptCtx.botToken } : {};
  const [ptLink, ptBuyNow] = await Promise.all([
    wrapWithPostTap(affiliateUrl, ptName, ptCfg, ptOpts),
    wrapWithPostTap(buyNowUrl, ptName, ptCfg, ptOpts),
  ]);

  const urlTags: Record<string, string> = {
    '{link}':            ptLink,
    '{link_affiliato}':  ptLink,
    '{addtocart}':       addToCartUrl,
    '{buynow}':          ptBuyNow,
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
      // Separa testo da URL/tag: cerca l'ultimo "-" prima di un tag {xxx} o URL http
      const sepMatch = clean.match(/^(.*)\s*-\s*(\{[a-zA-Z_][a-zA-Z0-9_]*\}|https?:\/\/.+)$/)
        ?? clean.match(/^(.*)\s+-\s+(.+)$/);
      if (!sepMatch) return null;
      const text = sepMatch[1].trim();
      const rawUrl = sepMatch[2].trim();
      // {buynow} richiede di passare per la pagina prodotto: nascondilo se c'è un coupon
      // da inserire manualmente o da spuntare (boxcoupon). Se lo sconto è automatico
      // al checkout ({checkout}), Amazon lo applica comunque → bottone visibile.
      if (rawUrl === '{buynow}' && (post.coupon || post.boxcoupon)) return null;
      let url = rawUrl;
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
export function parseTemplateCfg(row: any): Record<string, any> | null {
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
  // Vercel invia CRON_SECRET come Bearer token nell'header Authorization.
  // Richieste da localhost (worker interno) sono sempre autorizzate.
  const cronSecret = process.env.CRON_SECRET;
  const remoteIp: string = (req as any).ip ?? (req.socket as any)?.remoteAddress ?? '';
  const isLocalhost = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  if (cronSecret && !isLocalhost && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
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
    await sql`ALTER TABLE autopost_queue ADD COLUMN IF NOT EXISTS caption_prefix TEXT`.catch(() => {});
    await sql`ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS dest_channel TEXT`.catch(() => {});
    // Pulizia storico prezzi oltre 180 giorni (fire-and-forget)
    sql`DELETE FROM price_history WHERE recorded_at < now() - interval '180 days'`.catch(() => {});
    migrationDone = true;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) { res.json({ ok: true, note: 'TELEGRAM_BOT_TOKEN non configurato' }); return; }
  const tgBase = `https://api.telegram.org/bot${botToken}`;

  // Ogni processo gestisce solo i propri utenti: dev (_dev) non pubblica per stable e viceversa
  // I profili canale usano il formato "userId:channelId" (senza underscore), quindi il filtro
  // !uid.includes('_') li include correttamente in stable.
  const userSuffix = process.env.USER_SUFFIX || '';
  const allSettingsRows = await sql`SELECT user_id, data FROM settings WHERE user_id IS NOT NULL`;
  const settingsRows = (allSettingsRows as any[]).filter(row => {
    const uid = String(row.user_id);
    // Estrae la parte "base" del profilo (prima del ':') per il controllo dev/stable
    const baseUid = uid.includes(':') ? uid.split(':')[0] : uid;
    return userSuffix ? baseUid.endsWith(userSuffix) : !baseUid.includes('_');
  });

  const published: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  // Dedup cross-profilo: evita che profilo primario e secondario pubblichino sullo stesso canale
  // nello stesso ciclo cron. Chiave: "baseUserId:channel"
  const publishedChannelsThisRun = new Set<string>();

  // Build set of root users blocked by admin
  const blockedRoots = new Set<string>(
    (settingsRows as any[])
      .filter((r: any) => {
        const uid = String(r.user_id);
        if (uid.includes(':')) return false;
        const c = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data ?? {});
        return !!c.blocked;
      })
      .map((r: any) => String(r.user_id))
  );

  for (const row of settingsRows) {
    const userId = row.user_id as string;
    const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;
    const rawData = row.data ?? {};
    const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

    // Admin block
    if (blockedRoots.has(baseUserId)) { skipped.push(`${userId}: bloccato da admin`); continue; }

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
    // Profili secondari: userId = "primaryId:channelId" — se channels non salvato usa il channelId dall'ID
    const channelFromId2 = userId.includes(':') ? userId.split(':')[1] : null;
    const cfgChannels2 = Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];
    const channels: string[] = channelOverride
      ? [channelOverride]
      : cfgChannels2.length > 0 ? cfgChannels2 : channelFromId2 ? [channelFromId2] : [];

    if (!channels.length) { skipped.push(`${userId}: no channels`); continue; }

    // Dedup cross-profilo: se un altro profilo dello stesso utente ha già pubblicato
    // su questo canale in questo ciclo, salta per evitare post doppi.
    const destCh0 = channelOverride ? channels[0] : (channels[0] ?? '');
    const chanDedupKey = `${baseUserId}:${destCh0}`;
    if (!channelOverride && publishedChannelsThisRun.has(chanDedupKey)) {
      skipped.push(`${userId}: skip — ${destCh0} già pubblicato da profilo ${baseUserId} in questo ciclo`);
      continue;
    }

    // Controlla se c'è almeno un item immediate in coda — se sì, salta tutti i controlli di timing
    const [immediateItem] = await sql`
      SELECT id FROM autopost_queue
      WHERE user_id = ${userId} AND status = 'draft' AND COALESCE(immediate, false) = true
      LIMIT 1
    `;
    const hasImmediate = !!immediateItem;

    if (!hasImmediate) {
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
    }

    // Scorre la coda finché trova un post con prezzo ancora valido (max 5 tentativi)
    let queueItem: Record<string, any> | null = null;
    let post: Record<string, any> | null = null;
    let postsArr: Record<string, any>[] = [];
    let isMulti = false;
    const triedIds: string[] = [];

    for (let attempt = 0; attempt < 5; attempt++) {
      const excludeClause = triedIds.length
        ? sql`AND NOT (id = ANY(${triedIds}))`
        : sql``;

      const [candidate] = await sql`
        SELECT id, posts, silenzioso, dest_channel, caption_prefix, COALESCE(immediate, false) AS immediate FROM autopost_queue
        WHERE user_id = ${userId} AND status = 'draft' ${excludeClause}
        ORDER BY COALESCE(immediate, false) DESC, created_at ASC LIMIT 1
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

      // Verifica prezzo prima di bloccare l'item (solo per post singoli, non aliexpress, non immediate).
      // Gli item immediate=true sono catturati in tempo reale dal tg-monitor: il prezzo era valido
      // al momento della pubblicazione nel canale sorgente (coupon, offerta flash, ecc.).
      if (!isMulti && candidatePost.platform !== 'aliexpress' && !candidate.immediate) {
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
          const candidatePlatform: 'amazon' | 'aliexpress' = affUrl.toLowerCase().includes('amazon') ? 'amazon' : 'aliexpress';
          const aliCurrSym2 = ALI_CURRENCY_SYM[country] ?? '€';

          // Carica template e layout utente (come per Amazon)
          const aliTplRow = await sql`SELECT id, config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId}) AND tipo NOT IN ('historical_low') ORDER BY (user_id = ${userId}) DESC, (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1`;
          const aliTemplateId = aliTplRow[0]?.id ?? 'tpl1';
          const aliTemplateCfg = parseTemplateCfg(aliTplRow[0]);
          const aliLayoutRows = await sql`SELECT id, keyboard_id FROM layouts WHERE user_id = ${userId} AND tipo IN ('aliexpress', 'normal') ORDER BY tipo = 'aliexpress' DESC, created_at ASC LIMIT 1`;
          const aliLayoutId = aliLayoutRows[0]?.id ?? '';
          const aliKeyboardId = String(aliLayoutRows[0]?.keyboard_id ?? '');

          post = {
            id: crypto.randomUUID(), platform: candidatePlatform,
            sourceUrl: affUrl, productId: String(candidate.product_id),
            title: candidate.product_title ?? '',
            image: candidate.product_main_image_url ?? '',
            originalPrice: origPrice, discountedPrice: salePrice,
            discountPercent: discPct,
            customText: '', isHistoricalLow: false,
            templateId: aliTemplateId, layoutId: aliLayoutId, keyboardId: aliKeyboardId, emoji: '🔴',
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

        const mTplRow = await sql`SELECT id, config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId}) AND tipo NOT IN ('historical_low') ORDER BY (user_id = ${userId}) DESC, (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1`;
        const mTemplateId = mTplRow[0]?.id ?? 'tpl1';
        const mTemplateCfg = parseTemplateCfg(mTplRow[0]);
        const mLayoutRows = await sql`SELECT id, keyboard_id FROM layouts WHERE (user_id = ${userId} OR user_id = ${baseUserId}) AND tipo = 'multi' ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`.catch(() => []);
        const mLayoutId = mLayoutRows[0]?.id ?? '';
        const mKeyboardId = String(mLayoutRows[0]?.keyboard_id ?? '');
        const CSYM_M: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CAD: 'CA$', BRL: 'R$', PLN: 'zł', RUB: '₽' };

        const multiPosts = multiCandidates.map((cand: any) => ({
          id: crypto.randomUUID(), platform: 'amazon',
          sourceUrl: String(cand.affiliate_url || cand.url),
          productId: String(cand.product_id),
          title: cand.title ?? '', image: cand.image ?? '',
          originalPrice: Number(cand.original_price), discountedPrice: Number(cand.discounted_price),
          discountPercent: Number(cand.discount_percent),
          customText: '', isHistoricalLow: false,
          templateId: mTemplateId, layoutId: mLayoutId, keyboardId: mKeyboardId, emoji: '🟡',
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
          SELECT id, keyboard_id FROM layouts WHERE user_id = ${userId}
            AND tipo IN ('amazon', 'normal', 'historical_low')
          ORDER BY tipo = 'amazon' DESC, created_at ASC LIMIT 1
        `;
        const layoutId = amzLayouts[0]?.id ?? '';
        const amzKeyboardId = String(amzLayouts[0]?.keyboard_id ?? '');
        const tplRow = await sql`SELECT id, config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId}) AND tipo NOT IN ('historical_low') ORDER BY (user_id = ${userId}) DESC, (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1`;
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
          templateId, layoutId, keyboardId: amzKeyboardId, emoji: '🟡',
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
      const isAli = platform === 'aliexpress';
      // Amazon: solo tipo 'normal'; AliExpress: preferisce 'aliexpress', fallback 'normal'
      const [autoLayout] = isAli
        ? await sql`
            SELECT id FROM layouts WHERE user_id = ${userId}
              AND tipo IN ('aliexpress', 'normal')
            ORDER BY (tipo = 'aliexpress') DESC, created_at ASC
            LIMIT 1
          `.catch(() => [null])
        : await sql`
            SELECT id FROM layouts WHERE user_id = ${userId}
              AND tipo = 'normal'
            ORDER BY created_at ASC
            LIMIT 1
          `.catch(() => [null]);
      if (autoLayout?.id) {
        post = { ...post, layoutId: String(autoLayout.id) };
        console.log(`[autopost] layout assegnato al publish: ${autoLayout.id}`);
      }
    }

    // ── Genera immagine dal template al momento della pubblicazione ───────────
    // Ogni profilo utente ha i propri template — si usa il primo template disponibile.
    if (!isMulti && !post.generatedImage && post.image && String(post.image).startsWith('http')
        && Number(post.discountedPrice ?? 0) > 0) {
      const CSYM: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CAD: 'CA$', BRL: 'R$', PLN: 'zł', RUB: '₽' };
      const currSym = post.platform === 'aliexpress'
        ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€')
        : (CSYM[String(cfg.amazon?.currency ?? 'EUR').toUpperCase()] ?? '€');

      const [pubTpl] = await sql`
        SELECT id, config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId})
          AND tipo NOT IN ('historical_low')
        ORDER BY (user_id = ${userId}) DESC, (tipo = 'normal') DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1
      `.catch(() => [null]);
      console.log(`[autopost] template lookup userId=${userId} → pubTpl=${pubTpl?.id ?? 'non trovato'}`);

      if (pubTpl) {
        const pubCfg = parseTemplateCfg(pubTpl);
        if (pubCfg) {
          const genImg = await generateTemplateImageServer(pubCfg, String(post.image), String(post.platform ?? 'amazon'), {
            prezzo:           `${currSym}${Number(post.discountedPrice).toFixed(2)}`,
            prezzoPrecedente: `${currSym}${Number(post.originalPrice).toFixed(2)}`,
            sconto:           `-${Number(post.discountPercent)}%`,
          }).catch((e: any) => { console.error(`[autopost] ❌ generateTemplateImageServer fallita template=${pubTpl.id}:`, e?.message ?? e); return null; });
          if (genImg) {
            post = { ...post, generatedImage: genImg };
            console.log(`[autopost] ✅ immagine generata con template ${pubTpl.id}`);
          } else {
            console.warn(`[autopost] ⚠️ immagine NON generata, uso URL prodotto`);
          }
        }
      }
    }

    // ── Controlla minimo storico (solo post singoli) ──────────────────────────
    if (!isMulti && post.productId && Number(post.discountedPrice ?? 0) > 0) {
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
          SELECT id, config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId}) AND tipo = 'historical_low'
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
            const [baseTpl] = await sql`SELECT id, config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId}) AND tipo NOT IN ('historical_low') ORDER BY (user_id = ${userId}) DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1`.catch(() => [null]);
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
        // Usa il layoutId passato dal primo post (es. daily-recap usa il più recente)
        const multiLayoutId = (postsArr[0] as any)?.layoutId;
        if (multiLayoutId) {
          [layoutRow] = await sql`SELECT body, keyboard_id FROM layouts WHERE id = ${multiLayoutId} AND (user_id = ${userId} OR user_id = ${baseUserId}) AND tipo = 'multi'`.catch(() => [null]);
        }
        if (!layoutRow) {
          [layoutRow] = await sql`SELECT body, keyboard_id FROM layouts WHERE (user_id = ${userId} OR user_id = ${baseUserId}) AND tipo = 'multi' ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`.catch(() => [null]);
        }
        console.log(`[autopost] multi layout: id=${layoutRow?.id ?? 'null'} body="${String(layoutRow?.body ?? 'defaultMultiLayout').slice(0, 60).replace(/\n/g, '↵')}"`);
      } else if (post.layoutId) {
        // Prende il layout per ID solo se NON è di tipo multi
        [layoutRow] = await sql`SELECT body, keyboard_id FROM layouts WHERE id = ${post.layoutId} AND user_id = ${userId} AND tipo != 'multi'`;
        // Fallback: se layoutId punta a un multi, seleziona il layout singolo corretto
        if (!layoutRow) {
          const platform = String(post.platform ?? 'amazon');
          const isAliF = platform === 'aliexpress';
          [layoutRow] = isAliF
            ? await sql`
                SELECT body, keyboard_id FROM layouts WHERE user_id = ${userId}
                  AND tipo IN ('aliexpress', 'normal')
                ORDER BY (tipo = 'aliexpress') DESC, created_at ASC
                LIMIT 1
              `.catch(() => [null])
            : await sql`
                SELECT body, keyboard_id FROM layouts WHERE user_id = ${userId}
                  AND tipo = 'normal'
                ORDER BY created_at ASC
                LIMIT 1
              `.catch(() => [null]);
        }
      }

      // Tastiera: usa quella del layout se impostata, altrimenti quella del post,
      // altrimenti la prima tastiera dell'utente (fallback per layout senza keyboard_id)
      const effectiveKeyboardId = post.keyboardId || layoutRow?.keyboard_id;
      let [keyboardRow] = effectiveKeyboardId ? await sql`
        SELECT body FROM keyboards WHERE id = ${effectiveKeyboardId} AND user_id = ${userId}
      ` : [null];
      if (!keyboardRow) {
        const [firstKb] = await sql`SELECT body FROM keyboards WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1`;
        if (firstKb) keyboardRow = firstKb;
      }

      // Carica tag personalizzati: prima 'legacy', poi profili secondari, poi base user (priorità più alta)
      const tagRows = await sql`
        SELECT name, value FROM tags
        WHERE user_id = ${userId} OR user_id LIKE ${baseUserId + ':%'} OR user_id = 'legacy'
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
        const aliTrackId = cfg.aliexpress?.trackingId || '';
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

      // PostTap: carica config dalla tabella dedicata — solo per post Amazon (o multi-post con articoli misti)
      const [ptRowPub] = await sql`SELECT enabled, cookie FROM posttap_sessions WHERE user_id = ${baseUserId}`.catch(() => [] as any[]);
      const ptConfigPub: PostTapConfig | undefined = ptRowPub?.enabled && ptRowPub?.cookie
        ? { enabled: true, cookie: ptRowPub.cookie } : undefined;
      // Per i multi-post (es. riepilogo) ptActivePub è sempre abilitato se config presente:
      // ogni prodotto viene wrappato individualmente solo se amazon (vedi mpPtUrls loop sotto).
      // Per post singoli: solo se amazon.
      const ptActivePub = ptConfigPub && (isMulti || post.platform === 'amazon') ? ptConfigPub : undefined;
      const ptCtxPub = ptActivePub ? { config: ptActivePub, userId, botToken } : undefined;
      const ptAffiliateUrl = await wrapWithPostTap(affiliateUrl, post.title ?? '', ptActivePub, { userId, botToken });

      let messageText: string;
      let replyMarkup: object | undefined;

      if (isMulti) {
        // ── Post multiplo ──
        const layoutText: string | undefined = layoutRow?.body;
        const defaultMultiLayout = '{_<b>{custom}</b>_}\n<b>{titoloshort}</b>\n🟥#{store}\n💶 A soli: <b>{prezzo}{valuta}</b> invece di: <s>{oldprezzo}€</s>\n{_🎟 <b>Coupon:</b> {coupon}_}\n👉 <a href="{link}">ACQUISTA ORA</a>\n➿➿➿➿➿➿➿➿➿➿➿➿';

        // PostTap: pre-calcola URL per ogni prodotto del multi-post
        const mpPtUrls = new Map<string, string>();
        if (ptActivePub) {
          await Promise.all((postsArr as any[]).map(async (mp: any) => {
            if (mp.platform !== 'amazon') return;
            let mpRawUrl = String(mp.sourceUrl ?? '');
            if (!mpRawUrl && mp.productId) {
              const mktCode = (cfg.amazon?.marketplace ?? 'IT').toUpperCase();
              const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
              mpRawUrl = `https://${domain}/dp/${mp.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}`;
            }
            if (mpRawUrl) {
              const ptUrl = await wrapWithPostTap(mpRawUrl, String(mp.title ?? ''), ptActivePub, { userId, botToken });
              mpPtUrls.set(String(mp.productId ?? ''), ptUrl);
            }
          }));
        }

        if (layoutText?.includes('{lista_prodotti}')) {
          // Backward compat: layout vecchio con {lista_prodotti}
          const lista = (postsArr as Record<string, any>[]).map((mp, i) => {
            const cur = mp.platform === 'aliexpress'
              ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€') : '€';
            const title = String(mp.title ?? '');
            const shortTitle = title.length > 55 ? title.slice(0, 55) + '…' : title;
            return `${i + 1}. ${mp.emoji || '📦'} ${shortTitle}\n💰 ${cur}${Number(mp.discountedPrice).toFixed(2).replace('.', ',')} (-${Number(mp.discountPercent)}%)`;
          }).join('\n\n');
          messageText = buildMessage(layoutText.replace('{lista_prodotti}', lista), post, ptAffiliateUrl, aliCurrency, customTags);
          console.log(`[autopost] multi lista_prodotti messageText (100ch): ${messageText.slice(0, 100).replace(/\n/g, '↵')}`);
        } else {
          // Nuovo comportamento: ripeti il template per ogni prodotto
          const template = layoutText || defaultMultiLayout;

          // Helper: costruisce i testi per ogni prodotto con titoli troncati a maxTitleLen chars
          const buildTexts = (maxTitleLen: number) =>
            (postsArr as Record<string, any>[]).map(mp => {
              let mpUrl = String(mp.sourceUrl ?? '');
              if (!mpUrl && mp.platform === 'amazon' && mp.productId) {
                const mktCode = (cfg.amazon?.marketplace ?? 'IT').toUpperCase();
                const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
                mpUrl = `https://${domain}/dp/${mp.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}`;
              }
              // PostTap: usa URL pre-calcolato se disponibile
              const ptMpUrl = mpPtUrls.get(String(mp.productId ?? ''));
              if (ptMpUrl) mpUrl = ptMpUrl;
              const mpCurrency = mp.platform === 'aliexpress'
                ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€') : '€';
              const mpCustomTags: Record<string, string> = {};
              for (const t of tagRows) {
                const override = mp.tagOverrides?.[t.name as string];
                mpCustomTags[t.name as string] = override !== undefined ? override : (t.value as string);
              }
              return buildMessage(template, mp, mpUrl, mpCurrency, mpCustomTags, undefined, maxTitleLen);
            });

          const captPfx = ((queueItem as any)?.caption_prefix as string | null | undefined)?.trim() ?? '';
          // Se captPfx ha già tag HTML, usalo as-is; altrimenti avvolgi in <b>
          const pfxHtml = captPfx ? (/<[a-zA-Z]/.test(captPfx) ? captPfx + '\n\n' : `<b>${captPfx}</b>\n\n`) : '';
          const visLen = (s: string) => s.replace(/<[^>]+>/g, '').length;

          // 1. Prova ad abbreviare i titoli (60→40→25) prima di rimuovere prodotti
          let fittingTexts: string[] = buildTexts(60);
          for (const tLen of [60, 40, 25]) {
            const texts = buildTexts(tLen);
            fittingTexts = texts;
            if (visLen(pfxHtml + texts.join('\n')) <= 1024) break;
          }
          // 2. Se ancora troppo lungo (titoli già a 25), rimuovi items dalla fine
          while (fittingTexts.length > 1 && visLen(pfxHtml + fittingTexts.join('\n')) > 1024) {
            fittingTexts = fittingTexts.slice(0, -1);
          }
          messageText = pfxHtml + fittingTexts.join('\n');
        }
        console.log(`[autopost] multi messageText (100ch): ${messageText.slice(0, 100).replace(/\n/g, '↵')}`);

        // Per il path backward-compat {lista_prodotti}: aggiungi caption_prefix se presente
        if (layoutRow?.body?.includes('{lista_prodotti}')) {
          const captionPrefix = (queueItem as any)?.caption_prefix as string | null | undefined;
          if (captionPrefix?.trim()) {
            const pfx = captionPrefix.trim();
            messageText = (/<[a-zA-Z]/.test(pfx) ? pfx : `<b>${pfx}</b>`) + '\n\n' + messageText;
          }
        }

        // Solo la tastiera del layout (se impostata), nessun pulsante prodotto hardcoded
        if (keyboardRow?.body) {
          replyMarkup = await buildKeyboard(keyboardRow.body, post, affiliateUrl, ptCtxPub)
            ?? undefined;
        }
      } else {
        const defaultLayout = `🔥 <b>{titolo}</b>\n\n💰 {prezzo_scontato}{valuta} <s>{oldprezzo}{valuta}</s>\n🏷️ Sconto: -{sconto}%\n\n{_ {custom} _}`;
        messageText = buildMessage(
          layoutRow?.body || defaultLayout,
          post, ptAffiliateUrl, aliCurrency, customTags,
        );
        console.log(`[autopost] messageText preview (100ch): ${messageText.slice(0, 100).replace(/\n/g, '↵')}`);
        replyMarkup = await buildKeyboard(keyboardRow?.body, post, affiliateUrl, ptCtxPub)
          ?? (affiliateUrl ? { inline_keyboard: [[{ text: post.platform === 'amazon' ? '🛒 Acquista su Amazon' : '🛒 Acquista su AliExpress', url: ptAffiliateUrl }]] } : undefined);
      }

      // Usa dest_channel dell'item se impostato, altrimenti il primo canale configurato
      // CHANNEL_OVERRIDE (env dev) ha sempre precedenza assoluta
      const destCh = queueItem?.dest_channel as string | null | undefined;
      const channel = channelOverride
        ? channels[0]
        : destCh || channels[0];
      if (!channelOverride && !destCh && channels.length > 1) {
        console.log(`[autopost] ⚠️ dest_channel non impostato per item ${queueItem?.id} — uso canale default ${channels[0]}`);
      }

      // Per post multipli: rigenera sempre la griglia lato server (applica barra + prezzi dal template)
      if (isMulti) {
        const multiImgUrls = (postsArr as Record<string, any>[])
          .map(p => String(p.image ?? ''))
          .filter(u => u.startsWith('http'));
        if (multiImgUrls.length > 0) {
          // Carica config template per impostazioni multiplo (barra + prezzi)
          const mTplId = (postsArr as any[])[0]?.templateId;
          const mTplRows = mTplId && mTplId !== 'tpl1'
            ? await sql`SELECT config FROM templates WHERE id = ${mTplId} AND (user_id = ${baseUserId} OR user_id = ${userId}) LIMIT 1`.catch(() => [])
            : await sql`SELECT config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId}) ORDER BY (user_id = ${userId}) DESC, updated_at DESC NULLS LAST LIMIT 1`.catch(() => []);
          const mTplCfg = parseTemplateCfg(mTplRows[0] ?? null);
          const mb = (mTplCfg?.multiBar  ?? {}) as Record<string, any>;
          // Se multiPrice non è configurato nel template, mostra i prezzi di default
          const mp = (mTplCfg?.multiPrice ?? {}) as Record<string, any>;

          const mpCurrencyPos: 'before' | 'after' = mp.currencyPos === 'after' ? 'after' : 'before';
          const multiPrices = (postsArr as Record<string, any>[]).map(p => {
            const price = Number(p.discountedPrice ?? 0);
            if (price <= 0) return '';
            const sym = p.platform === 'aliexpress'
              ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€') : '€';
            const formatted = price.toFixed(2).replace('.', ',');
            return mpCurrencyPos === 'after' ? `${formatted}${sym}` : `${sym}${formatted}`;
          });

          const composita = await generateMultiImageServer(multiImgUrls, {
            barEnabled:    !!mb.enabled,
            barSrc:        mb.src ?? null,
            barHeight:     Number(mb.height   ?? 60),
            priceEnabled:  !!mp.enabled,
            prices:        multiPrices,
            priceBgColor:  String(mp.bgColor   ?? '#1a1a1a'),
            priceTextColor: String(mp.textColor ?? '#ffffff'),
            priceHeight:   Number(mp.height    ?? 36),
            fontFamily:    String(mp.fontFamily ?? 'Arial'),
          });
          if (composita) {
            post = { ...post, generatedImage: composita };
            console.log(`[autopost] immagine composita multi generata (${multiImgUrls.length} prodotti, bar=${!!mb.enabled && !!mb.src} price=${!!mp.enabled})`);
          }
        }
      }

      // Applica emoji animate: solo emoji del canale corrente
      const emojiRows = await sql`
        SELECT emoji_char, custom_emoji_id
        FROM emoji_ids
        WHERE user_id = ${userId}
      `.catch(() => [] as any[]);
      if (emojiRows.length > 0) {
        for (const { emoji_char, custom_emoji_id } of emojiRows as { emoji_char: string; custom_emoji_id: string }[]) {
          if (emoji_char && custom_emoji_id && messageText.includes(emoji_char)) {
            messageText = messageText.split(emoji_char).join(`<tg-emoji emoji-id="${custom_emoji_id}">${emoji_char}</tg-emoji>`);
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

      // Edit MTProto per emoji animate (il Bot API le ignora, GramJS le applica)
      if (messageId) {
        const htmlForEdit = (hasGeneratedImage || hasUrlImage)
          ? safeCaption(messageText, 1024)
          : messageText.slice(0, 4096);
        applyCustomEmoji({ baseUserId, chatId, messageId, htmlText: htmlForEdit, enabled: cfg.emojiAnimated?.enabled !== false }).catch(() => {});
      }

      // Salva in published_posts
      const multiItemsForDB = isMulti
        ? sql.json((postsArr as Record<string, any>[]).map(mp => ({
            id: String(mp.id ?? ''),
            title: String(mp.title ?? ''),
            emoji: String(mp.emoji ?? '📦'),
            image: String(mp.image ?? ''),
            price: Number(mp.discountedPrice ?? 0).toFixed(2),
            originalPrice: Number(mp.originalPrice ?? 0),
            discountPercent: Number(mp.discountPercent ?? 0),
            platform: String(mp.platform ?? 'amazon'),
            sourceUrl: String(mp.sourceUrl ?? ''),
            productId: String(mp.productId ?? ''),
            customText: String(mp.customText ?? ''),
            layoutId: String(mp.layoutId ?? ''),
            isHistoricalLow: Boolean(mp.isHistoricalLow ?? false),
            coupon: String(mp.coupon ?? ''),
            terminata: false,
            resolvedText: '',
          })))
        : null;
      const pubEmoji = isMulti ? '🗂️' : (post.emoji ?? '');
      const pubTitle = isMulti ? `Post multiplo (${postsArr.length} prodotti)` : (post.title ?? '');
      await sql`
        INSERT INTO published_posts (
          id, user_id, emoji, title, image,
          original_price, discounted_price, discount_percent,
          platform, source_url, product_id, custom_text,
          layout_id, is_historical_low, is_multi, multi_items, chat_id, message_id, published_at, last_checked_at, dest_channel
        ) VALUES (
          ${post.id}, ${userId}, ${pubEmoji}, ${pubTitle}, ${post.image ?? ''},
          ${post.originalPrice ?? 0}, ${post.discountedPrice ?? 0}, ${post.discountPercent ?? 0},
          ${post.platform ?? 'amazon'}, ${post.sourceUrl ?? ''}, ${post.productId ?? ''},
          ${post.customText ?? ''}, ${post.layoutId ?? ''}, ${post.isHistoricalLow ?? false},
          ${isMulti}, ${multiItemsForDB}, ${chatId}, ${messageId}, now(),
          ${String(post.customText ?? '').toUpperCase().includes('ERRORE') ? null : sql`now()`},
          ${destCh ?? null}
        )
        ON CONFLICT (id) DO UPDATE SET
          chat_id = EXCLUDED.chat_id,
          message_id = EXCLUDED.message_id,
          is_multi = EXCLUDED.is_multi,
          multi_items = EXCLUDED.multi_items
      `.catch((e: any) => console.error('[autopost] published_posts insert error:', e?.message));

      // Registra prezzo in storico (fire-and-forget)
      if (post.productId && Number(post.discountedPrice ?? 0) > 0) {
        sql`INSERT INTO price_history (product_id, platform, price)
            VALUES (${post.productId}, ${String(post.platform ?? 'amazon')}, ${post.discountedPrice})
        `.catch(() => {});
      }

      // Rimuove dalla coda
      await sql`DELETE FROM autopost_queue WHERE id = ${queueItem.id}`.catch(() => {});

      publishedChannelsThisRun.add(chanDedupKey);
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
      // Carica valore del tag {terminata} dal DB per questo utente
      const [termTagRow] = await sql`
        SELECT value FROM tags
        WHERE name = '{terminata}' AND (user_id = ${userId} OR user_id = ${baseUserId})
        ORDER BY (user_id = ${userId}) DESC LIMIT 1
      `.catch(() => [null]);
      const terminataTagValue = String(termTagRow?.value ?? '❌ Offerta terminata');

      // Per profili primari includi anche i post dei profili secondari (userId:channelId)
      // che potrebbero avere attivo=false e quindi non essere iterati nel loop principale.
      const secondaryPattern = userId.includes(':') ? null : `${userId}:%`;
      const selectCols = sql`
          id, product_id AS "productId", platform,
          discounted_price::float AS "discountedPrice",
          source_url AS "sourceUrl", image,
          chat_id AS "chatId", message_id AS "messageId",
          title, original_price::float AS "originalPrice",
          discount_percent AS "discountPercent",
          custom_text AS "customText", emoji,
          layout_id AS "layoutId",
          COALESCE(is_multi, false) AS "isMulti",
          COALESCE(multi_items, '[]'::jsonb) AS "multiItems"
      `;
      // Query separata per post ERRORE: priorità assoluta, slot dedicati, intervallo breve
      const erroreToCheck = secondaryPattern
        ? await sql`
          SELECT ${selectCols} FROM published_posts
          WHERE (user_id = ${userId} OR user_id LIKE ${secondaryPattern})
            AND NOT COALESCE(terminata, false)
            AND custom_text ILIKE '%ERRORE%'
            AND published_at < now() - interval '5 minutes'
            AND (last_checked_at IS NULL OR last_checked_at < now() - interval '5 minutes')
          ORDER BY last_checked_at ASC NULLS FIRST
          LIMIT 10
        `.catch(() => [])
        : await sql`
          SELECT ${selectCols} FROM published_posts
          WHERE user_id = ${userId}
            AND NOT COALESCE(terminata, false)
            AND custom_text ILIKE '%ERRORE%'
            AND published_at < now() - interval '5 minutes'
            AND (last_checked_at IS NULL OR last_checked_at < now() - interval '5 minutes')
          ORDER BY last_checked_at ASC NULLS FIRST
          LIMIT 10
        `.catch(() => []);
      // Query per post normali: intervallo 30 minuti, rimanenti 40 slot
      const normalToCheck = secondaryPattern
        ? await sql`
          SELECT ${selectCols} FROM published_posts
          WHERE (user_id = ${userId} OR user_id LIKE ${secondaryPattern})
            AND NOT COALESCE(terminata, false)
            AND (custom_text NOT ILIKE '%ERRORE%' OR custom_text IS NULL)
            AND published_at < now() - interval '30 minutes'
            AND (last_checked_at IS NULL OR last_checked_at < now() - interval '30 minutes')
          ORDER BY last_checked_at ASC NULLS FIRST
          LIMIT 40
        `.catch(() => [])
        : await sql`
          SELECT ${selectCols} FROM published_posts
          WHERE user_id = ${userId}
            AND NOT COALESCE(terminata, false)
            AND (custom_text NOT ILIKE '%ERRORE%' OR custom_text IS NULL)
            AND published_at < now() - interval '30 minutes'
            AND (last_checked_at IS NULL OR last_checked_at < now() - interval '30 minutes')
          ORDER BY last_checked_at ASC NULLS FIRST
          LIMIT 40
        `.catch(() => []);
      const toCheck = [...erroreToCheck, ...normalToCheck];

      // PostTap: carica config una volta per il loop terminata
      const [ptTermRow] = await sql`SELECT enabled, cookie FROM posttap_sessions WHERE user_id = ${baseUserId}`.catch(() => [] as any[]);
      const ptTermConfig: PostTapConfig | undefined = ptTermRow?.enabled && ptTermRow?.cookie
        ? { enabled: true, cookie: ptTermRow.cookie } : undefined;

      // Custom tag: caricati una volta per il loop (servono a buildMessage per store_emoji_amz/ali ecc.)
      const termTagRows = await sql`SELECT name, value FROM tags WHERE user_id = ${userId} OR user_id = ${baseUserId}`.catch(() => [] as any[]);
      const termCustomTags: Record<string, string> = {};
      for (const tr of termTagRows) termCustomTags[String(tr.name)] = String(tr.value ?? '');

      console.log(`[autopost] price-check ${userId}: trovati ${toCheck.length} post da verificare`);
      for (const pub of toCheck) {
        // Aggiorna subito per evitare doppio check in run sovrapposti
        await sql`UPDATE published_posts SET last_checked_at = now() WHERE id = ${pub.id}`.catch(() => {});

        // AliExpress non ha price-check affidabile — skip
        if (pub.platform === 'aliexpress') continue;
        // Multi-post: terminati solo se sono errori di prezzo (customText contiene "ERRORE")
        if (pub.isMulti && !String(pub.customText ?? '').toUpperCase().includes('ERRORE')) continue;
        const check = await checkPostPrice(pub as any, cfg).catch(() => ({ valid: true as const, currentPrice: undefined as number | undefined }));
        console.log(`[autopost] price-check ${pub.productId}: valid=${check.valid} price=${check.currentPrice ?? '-'} stored=${pub.discountedPrice} orig=${pub.originalPrice} chatId=${pub.chatId}`);

        // Registra il prezzo corrente nello storico anche se valido
        if (check.currentPrice && pub.productId) {
          sql`INSERT INTO price_history (product_id, platform, price)
              VALUES (${String(pub.productId)}, ${String(pub.platform ?? 'amazon')}, ${check.currentPrice})
          `.catch(() => {});
        }

        if (!check.valid) {
          console.log(`[autopost] offerta scaduta: ${String(pub.title ?? '').slice(0, 40)} — ${check.reason}`);
          // Se il post appartiene a un profilo secondario (main userId che gestisce canali secondari),
          // carica le impostazioni del profilo specifico del canale invece del profilo principale.
          const pubUserId = secondaryPattern ? `${baseUserId}:${String(pub.chatId)}` : userId;
          let pubCfg = cfg;
          if (pubUserId !== userId) {
            const [pubSettingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${pubUserId}`.catch(() => []);
            if (pubSettingsRow?.data) {
              const raw = typeof pubSettingsRow.data === 'string' ? JSON.parse(pubSettingsRow.data) : pubSettingsRow.data;
              pubCfg = { ...cfg, ...raw };
            }
          }
          const termCfg = (pubCfg.terminata ?? cfg.terminata ?? {}) as Record<string, any>;
          const telegramMode = String(termCfg.telegramMode ?? 'keep');
          // Se overlayText non è configurato, usa il valore del tag {terminata} come fallback
          const effectiveTermCfg: Record<string, any> = {
            grayscale: true, overlayTextColor: '#ff0000', overlayTextSize: 7, overlayTextX: 50, overlayTextY: 50,
            ...termCfg,
            overlayText: termCfg.overlayText || terminataTagValue,
          };

          // Genera immagine terminata (grayscale + overlay) — uguale alla terminata manuale
          let termImg: Buffer | null = null;
          if (pub.isMulti) {
            // Multi: ricostruisce griglia composita da multi_items, poi applica terminata
            const multiItems = Array.isArray(pub.multiItems) ? pub.multiItems : [];
            const imgUrls = (multiItems as any[]).map(it => String(it.image ?? '')).filter(u => u.startsWith('http'));
            if (imgUrls.length > 0) {
              try {
                const compositeDataUrl = await generateMultiImageServer(imgUrls);
                if (compositeDataUrl) {
                  const b64 = compositeDataUrl.replace(/^data:image\/\w+;base64,/, '');
                  termImg = await generateTerminataImageServer(Buffer.from(b64, 'base64'), effectiveTermCfg).catch((e: any) => {
                    console.warn('[autopost] terminata multi img:', e?.message ?? e);
                    return null;
                  });
                }
              } catch (e: any) {
                console.warn('[autopost] terminata multi: errore composita —', e?.message ?? e);
              }
            }
          } else if (pub.image && String(pub.image).startsWith('http')) {
            let baseForTerm: string | Buffer = String(pub.image);
            try {
              const [termTpl] = await sql`
                SELECT id, config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId})
                  AND tipo NOT IN ('historical_low')
                ORDER BY (user_id = ${userId}) DESC, (tipo = 'normal') DESC, updated_at DESC NULLS LAST, created_at DESC LIMIT 1
              `.catch(() => [null]);
              if (termTpl) {
                const termTplCfg = parseTemplateCfg(termTpl);
                if (termTplCfg) {
                  const CSYM2: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CAD: 'CA$', BRL: 'R$', PLN: 'zł', RUB: '₽' };
                  const cs2 = pub.platform === 'aliexpress'
                    ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€')
                    : (CSYM2[String(cfg.amazon?.currency ?? 'EUR').toUpperCase()] ?? '€');
                  const tplBuf = await generateTemplateImageServer(termTplCfg, String(pub.image), String(pub.platform ?? 'amazon'), {
                    prezzo:           `${cs2}${Number(pub.discountedPrice).toFixed(2)}`,
                    prezzoPrecedente: `${cs2}${Number(pub.originalPrice).toFixed(2)}`,
                    sconto:           `-${Number(pub.discountPercent)}%`,
                  }).catch(() => null);
                  if (tplBuf) {
                    const b64 = String(tplBuf).replace(/^data:image\/\w+;base64,/, '');
                    baseForTerm = Buffer.from(b64, 'base64');
                    console.log(`[autopost] terminata: uso template ${termTpl.id} per base image`);
                  }
                }
              }
            } catch (e: any) {
              console.warn('[autopost] terminata: fallback a image URL grezzo —', e?.message ?? e);
            }
            termImg = await generateTerminataImageServer(baseForTerm, effectiveTermCfg).catch((e: any) => {
              console.warn('[autopost] terminata img:', e?.message ?? e);
              return null;
            });
          }

          // Costruisce caption rispettando telegramMode — identico alla terminata manuale
          let termCaption: string | undefined;
          if (telegramMode === 'only') {
            termCaption = terminataTagValue;
          } else if (telegramMode === 'append') {
            // Usa il layout del post stesso (non termCfg.layoutId che potrebbe non essere impostato)
            const layoutIdToUse = (pub as any).layoutId ?? termCfg.layoutId ?? null;
            const [termLayoutRow] = layoutIdToUse ? await sql`
              SELECT body FROM layouts WHERE id = ${layoutIdToUse}
                AND (user_id = ${userId} OR user_id = ${baseUserId} OR user_id = ${pubUserId})
            `.catch(() => [null]) : [null];
            const affUrl = String(pub.sourceUrl ?? '');
            const ptTermAffUrl = ptTermConfig && pub.platform === 'amazon'
              ? await wrapWithPostTap(affUrl, String(pub.title ?? ''), ptTermConfig, { userId, botToken })
              : affUrl;
            const builtCaption = termLayoutRow?.body
              ? buildMessage(String(termLayoutRow.body), pub as any, ptTermAffUrl, undefined, termCustomTags, terminataTagValue)
              : '';
            termCaption = builtCaption || terminataTagValue;
          }
          // telegramMode === 'keep' (default) → termCaption rimane undefined, non cambia il testo

          const chatIdStr = String(pub.chatId ?? channels[0] ?? '');
          const msgIdNum  = Number(pub.messageId ?? 0);

          console.log(`[autopost] terminata: chatId=${chatIdStr} msgId=${msgIdNum} img=${!!termImg} mode=${telegramMode}`);
          if (chatIdStr && msgIdNum) {
            if (termImg) {
              const mediaObj: Record<string, any> = { type: 'photo', media: 'attach://photo', parse_mode: 'HTML' };
              if (termCaption !== undefined) mediaObj.caption = termCaption.slice(0, 1024);
              const form = new FormData();
              form.append('chat_id', chatIdStr);
              form.append('message_id', String(msgIdNum));
              form.append('media', JSON.stringify(mediaObj));
              form.append('photo', new Blob([termImg], { type: 'image/jpeg' }), 'photo');
              const tgR = await fetch(`${tgBase}/editMessageMedia`, { method: 'POST', body: form }).catch(() => null);
              const tgD = tgR ? await tgR.json().catch(() => ({ ok: false })) as any : { ok: false };
              console.log(`[autopost] terminata Telegram: ok=${tgD.ok}${tgD.ok ? '' : ' err=' + tgD.description}`);
            } else if (termCaption !== undefined) {
              // Nessuna nuova immagine ma cambio testo
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
            if (cfg.emojiAnimated?.enabled !== false) {
              // buildMessage restituisce emoji raw — serve wrappare in <tg-emoji> prima di applyCustomEmoji.
              // 'append'/'only': usa termCaption (nuovo testo).
              // 'keep' + termImg: ricostruisce la caption originale (editMessageMedia ha perso le entità).
              let htmlToWrap: string | undefined = termCaption;
              if (htmlToWrap === undefined && termImg) {
                const keepLayoutId = (pub as any).layoutId ?? null;
                const [keepLayout] = keepLayoutId ? await sql`
                  SELECT body FROM layouts WHERE id = ${keepLayoutId}
                    AND (user_id = ${userId} OR user_id = ${baseUserId})
                `.catch(() => [null]) : [null];
                if (keepLayout?.body) {
                  const keepTagRows = await sql`
                    SELECT name, value FROM tags
                    WHERE user_id = ${userId} OR user_id = ${baseUserId}
                    ORDER BY (user_id = ${userId}) ASC
                  `.catch(() => []);
                  const keepTags: Record<string, string> = {};
                  for (const t of keepTagRows) keepTags[t.name as string] = t.value as string;
                  const keepAffUrl = String(pub.sourceUrl ?? '');
                  const keepPtUrl = ptTermConfig && pub.platform === 'amazon'
                    ? await wrapWithPostTap(keepAffUrl, String(pub.title ?? ''), ptTermConfig, { userId, botToken })
                    : keepAffUrl;
                  htmlToWrap = buildMessage(String(keepLayout.body), pub as any, keepPtUrl, undefined, keepTags);
                }
              }
              if (htmlToWrap) {
                const pubEmojiRows = await sql`
                  SELECT emoji_char, custom_emoji_id FROM emoji_ids
                  WHERE user_id = ${userId} OR user_id = ${baseUserId}
                  ORDER BY (user_id = ${userId}) DESC
                `.catch(() => [] as any[]);
                let wrappedHtml = htmlToWrap;
                for (const { emoji_char, custom_emoji_id } of pubEmojiRows as { emoji_char: string; custom_emoji_id: string }[]) {
                  if (emoji_char && custom_emoji_id && wrappedHtml.includes(emoji_char)) {
                    wrappedHtml = wrappedHtml.split(emoji_char).join(`<tg-emoji emoji-id="${custom_emoji_id}">${emoji_char}</tg-emoji>`);
                  }
                }
                applyCustomEmoji({ baseUserId, chatId: chatIdStr, messageId: msgIdNum, htmlText: wrappedHtml, enabled: true }).catch(() => {});
              }
            }
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
