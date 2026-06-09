import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';
import { getProductEmoji } from '../_titleFormat.js';

async function generateMultiImageServer(imageUrls: string[]): Promise<string | null> {
  const validUrls = imageUrls.filter(u => u && String(u).startsWith('http'));
  const n = validUrls.length;
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
    const base = await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    const composites: any[] = [];
    for (let i = 0; i < validUrls.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const itemsInRow = Math.min(cols, validUrls.length - row * cols);
      const rowOffsetX = Math.floor(((cols - itemsInRow) * cellSize) / 2);
      const cellX = rowOffsetX + col * cellSize;
      const cellY = row * cellSize;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(validUrls[i], { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
        clearTimeout(t);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const availW = cellSize - PAD * 2;
        const availH = cellSize - PAD * 2;
        const { data, info } = await sharp(buf).resize(availW, availH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
        composites.push({ input: data, left: cellX + PAD + Math.round((availW - info.width) / 2), top: cellY + PAD + Math.round((availH - info.height) / 2) });
      } catch { /* skip */ }
    }
    const result = await sharp(base).composite(composites).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${result.toString('base64')}`;
  } catch { return null; }
}

const MARKETPLACE_DOMAINS: Record<string, string> = {
  IT: 'www.amazon.it', US: 'www.amazon.com', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', ES: 'www.amazon.es', UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca',
};

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Tronca HTML rispettando i tag aperti: chiude tutti i tag prima di tagliare
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

const ALI_CURRENCY_SYM: Record<string, string> = {
  IT: '€', DE: '€', FR: '€', ES: '€', NL: '€',
  US: '$', BR: 'R$', UK: '£', RU: '₽', PL: 'zł',
};

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
  ZA: 'Sudafrica', NG: 'Nigeria', PK: 'Pakistan', BD: 'Bangladesh',
};

function codeToFlag(code?: string): string {
  if (!code || code.length !== 2) return '';
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

function codeToCountryName(code?: string): string {
  if (!code) return '';
  const upper = code.toUpperCase();
  return COUNTRY_IT[upper] ?? upper;
}

function buildMessage(contenuto: string, post: Record<string, any>, affiliateUrl: string, currency?: string, customTags: Record<string, string> = {}): string {
  const now = new Date();
  const giorni = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const pad = (n: number) => n < 10 ? `0${n}` : String(n);
  const valuta = currency ?? (post.platform === 'aliexpress' ? '$' : '€');
  const discPrice = Number(post.discountedPrice).toFixed(2).replace('.', ',');
  const origPrice = Number(post.originalPrice).toFixed(2).replace('.', ',');
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
    '{countryflag}':     post.shipFromCountry ? codeToFlag(post.shipFromCountry) : (post.platform === 'aliexpress' ? '' : '🇮🇹'),
    '{country}':         post.shipFromCountry ? codeToCountryName(post.shipFromCountry) : (post.platform === 'aliexpress' ? '' : 'Italia'),
    '{countryup}':       (post.shipFromCountry ? codeToCountryName(post.shipFromCountry) : (post.platform === 'aliexpress' ? '' : 'Italia')).toUpperCase(),
    '{giorno}':          giorni[now.getDay()],
    '{ora}':             `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    '{data}':            `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    '{stelle}':          post.stelle || '',
    '{recensioni}':      post.recensioni || '',
    '{cat}':             post.cat || '',
    '{author}':          esc(post.author || ''),
    '{coupon}':          post.coupon || '',
    '{boxcoupon}':       (post as any).boxcoupon || '',
    '{checkout}':        (post as any).checkout || '',
    '{emojicat}':        getProductEmoji(post.title || '', post.cat || ''),
  };

  // Aggiunge tagOverrides per tag non già in tags (custom per-post)
  const tagOverrides = (post.tagOverrides ?? {}) as Record<string, string>;
  for (const [tagName, val] of Object.entries(tagOverrides)) {
    if (!(tagName in tags)) tags[tagName] = val || '';
  }


  const SENTINEL = '\x01';
  const knownTagNames = new Set(Object.keys(tags));

  function applyConditionals(text: string): string {
    let prev = '';
    let cur = text;
    while (prev !== cur) {
      prev = cur;
      cur = cur.replace(/\{_((?:(?!\{_)[\s\S])*?)_\}/g, (_, inner) => {
        let hasEmpty = false;
        let resolved = inner;
        for (const [tag, val] of Object.entries(tags)) {
          if (inner.includes(tag)) {
            if (!val || val.trim() === '') hasEmpty = true;
            resolved = resolved.split(tag).join(val);
          }
        }
        const found = inner.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [];
        for (const t of found) {
          if (!knownTagNames.has(t)) { hasEmpty = true; break; }
        }
        return hasEmpty ? SENTINEL : resolved;
      });
    }
    return cur;
  }

  let t = applyConditionals(contenuto);

  for (const [tag, val] of Object.entries(tags)) {
    t = t.split(tag).join(val);
  }
  // Tag {emoji_...} non risolti → rimuovi silenziosamente
  t = t.replace(/\{emoji_[a-zA-Z0-9_]+\}/g, '');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Rimuovi righe che contenevano solo blocchi condizionali vuoti
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
    '{link}':       affiliateUrl,
    '{link_affiliato}': affiliateUrl,
    '{whatsapp}':   `https://api.whatsapp.com/send?text=${waText}`,
    '{app}':        affiliateUrl,
    '{amici}':      affiliateUrl,
    '{grafico}':    affiliateUrl,
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

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST', 'PUT', 'DELETE', 'PATCH'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  // ── DELETE ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    await sql`DELETE FROM posts WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  // ── PUT — update post ────────────────────────────────────────
  if (req.method === 'PUT') {
    const p = req.body ?? {};
    const [row] = await sql`
      UPDATE posts SET
        title = ${p.title}, image = ${p.image},
        original_price = ${p.originalPrice}, discounted_price = ${p.discountedPrice},
        discount_percent = ${p.discountPercent}, custom_text = ${p.customText},
        is_historical_low = ${p.isHistoricalLow}, template_id = ${p.templateId},
        layout_id = ${p.layoutId}, emoji = ${p.emoji}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING
        id, platform, source_url AS "sourceUrl", product_id AS "productId",
        title, image, original_price::float AS "originalPrice",
        discounted_price::float AS "discountedPrice", discount_percent AS "discountPercent",
        custom_text AS "customText", is_historical_low AS "isHistoricalLow",
        template_id AS "templateId", layout_id AS "layoutId", emoji
    `;
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
    return;
  }

  // ── PATCH — edit already-published Telegram message ─────────
  if (req.method === 'PATCH') {
    const {
      action,
      chatId, messageId, newCaption, terminata, newImage,
      telegramMode, telegramText, layoutContenuto: patchLayout, postData,
      multiItemIndex, updatedFields,
    } = req.body ?? {};

    // ── action: editPublished — modifica completa di un post pubblicato ──────
    if (action === 'editPublished') {
      if (!chatId || !messageId) { res.status(400).json({ error: 'chatId and messageId required' }); return; }
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) { res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN non configurato' }); return; }
      const tgBase2 = `https://api.telegram.org/bot${botToken}`;
      const uf = updatedFields ?? {};

      // Aggiorna DB
      if (typeof multiItemIndex === 'number') {
        // Aggiorna un singolo item dentro multi_items
        await sql`
          UPDATE published_posts
          SET multi_items = jsonb_set(
            COALESCE(multi_items, '[]'::jsonb),
            ${sql`ARRAY[${String(multiItemIndex)}, 'title']`},
            ${sql`to_jsonb(${uf.title ?? ''}::text)`}
          )
          WHERE id = ${id} AND user_id = ${userId}
        `.catch(() => {});
        // Aggiorna i campi numerici e customText per il singolo item
        await sql`
          UPDATE published_posts
          SET multi_items = (
            SELECT jsonb_agg(
              CASE WHEN (elem->>'id') = ${uf.itemId ?? ''} OR idx = ${multiItemIndex}
              THEN elem || jsonb_build_object(
                'title', ${uf.title ?? ''}::text,
                'price', ${String(uf.discountedPrice ?? 0)},
                'originalPrice', ${Number(uf.originalPrice ?? 0)},
                'discountPercent', ${Number(uf.discountPercent ?? 0)},
                'customText', ${uf.customText ?? ''}::text
              )
              ELSE elem END
            )
            FROM jsonb_array_elements(COALESCE(multi_items, '[]'::jsonb)) WITH ORDINALITY AS t(elem, idx)
          )
          WHERE id = ${id} AND user_id = ${userId}
        `.catch(() => {});
      } else {
        // Aggiorna post singolo
        await sql`
          UPDATE published_posts SET
            title = ${uf.title ?? ''},
            original_price = ${Number(uf.originalPrice ?? 0)},
            discounted_price = ${Number(uf.discountedPrice ?? 0)},
            discount_percent = ${Number(uf.discountPercent ?? 0)},
            custom_text = ${uf.customText ?? ''},
            is_historical_low = ${uf.isHistoricalLow ?? false}
          WHERE id = ${id} AND user_id = ${userId}
        `.catch(() => {});
      }

      // Aggiorna Telegram — se c'è newImage usa editMessageMedia (sostituisce foto + didascalia)
      if (newImage && typeof newImage === 'string' && newImage.startsWith('data:')) {
        const base64ep = newImage.replace(/^data:image\/\w+;base64,/, '');
        const imgBufEp = Buffer.from(base64ep, 'base64');
        const formEp = new FormData();
        formEp.append('chat_id', chatId);
        formEp.append('message_id', String(messageId));
        const mediaObjEp: Record<string, string> = { type: 'photo', media: 'attach://photo' };
        if (newCaption) { mediaObjEp.caption = String(newCaption).slice(0, 1024); mediaObjEp.parse_mode = 'HTML'; }
        formEp.append('media', JSON.stringify(mediaObjEp));
        formEp.append('photo', new Blob([imgBufEp], { type: 'image/jpeg' }), 'photo.jpg');
        const tgRep = await fetch(`${tgBase2}/editMessageMedia`, { method: 'POST', body: formEp });
        const tgDep = await tgRep.json() as { ok: boolean; description?: string };
        if (!tgDep.ok) { res.status(500).json({ error: `Telegram: ${tgDep.description ?? 'errore'}` }); return; }
      } else if (newCaption) {
        // Solo testo
        const tgBody = { chat_id: chatId, message_id: messageId, caption: String(newCaption).slice(0, 1024), parse_mode: 'HTML' };
        let tgR = await fetch(`${tgBase2}/editMessageCaption`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tgBody) });
        let tgD = await tgR.json() as { ok: boolean; description?: string };
        if (!tgD.ok && tgD.description?.includes('there is no caption')) {
          tgR = await fetch(`${tgBase2}/editMessageText`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: String(newCaption).slice(0, 4096), parse_mode: 'HTML' }) });
          tgD = await tgR.json() as { ok: boolean; description?: string };
        }
        if (!tgD.ok) { res.status(500).json({ error: `Telegram: ${tgD.description ?? 'errore'}` }); return; }
      }
      res.json({ ok: true });
      return;
    }

    if (!chatId || !messageId) { res.status(400).json({ error: 'chatId and messageId required' }); return; }
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) { res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN non configurato' }); return; }
    const tgBase = `https://api.telegram.org/bot${botToken}`;

    // Determina caption in base alla modalità
    let caption: string | undefined;
    if (telegramMode === 'keep') {
      caption = undefined; // non toccare il testo
    } else if (telegramMode === 'only') {
      // Per multi-post con multiItemIndex: il frontend passa newCaption già costruito
      caption = newCaption !== undefined ? String(newCaption) : (telegramText ?? '');
    } else if (telegramMode === 'append') {
      if (newCaption !== undefined) {
        // Frontend ha già costruito il testo (es. per multi-post item)
        caption = String(newCaption);
      } else {
        // Ricostruisce il testo originale dal layout + dati post, poi aggiunge la scritta
        const defaultLayout = `🔥 <b>{titolo}</b>\n\n💰 {prezzo_scontato} <s>{oldprezzo}</s>\n🏷️ Sconto: -{sconto}\n\n{custom}`;
        const affiliateUrl = postData?.sourceUrl ?? '';
        const tagRows = await sql`SELECT name, value FROM tags WHERE user_id = ${userId} OR user_id = 'legacy' ORDER BY (user_id = ${userId}) ASC`;
        const customTags: Record<string, string> = {};
        for (const tr of tagRows) customTags[tr.name as string] = tr.value as string;
        const builtCaption = buildMessage(patchLayout || defaultLayout, postData ?? {}, affiliateUrl, undefined, customTags);
        caption = `${telegramText ?? ''}\n\n${builtCaption}`.trim();
      }
    } else {
      // Backward compat: vecchio formato con newCaption
      caption = terminata ? `❌ <b>OFFERTA TERMINATA</b>\n\n${newCaption ?? ''}`.trim() : (newCaption !== undefined ? String(newCaption) : undefined);
    }

    let tgRes: Response;
    let tgData: { ok: boolean; description?: string };

    if (newImage && typeof newImage === 'string' && newImage.startsWith('data:')) {
      const base64 = newImage.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64, 'base64');
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('message_id', String(messageId));
      const mediaObj: Record<string, string> = { type: 'photo', media: 'attach://photo' };
      if (caption !== undefined) {
        mediaObj.caption = caption.slice(0, 1024);
        mediaObj.parse_mode = 'HTML';
      }
      form.append('media', JSON.stringify(mediaObj));
      form.append('photo', new Blob([imgBuffer], { type: 'image/jpeg' }), 'photo');
      tgRes = await fetch(`${tgBase}/editMessageMedia`, { method: 'POST', body: form });
      tgData = await tgRes.json() as { ok: boolean; description?: string };
    } else if (caption !== undefined) {
      tgRes = await fetch(`${tgBase}/editMessageCaption`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: caption.slice(0, 1024), parse_mode: 'HTML' }),
      });
      tgData = await tgRes.json() as { ok: boolean; description?: string };
      if (!tgData.ok && tgData.description?.includes('there is no caption')) {
        tgRes = await fetch(`${tgBase}/editMessageText`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: caption.slice(0, 4096), parse_mode: 'HTML' }),
        });
        tgData = await tgRes.json() as { ok: boolean; description?: string };
      }
    } else {
      tgData = { ok: true }; // keep mode senza nuova immagine: niente da fare
    }

    // Aggiorna DB terminata SEMPRE (indipendentemente dal risultato Telegram)
    if (terminata) {
      if (typeof multiItemIndex === 'number') {
        // Marca solo il singolo item come terminato + aggiorna terminata row se tutti terminati
        await sql`
          UPDATE published_posts
          SET multi_items = (
            SELECT jsonb_agg(
              CASE WHEN idx - 1 = ${multiItemIndex}
              THEN elem || '{"terminata":true}'::jsonb
              ELSE elem END
            )
            FROM jsonb_array_elements(COALESCE(multi_items, '[]'::jsonb)) WITH ORDINALITY AS t(elem, idx)
          )
          WHERE id = ${id} AND user_id = ${userId}
        `.catch(() => {});
        // Se tutti gli item sono terminati, marca anche il post come terminato
        await sql`
          UPDATE published_posts
          SET terminata = true
          WHERE id = ${id} AND user_id = ${userId}
            AND (
              SELECT bool_and((elem->>'terminata')::boolean)
              FROM jsonb_array_elements(COALESCE(multi_items, '[]'::jsonb)) AS elem
            ) = true
        `.catch(() => {});
      } else {
        await sql`UPDATE published_posts SET terminata = true WHERE id = ${id} AND user_id = ${userId}`.catch(() => {});
      }
    }

    if (!tgData.ok) { res.status(500).json({ error: `Telegram: ${tgData.description ?? 'errore'}` }); return; }
    res.json({ ok: true });
    return;
  }

  // ── POST — publish to Telegram ───────────────────────────────
  const { post, layoutContenuto, keyboardContenuto, disableNotification = true, channelOverride: bodyChannel, multiImageUrls } = req.body ?? {};
  let { generatedImage } = req.body ?? {};
  console.log('[publish] disableNotification from body:', req.body?.disableNotification, '→ resolved:', disableNotification);
  if (!post) { res.status(400).json({ error: 'post required' }); return; }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  console.log('[publish] start userId:', userId, 'botToken:', botToken ? `set(${botToken.length}chars)` : 'MISSING');
  if (!botToken) { res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN non configurato su Vercel → vai in Vercel Settings → Environment Variables' }); return; }

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

  const envChannelOverride = process.env.CHANNEL_OVERRIDE || '';
  // Profili secondari: userId = "primaryId:channelId" — se channels non salvato usa il channelId dall'ID
  const channelFromId = userId.includes(':') ? userId.split(':')[1] : null;
  const cfgChannels = Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];
  const channels: string[] = envChannelOverride
    ? [envChannelOverride]
    : cfgChannels.length > 0 ? cfgChannels : channelFromId ? [channelFromId] : [];
  console.log('[publish] channels from settings:', channels, '| bodyChannel:', bodyChannel);
  if (!channels.length) {
    res.status(400).json({ error: 'Nessun canale Telegram configurato. Vai in Impostazioni → Canali Telegram.' });
    return;
  }
  // Se env override attivo, ignora la scelta dal body (sicurezza dev)
  const channel = envChannelOverride
    ? channels[0]
    : (bodyChannel ? String(bodyChannel) : channels[0]);
  console.log('[publish] channel selected:', channel);

  // Build affiliate URL
  let affiliateUrl: string = post.sourceUrl ?? '';
  if (!affiliateUrl && post.platform === 'amazon' && post.productId) {
    const mktCode = (cfg.amazon?.marketplace ?? 'IT').toUpperCase();
    const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
    affiliateUrl = `https://${domain}/dp/${post.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}`;
  }

  const defaultLayout = `🔥 <b>{titolo}</b>\n\n💰 {prezzo_scontato} <s>{prezzo}</s>\n🏷️ Sconto: -{sconto}\n\n{custom}`;
  const aliCurrency = post.platform === 'aliexpress'
    ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€')
    : '€';

  // Carica tag personalizzati dal DB (incluse emoji animate)
  const tagRows = await sql`
    SELECT name, value FROM tags
    WHERE user_id = ${userId} OR user_id = 'legacy'
    ORDER BY (user_id = ${userId}) ASC
  `;
  const customTags: Record<string, string> = {};
  for (const tr of tagRows) {
    customTags[tr.name as string] = tr.value as string;
  }

  const messageText = buildMessage(layoutContenuto || defaultLayout, post, affiliateUrl, aliCurrency, customTags);

  const replyMarkup = buildKeyboard(keyboardContenuto, post, affiliateUrl)
    ?? (affiliateUrl ? { inline_keyboard: [[{ text: post.platform === 'amazon' ? '🛒 Acquista su Amazon' : '🛒 Acquista su AliExpress', url: affiliateUrl }]] } : undefined);

  const tgBase = `https://api.telegram.org/bot${botToken}`;

  // Per multi post: genera composita server-side se multiImageUrls forniti e generatedImage mancante
  if (Array.isArray(multiImageUrls) && multiImageUrls.length > 1 && (!generatedImage || !String(generatedImage).startsWith('data:'))) {
    const composita = await generateMultiImageServer(multiImageUrls);
    if (composita) {
      generatedImage = composita;
      console.log(`[publish] composita multi generata server-side (${multiImageUrls.length} img)`);
    }
  }

  const hasImage = post.image && post.image !== 'placeholder.jpg' && post.image.startsWith('http');

  let tgRes: Response;
  if (generatedImage && typeof generatedImage === 'string' && generatedImage.startsWith('data:')) {
    const base64 = generatedImage.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('chat_id', channel);
    form.append('photo', new Blob([imgBuffer], { type: 'image/jpeg' }), 'post.jpg');
    form.append('caption', safeCaption(messageText, 1024));
    form.append('parse_mode', 'HTML');
    if (disableNotification) form.append('disable_notification', 'true');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    tgRes = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: form });
  } else if (hasImage) {
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
        text: messageText,
        parse_mode: 'HTML',
        ...(disableNotification ? { disable_notification: true } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  }

  const tgData = await tgRes.json() as { ok: boolean; result?: { message_id: number; chat?: { id: number } }; description?: string };
  console.log('[publish]', channel, hasImage ? 'photo' : 'text', tgRes.status, tgData.ok ? 'ok' : tgData.description);

  if (!tgData.ok) {
    res.status(500).json({ error: `Telegram: ${tgData.description ?? 'errore sconosciuto'}` });
    return;
  }

  const messageId = tgData.result?.message_id ?? 0;
  const chatId = String(tgData.result?.chat?.id ?? channel);
  res.json({ ok: true, messageId, chatId });
});
