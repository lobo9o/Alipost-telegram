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

  // Step 2: composita testo SVG sopra l'immagine in scala di grigi
  if (!config.overlayText) return step1;

  const fs  = Math.round(((Number(config.overlayTextSize) || 7) / 100) * SIZE);
  const tx  = Math.round(((Number(config.overlayTextX)    || 50) / 100) * SIZE);
  const ty  = Math.round(((Number(config.overlayTextY)    || 50) / 100) * SIZE);
  const sw  = Math.round(fs * 0.08);
  const col = String(config.overlayTextColor ?? '#ff0000');
  const txt = String(config.overlayText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    '{minimo_storico}':  post.isHistoricalLow ? '🏆 MINIMO STORICO!' : '',
    '{custom}':          esc(post.customText || ''),
    '{store}':           post.platform === 'amazon' ? 'Amazon' : 'AliExpress',
    '{storeup}':         post.platform === 'amazon' ? 'AMAZON' : 'ALIEXPRESS',
    '{countryflag}':     post.platform === 'aliexpress' ? '🇨🇳' : '🇮🇹',
    '{giorno}':          giorni[now.getDay()],
    '{ora}':             `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    '{data}':            `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    '{stelle}':          post.stelle || '',
    '{recensioni}':      post.recensioni || '',
    '{cat}':             post.cat || '',
    '{author}':          esc(post.author || ''),
    '{coupon}':          post.coupon || '',
    '{boxcoupon}':       post.coupon || '',
    '{checkout}':        '',
    // Tag personalizzati (con eventuali override per-post)
    ...customTags,
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
    // Pulizia storico prezzi oltre 180 giorni (fire-and-forget)
    sql`DELETE FROM price_history WHERE recorded_at < now() - interval '180 days'`.catch(() => {});
    migrationDone = true;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) { res.json({ ok: true, note: 'TELEGRAM_BOT_TOKEN non configurato' }); return; }
  const tgBase = `https://api.telegram.org/bot${botToken}`;

  const settingsRows = await sql`SELECT user_id, data FROM settings WHERE user_id IS NOT NULL`;

  const published: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const row of settingsRows) {
    const userId = row.user_id as string;
    const rawData = row.data ?? {};
    const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

    // AutoPost disabilitato
    if (!cfg.attivo) { skipped.push(`${userId}: disabled`); continue; }

    const oraI   = cfg.oraI   ?? '08:00';
    const oraF   = cfg.oraF   ?? '22:00';
    const interv = Math.max(1, Number(cfg.interv ?? 60));
    const channels: string[] = Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];

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
          fields: 'product_id,product_title,product_main_image_url,target_sale_price,target_original_price,target_sale_price_currency,discount,promotion_link',
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
          const autoPostId = crypto.randomUUID();
          post = {
            id: crypto.randomUUID(), platform: 'aliexpress',
            sourceUrl: affUrl, productId: String(candidate.product_id),
            title: candidate.product_title ?? '',
            image: candidate.product_main_image_url ?? '',
            originalPrice: origPrice, discountedPrice: salePrice,
            discountPercent: discPct,
            customText: '', isHistoricalLow: false,
            templateId: 'tpl1', layoutId: '', keyboardId: '', emoji: '🔴',
          };
          queueItem = { id: autoPostId, posts: [post], silenzioso: null };
          postsArr  = [post];
          isMulti   = false;
          console.log(`[autopost] auto-search trovato: ${post.title?.slice(0, 50)}`);
        } else {
          console.log(`[autopost] auto-search: nessun prodotto nuovo trovato per userId=${userId}`);
        }
      }
    }

    if (!queueItem || !post) {
      skipped.push(`${userId}: coda vuota o tutti i prezzi scaduti`);
    } else {

    // ── Controlla minimo storico ──────────────────────────────────────────────
    if (post.productId && Number(post.discountedPrice ?? 0) > 0) {
      const [histRow] = await sql`
        SELECT MIN(price)::float AS min_price, COUNT(*)::int AS cnt
        FROM price_history WHERE product_id = ${post.productId} AND platform = ${post.platform}
      `.catch(() => [null]);
      if (histRow && Number(histRow.cnt) > 0 && Number(post.discountedPrice) <= Number(histRow.min_price)) {
        post = { ...post, isHistoricalLow: true };
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
      // Per post multiplo usa il layout di tipo 'multi'; altrimenti usa layoutId del post
      const [layoutRow] = isMulti
        ? await sql`SELECT body, keyboard_id FROM layouts WHERE user_id = ${userId} AND tipo = 'multi' ORDER BY created_at ASC LIMIT 1`
        : post.layoutId
          ? await sql`SELECT body, keyboard_id FROM layouts WHERE id = ${post.layoutId} AND user_id = ${userId}`
          : [null];

      // Tastiera: usa quella del layout se impostata, altrimenti quella del post
      const effectiveKeyboardId = layoutRow?.keyboard_id || post.keyboardId;
      const [keyboardRow] = effectiveKeyboardId ? await sql`
        SELECT body FROM keyboards WHERE id = ${effectiveKeyboardId} AND user_id = ${userId}
      ` : [null];

      // Carica tag personalizzati dell'utente + applica eventuali override per-post
      const tagRows = await sql`SELECT name, value FROM tags WHERE user_id = ${userId}`;
      const customTags: Record<string, string> = {};
      for (const t of tagRows) {
        const override = post.tagOverrides?.[t.name as string];
        customTags[t.name as string] = override !== undefined ? override : (t.value as string);
      }

      // Costruisce URL affiliato (primo post)
      let affiliateUrl: string = post.sourceUrl ?? '';
      if (!affiliateUrl && post.platform === 'amazon' && post.productId) {
        const mktCode = (cfg.amazon?.marketplace ?? 'IT').toUpperCase();
        const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
        affiliateUrl = `https://${domain}/dp/${post.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}`;
      }

      const aliCurrency = post.platform === 'aliexpress'
        ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€')
        : '€';

      let messageText: string;
      let replyMarkup: object | undefined;

      if (isMulti) {
        // ── Post multiplo ──
        const layoutText: string | undefined = layoutRow?.body;
        const defaultMultiLayout = '{_<b>{custom}</b>_}\n<b>{titoloshort}</b>\n💶 A soli: <b>{prezzo}{valuta}</b> invece di: <s>{oldprezzo}€</s>\n{_🎟 <b>Coupon:</b> {coupon}_}\n👉 <a href="{link}">APRI SU AMAZON</a>\n➿➿➿➿➿➿➿➿➿➿➿➿';

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
        replyMarkup = buildKeyboard(keyboardRow?.body, post, affiliateUrl)
          ?? (affiliateUrl ? { inline_keyboard: [[{ text: post.platform === 'amazon' ? '🛒 Acquista su Amazon' : '🛒 Acquista su AliExpress', url: affiliateUrl }]] } : undefined);
      }

      const channel = channels[0];
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

      const tgData = await tgRes.json() as {
        ok: boolean;
        result?: { message_id: number; chat?: { id: number } };
        description?: string;
      };

      if (!tgData.ok) throw new Error(`Telegram: ${tgData.description ?? 'errore sconosciuto'}`);

      const messageId = tgData.result?.message_id ?? 0;
      const chatId = String(tgData.result?.chat?.id ?? channel);

      // Salva in published_posts
      await sql`
        INSERT INTO published_posts (
          id, user_id, emoji, title, image,
          original_price, discounted_price, discount_percent,
          platform, source_url, product_id, custom_text,
          layout_id, is_historical_low, chat_id, message_id, published_at
        ) VALUES (
          ${post.id}, ${userId}, ${post.emoji ?? ''}, ${post.title ?? ''}, ${post.image ?? ''},
          ${post.originalPrice ?? 0}, ${post.discountedPrice ?? 0}, ${post.discountPercent ?? 0},
          ${post.platform ?? 'amazon'}, ${post.sourceUrl ?? ''}, ${post.productId ?? ''},
          ${post.customText ?? ''}, ${post.layoutId ?? ''}, ${post.isHistoricalLow ?? false},
          ${chatId}, ${messageId}, now()
        )
        ON CONFLICT (id) DO UPDATE SET
          chat_id = EXCLUDED.chat_id,
          message_id = EXCLUDED.message_id
      `.catch(() => {});

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
          AND published_at > now() - interval '48 hours'
          AND (last_checked_at IS NULL OR last_checked_at < now() - interval '1 hour')
        ORDER BY last_checked_at ASC NULLS FIRST
        LIMIT 3
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
  }

  res.json({ ok: true, published, skipped, errors });
});
