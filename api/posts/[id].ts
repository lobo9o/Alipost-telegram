import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

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

// ── Telegram entities per custom emoji animate ────────────────────────────────
interface TgEntity {
  type: string; offset: number; length: number;
  url?: string; custom_emoji_id?: string;
}

// Rimuove entità che terminano su un high surrogate (spezzerebbe la coppia UTF-16)
function sanitizeEntities(text: string, entities: TgEntity[]): TgEntity[] {
  return entities.map(e => {
    if (e.offset >= text.length) return null;
    let len = Math.min(e.length, text.length - e.offset);
    // Se l'ultimo char è un high surrogate (0xD800-0xDBFF), taglia prima
    if (len > 0 && (text.charCodeAt(e.offset + len - 1) & 0xFC00) === 0xD800) len--;
    return len > 0 ? { ...e, length: len } : null;
  }).filter(Boolean) as TgEntity[];
}

function parseHtmlToEntities(html: string, emojiIdMap?: Record<string, string>): { text: string; entities: TgEntity[] } {
  const entities: TgEntity[] = [];
  let text = '';
  let utf16Off = 0;
  const stack: Array<{ type: string; offset: number; url?: string; emojiId?: string }> = [];
  const HTML_ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  const TYPE_MAP: Record<string, string> = {
    b: 'bold', strong: 'bold', i: 'italic', em: 'italic',
    u: 'underline', s: 'strikethrough', strike: 'strikethrough', del: 'strikethrough',
    code: 'code', pre: 'pre', a: 'text_link',
  };
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { text += html[i]; utf16Off++; i++; continue; }
      const inner = html.slice(i + 1, end);
      const isClose = inner.startsWith('/');
      const tagStr  = isClose ? inner.slice(1).trim() : inner.trim();
      const tagName = tagStr.split(/[\s>/]/)[0].toLowerCase();
      if (isClose) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].type === tagName) {
            const e = stack.splice(j, 1)[0];
            const len = utf16Off - e.offset;
            if (len > 0) {
              const etype = e.emojiId ? 'custom_emoji' : (TYPE_MAP[tagName] ?? null);
              if (etype) {
                const ent: TgEntity = { type: etype, offset: e.offset, length: len };
                if (e.url)     ent.url             = e.url;
                if (e.emojiId) ent.custom_emoji_id = e.emojiId;
                entities.push(ent);
              }
            }
            break;
          }
        }
      } else {
        const urlMatch   = inner.match(/href="([^"]+)"/);
        const emojiMatch = inner.match(/data-emoji-id="([^"]+)"/);
        stack.push({ type: tagName, offset: utf16Off, url: urlMatch?.[1], emojiId: emojiMatch?.[1] });
      }
      i = end + 1;
    } else if (html[i] === '&') {
      const semi = html.indexOf(';', i);
      if (semi !== -1 && semi - i <= 6) {
        const raw = html.slice(i, semi + 1);
        if (HTML_ENT[raw]) { text += HTML_ENT[raw]; utf16Off++; i = semi + 1; continue; }
      }
      text += html[i]; utf16Off++; i++;
    } else {
      const cp = html.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      const isSuppl = cp > 0xFFFF;
      const chLen = isSuppl ? 2 : 1;
      const nextCp = html.codePointAt(i + chLen);
      const hasVS = nextCp === 0xFE0F || nextCp === 0xFE0E;
      const fullSeq = hasVS ? ch + String.fromCodePoint(nextCp!) : ch;
      const seqLen = chLen + (hasVS ? 1 : 0);
      const emojiId = emojiIdMap ? (emojiIdMap[fullSeq] ?? emojiIdMap[ch]) : undefined;
      if (emojiId) {
        entities.push({ type: 'custom_emoji', offset: utf16Off, length: seqLen, custom_emoji_id: emojiId });
      }
      text += fullSeq;
      utf16Off += seqLen;
      i        += seqLen;
    }
  }
  return { text, entities: sanitizeEntities(text, entities) };
}

function capWithEntities(text: string, entities: TgEntity[], maxLen: number): { text: string; entities: TgEntity[] } {
  if (text.length <= maxLen) return { text, entities: sanitizeEntities(text, entities) };
  let cut = maxLen - 1;
  // Se cut cade su un low surrogate (0xDC00-0xDFFF), arretra di 1 per non spezzare la coppia
  if ((text.charCodeAt(cut) & 0xFC00) === 0xDC00) cut--;
  const trimmed = text.slice(0, cut) + '…';
  return {
    text: trimmed,
    entities: sanitizeEntities(trimmed, entities
      .filter(e => e.offset < cut)
      .map(e => ({ ...e, length: Math.min(e.length, cut - e.offset) }))),
  };
}

