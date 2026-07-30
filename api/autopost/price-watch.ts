import sql from '../../lib/db.js';
import { generateTerminataImageServer } from '../_imageServer.js';
import { buildMessage } from '../_buildMessage.js';
import { checkPostPrice } from '../_priceCheck.js';
import { generateTemplateImageServer, parseTemplateCfg } from './publish.js';
import { applyCustomEmoji } from '../../lib/applyCustomEmoji.js';

// In-memory: timestamp dell'ultimo check per ogni post (reset al riavvio)
const lastChecked = new Map<string, number>(); // postId → ms
// Contatore di risultati null consecutivi per postId: dopo 3 null → termina
const nullHits = new Map<string, number>(); // postId → count

const MARKETPLACE_DOMAINS: Record<string, string> = {
  IT: 'www.amazon.it', US: 'www.amazon.com', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', ES: 'www.amazon.es', UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca',
};

async function scrapeAmazonPrice(domain: string, asin: string): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://${domain}/dp/${asin}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const html = await r.text();

    const parsePx = (s: string) => parseFloat(s.replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
    let price = 0;

    const offscreen = [...html.matchAll(/class="a-offscreen">([^<]+)</g)];
    if (offscreen[0]) price = parsePx(offscreen[0][1]);
    if (!price) {
      const ldM = html.match(/"@type"\s*:\s*"Offer"[^}]*?"price"\s*:\s*"?([\d]+(?:[.,][\d]+)?)"?/);
      if (ldM) price = parsePx(ldM[1]);
    }
    if (!price) {
      const cpM = html.match(/"priceAmount"\s*:\s*([\d]+(?:\.\d+)?)/);
      if (cpM) price = parseFloat(cpM[1]) || 0;
    }

    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

// Ottieni prezzo corrente: prima PA API (via checkPostPrice), poi scraping HTML come fallback.
// Ritorna { price, unavailable } — unavailable=true se il prodotto non è più su Amazon.
async function getCurrentPrice(post: any, cfg: Record<string, any>): Promise<{ price: number | null; unavailable: boolean }> {
  const check = await checkPostPrice(post, cfg).catch(() => null);
  // valid:false dalla PA API = prodotto non più disponibile → termina subito
  if (check?.valid === false) return { price: null, unavailable: true };
  if (check?.currentPrice != null) return { price: check.currentPrice, unavailable: false };

  const mktCode = (cfg.amazon?.marketplace || 'IT').toUpperCase();
  const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
  const price = await scrapeAmazonPrice(domain, String(post.productId));
  return { price, unavailable: false };
}

