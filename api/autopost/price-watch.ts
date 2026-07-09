import sql from '../../lib/db.js';
import { generateTerminataImageServer } from '../_imageServer.js';
import { checkPostPrice } from '../_priceCheck.js';

// In-memory: timestamp dell'ultimo check per ogni post (reset al riavvio)
const lastChecked = new Map<string, number>(); // postId → ms

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
// checkPostPrice è più affidabile perché usa l'API Amazon ufficiale e non soffre di cache HTML.
async function getCurrentPrice(post: any, cfg: Record<string, any>): Promise<number | null> {
  // checkPostPrice restituisce sempre currentPrice se riesce a ottenerlo, anche quando valid=true
  const check = await checkPostPrice(post, cfg).catch(() => null);
  if (check?.currentPrice != null) return check.currentPrice;

  // Fallback: scraping HTML
  const mktCode = (cfg.amazon?.marketplace || 'IT').toUpperCase();
  const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
  return scrapeAmazonPrice(domain, String(post.productId));
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
  const [termTagRow] = await sql`
    SELECT value FROM tags
    WHERE name = '{terminata}' AND (user_id = ${post.user_id} OR user_id = ${baseUserId})
    ORDER BY (user_id = ${post.user_id}) DESC LIMIT 1
  `.catch(() => [null]);
  const terminataText = String(termTagRow?.value ?? '❌ Offerta terminata');

  let termImg: Buffer | null = null;
  if (post.image && String(post.image).startsWith('http')) {
    termImg = await generateTerminataImageServer(String(post.image), termCfg).catch((e: any) => {
      console.warn('[price-watch] terminata img:', e?.message ?? e);
      return null;
    });
  }

  let caption: string | undefined;
  if (telegramMode === 'only') caption = terminataText;
  else if (telegramMode === 'append') caption = terminataText;

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
      console.log(`[price-watch] Telegram: ok=${tgD.ok}${tgD.ok ? '' : ' err=' + tgD.description}`);
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
  console.log(`[price-watch] terminato: ${post.id} (${post.productId} ${Number(post.discountedPrice)}→${currentPrice})`);
}

export async function runPriceWatchCheck() {
  const now = Date.now();

  const posts = await sql<any[]>`
    SELECT id, user_id, product_id AS "productId", platform,
           discounted_price::float AS "discountedPrice",
           original_price::float AS "originalPrice",
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
  const runPriceCache = new Map<string, number | null>(); // productId → currentPrice o null

  for (const post of posts) {
    if (!post.productId) continue;

    const [cfgRow] = await sql<{ data: any }[]>`
      SELECT data FROM settings WHERE user_id = ${post.user_id}
    `.catch(() => []);
    const cfg = cfgRow?.data ?? {};

    const storedPrice = Number(post.discountedPrice);
    let currentPrice: number | null;

    if (runPriceCache.has(post.productId)) {
      // Prezzo già noto per questo ASIN nel run corrente
      currentPrice = runPriceCache.get(post.productId) ?? null;
      console.log(`[price-watch] ${post.productId}: cache current=${currentPrice ?? '?'}`);
    } else {
      // Primo incontro di questo ASIN: rispetta il cooldown per post singoli
      const lastTime = lastChecked.get(post.id) ?? 0;
      if (now - lastTime < 90_000) continue;
      lastChecked.set(post.id, now);

      currentPrice = await getCurrentPrice(post, cfg);
      console.log(`[price-watch] ${post.productId}: stored=${storedPrice} current=${currentPrice ?? '?'}`);

      // Salva in cache: il prezzo trovato se è aumentato, null altrimenti
      runPriceCache.set(
        post.productId,
        (currentPrice !== null && currentPrice > storedPrice * 1.02) ? currentPrice : null,
      );
    }

    if (currentPrice === null) continue;
    if (currentPrice <= storedPrice * 1.02) continue;

    // Aggiorna il cooldown anche per i post trovati tramite cache
    lastChecked.set(post.id, now);

    await terminatePost(post, currentPrice, cfg);
  }
}

export default async function handler(req: any, res: any) {
  await runPriceWatchCheck();
  res.json({ ok: true });
}