function buildMessage(contenuto: string, post: Record<string, any>, affiliateUrl: string, currency?: string, customTags: Record<string, string> = {}): string {
  const now = new Date();
  const giorni = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
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
    ...customTags,
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
    const { chatId, messageId, newCaption, terminata, newImage } = req.body ?? {};
    if (!chatId || !messageId) { res.status(400).json({ error: 'chatId and messageId required' }); return; }
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) { res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN non configurato' }); return; }
    const tgBase = `https://api.telegram.org/bot${botToken}`;
    const caption = terminata
      ? `❌ <b>OFFERTA TERMINATA</b>\n\n${newCaption ?? ''}`.trim()
      : (newCaption ?? '');

    let tgRes: Response;
    let tgData: { ok: boolean; description?: string };

    if (newImage && typeof newImage === 'string' && newImage.startsWith('data:')) {
      // Invia nuova immagine con editMessageMedia
      const base64 = newImage.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64, 'base64');
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('message_id', String(messageId));
      // Includi caption solo se esplicitamente fornita o se è terminata — altrimenti Telegram mantiene il testo originale
      const mediaObj: Record<string, string> = { type: 'photo', media: 'attach://photo' };
      if (newCaption !== undefined || terminata) {
        mediaObj.caption = caption.slice(0, 1024);
        mediaObj.parse_mode = 'HTML';
      }
      form.append('media', JSON.stringify(mediaObj));
      form.append('photo', new Blob([imgBuffer], { type: 'image/jpeg' }), 'photo');
      tgRes = await fetch(`${tgBase}/editMessageMedia`, { method: 'POST', body: form });
      tgData = await tgRes.json() as { ok: boolean; description?: string };
    } else {
      // Try editMessageCaption first (photo), fall back to editMessageText
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
    }

    if (!tgData.ok) { res.status(500).json({ error: `Telegram: ${tgData.description ?? 'errore'}` }); return; }
    // Update terminata flag in DB
    if (terminata) {
      await sql`UPDATE published_posts SET terminata = true WHERE id = ${id} AND user_id = ${userId}`.catch(() => {});
    }
    res.json({ ok: true });
    return;
  }

  // ── POST — publish to Telegram ───────────────────────────────
  const { post, layoutContenuto, keyboardContenuto, generatedImage, disableNotification = true } = req.body ?? {};
  console.log('[publish] disableNotification from body:', req.body?.disableNotification, '→ resolved:', disableNotification);
  if (!post) { res.status(400).json({ error: 'post required' }); return; }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  console.log('[publish] start userId:', userId, 'botToken:', botToken ? `set(${botToken.length}chars)` : 'MISSING');
  if (!botToken) { res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN non configurato su Vercel → vai in Vercel Settings → Environment Variables' }); return; }

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

  const channels: string[] = Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];
  console.log('[publish] channels from settings:', channels);
  if (!channels.length) {
    res.status(400).json({ error: 'Nessun canale Telegram configurato. Vai in Impostazioni → Canali Telegram.' });
    return;
  }
  const channel = channels[0];

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

  let tgRes: Response;
  const hasImage = post.image && post.image !== 'placeholder.jpg' && post.image.startsWith('http');

  // Carica mappa emoji animate per questo utente
  const emojiRows = await sql`SELECT emoji_char, custom_emoji_id FROM emoji_ids WHERE user_id = ${userId}`.catch(() => []);
  const emojiIdMap: Record<string, string> = {};
  for (const er of emojiRows) emojiIdMap[er.emoji_char as string] = er.custom_emoji_id as string;

  // disable_notification: lo includiamo SOLO quando true (silenzioso).
  console.log('[publish] disable_notification final:', disableNotification);

  // Parsa HTML → testo piano + entità (necessario per custom emoji animate)
  const parsedMsg = parseHtmlToEntities(messageText, emojiIdMap);
  const hasCustomEmoji = parsedMsg.entities.some(e => e.type === 'custom_emoji');

  if (generatedImage && typeof generatedImage === 'string' && generatedImage.startsWith('data:')) {
    const base64 = generatedImage.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('chat_id', channel);
    form.append('photo', new Blob([imgBuffer], { type: 'image/jpeg' }), 'post.jpg');
    if (hasCustomEmoji) {
      const { text: ct, entities: ce } = capWithEntities(parsedMsg.text, parsedMsg.entities, 1024);
      form.append('caption', ct);
      form.append('caption_entities', JSON.stringify(ce));
    } else {
      form.append('caption', safeCaption(messageText, 1024));
      form.append('parse_mode', 'HTML');
    }
    if (disableNotification) form.append('disable_notification', 'true');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    tgRes = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: form });
  } else {
    if (hasImage) {
      const captionFields = hasCustomEmoji
        ? (() => { const { text: ct, entities: ce } = capWithEntities(parsedMsg.text, parsedMsg.entities, 1024); return { caption: ct, caption_entities: ce }; })()
        : { caption: safeCaption(messageText, 1024), parse_mode: 'HTML' };
      tgRes = await fetch(`${tgBase}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channel,
          photo: post.image,
          ...captionFields,
          ...(disableNotification ? { disable_notification: true } : {}),
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
    } else {
      const textFields = hasCustomEmoji
        ? (() => { const { text: mt, entities: me } = capWithEntities(parsedMsg.text, parsedMsg.entities, 4096); return { text: mt, entities: me }; })()
        : { text: messageText, parse_mode: 'HTML' };
      tgRes = await fetch(`${tgBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channel,
          ...textFields,
          ...(disableNotification ? { disable_notification: true } : {}),
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
    }
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