async function terminatePost(post: any, currentPrice: number, cfg: Record<string, any>) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    await sql`UPDATE published_posts SET terminata = true WHERE id = ${post.id}`.catch(() => {});
    console.log(`[price-watch] terminato (no token) ${post.id}`);
    return;
  }

  const tgBase = `https://api.telegram.org/bot${botToken}`;
  const termCfg = (cfg.terminata ?? {}) as Record<string, any>;
  const telegramMode = String(termCfg.telegramMode ?? 'keep');
  const chatId = String(post.chatId ?? '');
  const msgId  = Number(post.messageId ?? 0);

  const baseUserId = String(post.user_id).split(':')[0];

  // Recupera tag {terminata} per questo utente
  const [termTagRow] = await sql`
    SELECT value FROM tags
    WHERE name = '{terminata}' AND (user_id = ${post.user_id} OR user_id = ${baseUserId})
    ORDER BY (user_id = ${post.user_id}) DESC LIMIT 1
  `.catch(() => [null]);
  const terminataText = String(termTagRow?.value ?? '❌ Offerta terminata');

  // Genera immagine terminata (grayscale + overlay) rispettando le impostazioni template
  // Se overlayText non è configurato, usa il valore del tag {terminata} come fallback
  const effectiveTermCfg: Record<string, any> = {
    grayscale: true,
    overlayTextColor: '#ff0000',
    overlayTextSize: 7,
    overlayTextX: 50,
    overlayTextY: 50,
    ...termCfg,
    overlayText: termCfg.overlayText || terminataText,
  };
  let termImg: Buffer | null = null;
  if (post.image && String(post.image).startsWith('http')) {
    // Prima genera l'immagine con il template (prezzi, logo, ecc.), poi applica B&N + overlay
    let baseImage: string | Buffer = String(post.image);
    try {
      const [tplRow] = await sql`
        SELECT id, config FROM templates
        WHERE (user_id = ${post.user_id} OR user_id = ${baseUserId})
          AND tipo NOT IN ('historical_low')
        ORDER BY (user_id = ${post.user_id}) DESC, (tipo = 'normal') DESC, updated_at DESC NULLS LAST, created_at DESC LIMIT 1
      `.catch(() => [null]);
      console.log(`[price-watch] terminata: template trovato? id=${tplRow?.id ?? 'NO'} user_id=${post.user_id} baseUserId=${baseUserId}`);
      if (tplRow) {
        const tplCfg = parseTemplateCfg(tplRow);
        console.log(`[price-watch] terminata: parseTemplateCfg → ${tplCfg ? 'OK (keys=' + Object.keys(tplCfg).join(',') + ')' : 'null'}`);
        if (tplCfg) {
          const currSym = post.platform === 'aliexpress' ? '$' : '€';
          const tplDataUrl = await generateTemplateImageServer(
            tplCfg,
            String(post.image),
            String(post.platform ?? 'amazon'),
            {
              prezzo:           `${currSym}${Number(post.discountedPrice).toFixed(2)}`,
              prezzoPrecedente: `${currSym}${Number(post.originalPrice).toFixed(2)}`,
              sconto:           `-${Number(post.discountPercent)}%`,
            },
          ).catch((tplErr: any) => {
            console.warn(`[price-watch] terminata: generateTemplateImageServer ERRORE — ${tplErr?.message ?? tplErr}`);
            return null;
          });
          console.log(`[price-watch] terminata: generateTemplateImageServer → ${tplDataUrl ? 'OK (' + String(tplDataUrl).slice(0, 50) + '…)' : 'null'}`);
          if (tplDataUrl) {
            const b64 = String(tplDataUrl).replace(/^data:image\/\w+;base64,/, '');
            baseImage = Buffer.from(b64, 'base64');
            console.log(`[price-watch] terminata: immagine template generata per ${post.productId} (${(baseImage as Buffer).length} bytes)`);
          } else {
            console.warn(`[price-watch] terminata: generateTemplateImageServer ha restituito null — uso immagine prodotto grezza`);
          }
        } else {
          console.warn(`[price-watch] terminata: parseTemplateCfg null — uso immagine prodotto grezza`);
        }
      } else {
        console.warn(`[price-watch] terminata: nessun template trovato in DB — uso immagine prodotto grezza`);
      }
    } catch (e: any) {
      console.warn('[price-watch] terminata: errore generazione template —', e?.message ?? e);
    }
    termImg = await generateTerminataImageServer(baseImage, effectiveTermCfg).catch((e: any) => {
      console.warn('[price-watch] terminata img:', e?.message ?? e);
      return null;
    });
  }

  // Recupera layout e tag sempre — servono sia per 'append' che per re-applicare emoji in 'keep'
  const layoutIdToUse = post.layoutId ?? termCfg.layoutId ?? null;
  const [termLayoutRow] = layoutIdToUse ? await sql`
    SELECT body FROM layouts WHERE id = ${layoutIdToUse}
      AND (user_id = ${post.user_id} OR user_id = ${baseUserId})
  `.catch(() => [null]) : [null];

  const tagRows = await sql`
    SELECT name, value FROM tags
    WHERE user_id = ${post.user_id} OR user_id = ${baseUserId}
    ORDER BY (user_id = ${post.user_id}) ASC
  `.catch(() => []);
  const customTags: Record<string, string> = {};
  for (const tr of tagRows) customTags[tr.name as string] = tr.value as string;

  const mktCode = (cfg.amazon?.marketplace || 'IT').toUpperCase();
  const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
  const affUrl = post.sourceUrl
    || (post.productId ? `https://${domain}/dp/${post.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}` : '');

  // customText è "errore di prezzo" — nel post terminato lo azzeriamo
  const postForCaption = { ...post, customText: '' };
  // Testo originale del post (senza marcatore terminata) — usato per re-applicare emoji in keep
  const originalCaption = termLayoutRow?.body
    ? buildMessage(String(termLayoutRow.body), postForCaption, affUrl, undefined, customTags)
    : '';

  // Costruisce caption Telegram rispettando telegramMode
  let caption: string | undefined;
  if (telegramMode === 'only') {
    caption = terminataText;
  } else if (telegramMode === 'append') {
    const builtCaption = termLayoutRow?.body
      ? buildMessage(String(termLayoutRow.body), postForCaption, affUrl, undefined, customTags, terminataText)
      : '';
    caption = builtCaption || terminataText;
  }
  // 'keep' → caption undefined, non modifica il testo Telegram

  if (chatId && msgId) {
    if (termImg) {
      const mediaObj: Record<string, any> = { type: 'photo', media: 'attach://photo', parse_mode: 'HTML' };
      if (caption !== undefined) mediaObj.caption = caption.slice(0, 1024);
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('message_id', String(msgId));
      form.append('media', JSON.stringify(mediaObj));
      form.append('photo', new Blob([termImg], { type: 'image/jpeg' }), 'photo');
      const tgR = await fetch(`${tgBase}/editMessageMedia`, { method: 'POST', body: form }).catch(() => null);
      const tgD = tgR ? await tgR.json().catch(() => ({ ok: false })) as any : { ok: false };
      console.log(`[price-watch] Telegram editMessageMedia: ok=${tgD.ok}${tgD.ok ? '' : ' err=' + tgD.description}`);
    } else if (caption !== undefined) {
      const tgBody = { chat_id: chatId, message_id: msgId, caption: caption.slice(0, 1024), parse_mode: 'HTML' };
      const tgR = await fetch(`${tgBase}/editMessageCaption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tgBody),
      }).catch(() => null);
      const tgD = tgR ? await tgR.json().catch(() => ({ ok: false })) as any : { ok: false };
      if (!tgD.ok) {
        await fetch(`${tgBase}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: msgId, text: terminataText.slice(0, 4096), parse_mode: 'HTML' }),
        }).catch(() => {});
      }
    }
  }

  await sql`UPDATE published_posts SET terminata = true WHERE id = ${post.id}`.catch(() => {});

  // Re-applica emoji animate MTProto dopo ogni edit Bot API (le entità custom vengono perse).
  // 'keep' con immagine: usa testo originale (invariato nel messaggio ma entità perse per editMedia)
  // 'append'/'only': usa il nuovo testo del messaggio
  const htmlForEmoji = caption ?? (termImg && originalCaption ? originalCaption : undefined);
  if (htmlForEmoji && chatId && msgId && cfg.emojiAnimated?.enabled !== false) {
    applyCustomEmoji({ baseUserId, chatId: String(chatId), messageId: Number(msgId), htmlText: htmlForEmoji, enabled: true }).catch(() => {});
  }
  console.log(`[price-watch] terminato: ${post.id} (${post.productId} ${Number(post.discountedPrice)}→${currentPrice})`);
}

