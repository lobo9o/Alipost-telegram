import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler } from '../_utils.js';
import { checkPostPrice } from '../_priceCheck.js';

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

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  // Vercel invia CRON_SECRET come Bearer token nell'header Authorization
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'unauthorized' }); return;
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
        SELECT id, posts FROM autopost_queue
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

    if (!queueItem || !post) { skipped.push(`${userId}: coda vuota o tutti i prezzi scaduti`); continue; }

    try {
      // Carica layout testo (con eventuale tastiera associata)
      const [layoutRow] = post.layoutId ? await sql`
        SELECT body, keyboard_id FROM layouts WHERE id = ${post.layoutId} AND user_id = ${userId}
      ` : [null];

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

      let tgRes: Response;
      if (hasGeneratedImage) {
        // Immagine con overlay generata dal browser — upload multipart
        const base64Data = String(post.generatedImage).replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const formData = new FormData();
        formData.append('chat_id', channel);
        formData.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');
        formData.append('caption', messageText.slice(0, 1024));
        formData.append('parse_mode', 'HTML');
        if (replyMarkup) formData.append('reply_markup', JSON.stringify(replyMarkup));
        tgRes = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: formData });
      } else if (hasUrlImage) {
        tgRes = await fetch(`${tgBase}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: channel,
            photo: post.image,
            caption: messageText.slice(0, 1024),
            parse_mode: 'HTML',
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
  }

  res.json({ ok: true, published, skipped, errors });
});