export async function runPriceWatchCheck() {
  const now = Date.now();

  const posts = await sql<any[]>`
    SELECT id, user_id, product_id AS "productId", platform,
           discounted_price::float AS "discountedPrice",
           original_price::float AS "originalPrice",
           discount_percent AS "discountPercent",
           title, source_url AS "sourceUrl",
           custom_text AS "customText",
           is_historical_low AS "isHistoricalLow",
           emoji,
           image, chat_id AS "chatId", message_id AS "messageId",
           layout_id AS "layoutId"
    FROM published_posts
    WHERE NOT COALESCE(terminata, false)
      AND COALESCE(is_multi, false) = false
      AND platform = 'amazon'
      AND published_at >= now() - interval '24 hours'
      AND (
        custom_text ILIKE '%errore%' OR
        custom_text ILIKE '%attenzione%' OR
        custom_text ILIKE '%probabile%'
      )
    ORDER BY published_at DESC
    LIMIT 30
  `.catch(() => []);

  if (posts.length === 0) return;
  console.log(`[price-watch] ${posts.length} post da monitorare`);

  // Cache locale al run: productId → prezzo corrente trovato.
  // Evita di riscrape lo stesso ASIN più volte nello stesso ciclo (es. stesso prodotto su più canali).
  const runPriceCache = new Map<string, number | null>();

  for (const post of posts) {
    if (!post.productId) continue;

    const [cfgRow] = await sql<{ data: any }[]>`
      SELECT data FROM settings WHERE user_id = ${post.user_id}
    `.catch(() => []);
    const cfg = cfgRow?.data ?? {};

    const storedPrice = Number(post.discountedPrice);
    let currentPrice: number | null;

    let unavailable = false;
    if (runPriceCache.has(post.productId)) {
      currentPrice = runPriceCache.get(post.productId) ?? null;
      console.log(`[price-watch] ${post.productId}: cache current=${currentPrice ?? '?'}`);
    } else {
      const lastTime = lastChecked.get(post.id) ?? 0;
      if (now - lastTime < 90_000) continue;
      lastChecked.set(post.id, now);

      const result = await getCurrentPrice(post, cfg);
      currentPrice = result.price;
      unavailable  = result.unavailable;
      console.log(`[price-watch] ${post.productId}: stored=${storedPrice} current=${currentPrice ?? '?'} unavailable=${unavailable}`);

      runPriceCache.set(
        post.productId,
        (currentPrice !== null && currentPrice > storedPrice * 1.02) ? currentPrice : null,
      );
    }

    // Prodotto non più disponibile su Amazon → termina subito
    if (unavailable) {
      console.log(`[price-watch] terminata (non disponibile): ${post.id} ${post.productId}`);
      nullHits.delete(post.id);
      await terminatePost(post, 0, cfg);
      continue;
    }

    // Prezzo non recuperabile: incrementa contatore null
    // Dopo 3 null consecutivi il prodotto è probabilmente sparito → termina
    if (currentPrice === null) {
      const hits = (nullHits.get(post.id) ?? 0) + 1;
      nullHits.set(post.id, hits);
      console.log(`[price-watch] ${post.productId}: null hit ${hits}/3`);
      if (hits >= 3) {
        console.log(`[price-watch] terminata (3 null consecutivi): ${post.id} ${post.productId}`);
        nullHits.delete(post.id);
        await terminatePost(post, 0, cfg);
      }
      continue;
    }

    // Prezzo recuperato → azzera contatore null
    nullHits.delete(post.id);

    if (currentPrice <= storedPrice * 1.02) continue;

    lastChecked.set(post.id, now);
    await terminatePost(post, currentPrice, cfg);
  }
}

export default async function handler(req: any, res: any) {
  await runPriceWatchCheck();
  res.json({ ok: true });
}
