import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

// ── Ensure published_posts table exists (idempotent) ─────────────────────────
async function ensurePublishedTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS published_posts (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      emoji             TEXT DEFAULT '',
      title             TEXT DEFAULT '',
      image             TEXT DEFAULT '',
      original_price    FLOAT DEFAULT 0,
      discounted_price  FLOAT DEFAULT 0,
      discount_percent  INT DEFAULT 0,
      platform          TEXT DEFAULT 'amazon',
      source_url        TEXT DEFAULT '',
      product_id        TEXT DEFAULT '',
      custom_text       TEXT DEFAULT '',
      layout_id         TEXT DEFAULT '',
      is_historical_low BOOLEAN DEFAULT false,
      chat_id           TEXT DEFAULT '',
      message_id        BIGINT DEFAULT 0,
      terminata         BOOLEAN DEFAULT false,
      published_at      TIMESTAMP WITH TIME ZONE DEFAULT now()
    )
  `;
}

const TOKEN_URLS: Record<string, string> = {
  '2.1': 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token',
  '2.2': 'https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token',
  '2.3': 'https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token',
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};

async function getAmazonToken(credId: string, credSecret: string, version: string): Promise<string | null> {
  const url = TOKEN_URLS[version];
  if (!url) return null;
  try {
    let res: Response;
    if (version.startsWith('2')) {
      const basic = Buffer.from(`${credId}:${credSecret}`).toString('base64');
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${basic}` },
        body: 'grant_type=client_credentials&scope=creatorsapi%2Fdefault',
      });
    } else {
      // LWA (v3.x) — OAuth2 standard: form-encoded
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credId,
        client_secret: credSecret,
        scope: 'creatorsapi/default',
      });
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    }
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string };
    return data.access_token ?? null;
  } catch { return null; }
}

// Fetches current prices for up to 10 ASINs — returns { ASIN: price }
async function fetchAmazonPrices(
  asins: string[], credId: string, credSecret: string, tag: string, version: string, mktDomain: string,
): Promise<Record<string, number>> {
  const token = await getAmazonToken(credId, credSecret, version);
  if (!token) return {};
  try {
    const res = await fetch('https://creatorsapi.amazon/catalog/v1/getItems', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-marketplace': mktDomain,
        'User-Agent': 'creatorsapi-nodejs-sdk/1.2.0',
      },
      body: JSON.stringify({
        itemIds: asins,
        partnerTag: tag,
        partnerType: 'associates',
        resources: ['offersV2.listings.price'],
      }),
    });
    if (!res.ok) return {};
    const data = await res.json() as any;
    const items: any[] = data?.itemsResult?.items ?? data?.ItemsResult?.Items ?? [];
    const prices: Record<string, number> = {};
    for (const item of items) {
      const asin = (item.asin ?? item.ASIN ?? '').toUpperCase();
      const listings: any[] = item?.offersV2?.listings ?? item?.OffersV2?.Listings ?? [];
      const amount = listings[0]?.price?.money?.amount ?? listings[0]?.Price?.Money?.Amount ?? 0;
      if (asin && amount > 0) prices[asin] = Number(amount);
    }
    return prices;
  } catch { return {}; }
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildMessage(contenuto: string, post: Record<string, any>, affiliateUrl: string): string {
  let t = contenuto;
  t = t.replace(/\{titolo\}/g, esc(post.title));
  t = t.replace(/\{prezzo\}/g, `${Number(post.originalPrice).toFixed(2)}€`);
  t = t.replace(/\{prezzo_scontato\}/g, `<b>${Number(post.discountedPrice).toFixed(2)}€</b>`);
  t = t.replace(/\{sconto\}/g, `<b>${post.discountPercent}%</b>`);
  t = t.replace(/\{custom\}/g, esc(post.customText ?? ''));
  t = t.replace(/\{link_affiliato\}/g, `<a href="${affiliateUrl}">acquista qui</a>`);
  t = t.replace(/\{minimo_storico\}/g, post.isHistoricalLow ? '🏆 MINIMO STORICO!' : '');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return t;
}

const MARKETPLACE_DOMAINS: Record<string, string> = {
  IT: 'www.amazon.it', US: 'www.amazon.com', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', ES: 'www.amazon.es', UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca',
};

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  // ── Image proxy (no auth needed) ──────────────────────────────────────────
  if (req.method === 'GET' && req.query.img) {
    const url = req.query.img as string;
    if (!url.startsWith('http')) { res.status(400).json({ error: 'invalid url' }); return; }
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
    return;
  }

  // ── Price-check cron (triggered by Vercel Cron with CRON_SECRET) ──────────
  if (req.method === 'GET' && req.query.action === 'price-check') {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'unauthorized' }); return;
    }
    await ensurePublishedTable();

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgBase = botToken ? `https://api.telegram.org/bot${botToken}` : null;

    // Fetch today's active Amazon posts joined with user settings and layout body
    const posts = await sql`
      SELECT
        p.id, p.user_id, p.product_id,
        p.discounted_price, p.original_price, p.discount_percent,
        p.title, p.custom_text, p.source_url, p.is_historical_low,
        p.chat_id, p.message_id,
        s.data AS settings_data,
        l.body AS layout_body
      FROM published_posts p
      LEFT JOIN settings s ON s.user_id = p.user_id
      LEFT JOIN layouts l ON l.id = p.layout_id
      WHERE p.published_at::date = CURRENT_DATE
        AND p.platform = 'amazon'
        AND p.product_id <> ''
        AND p.terminata = false
    `;

    const results: { id: string; priceChanged: boolean; newPrice?: number }[] = [];

    // Group by user to share one token per user
    const byUser = new Map<string, typeof posts>();
    for (const post of posts) {
      const uid = post.user_id as string;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(post);
    }

    for (const [, userPosts] of byUser) {
      const rawData = userPosts[0].settings_data ?? {};
      const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;
      const userHasCreds = !!(cfg.amazon?.credentialId && cfg.amazon?.credentialSecret);
      const credId     = cfg.amazon?.credentialId     || process.env.AMAZON_CREDENTIAL_ID     || '';
      const credSecret = cfg.amazon?.credentialSecret || process.env.AMAZON_CREDENTIAL_SECRET || '';
      const tag        = cfg.amazon?.affiliateTag     || ''; // sempre dell'utente, nessun fallback
      const version    = userHasCreds
        ? (cfg.amazon?.version    || process.env.AMAZON_VERSION    || '2.2')
        : (process.env.AMAZON_VERSION                              || '2.2');
      const mktCode    = userHasCreds
        ? ((cfg.amazon?.marketplace || process.env.AMAZON_MARKETPLACE || 'IT').toUpperCase())
        : ((process.env.AMAZON_MARKETPLACE                           || 'IT').toUpperCase());
      const mktDomain  = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';

      if (!credId || !credSecret || !tag) {
        for (const p of userPosts) results.push({ id: p.id as string, priceChanged: false });
        continue;
      }

      // Batch in groups of 10
      const chunks: typeof posts[] = [];
      for (let i = 0; i < userPosts.length; i += 10) chunks.push(userPosts.slice(i, i + 10));

      for (const chunk of chunks) {
        const asins = chunk.map(p => p.product_id as string);
        const prices = await fetchAmazonPrices(asins, credId, credSecret, tag, version, mktDomain);

        for (const post of chunk) {
          const asin = (post.product_id as string).toUpperCase();
          const newPrice = prices[asin];
          const oldPrice = parseFloat(String(post.discounted_price));

          if (newPrice === undefined || Math.abs(newPrice - oldPrice) < 0.01) {
            results.push({ id: post.id as string, priceChanged: false });
            continue;
          }

          // Price changed — update DB
          const origPrice = parseFloat(String(post.original_price));
          const newPct = origPrice > newPrice ? Math.round((1 - newPrice / origPrice) * 100) : 0;
          await sql`
            UPDATE published_posts
            SET discounted_price = ${newPrice}, discount_percent = ${newPct}
            WHERE id = ${post.id as string}
          `.catch(() => {});

          results.push({ id: post.id as string, priceChanged: true, newPrice });

          // Edit Telegram message
          if (tgBase && post.chat_id && post.message_id) {
            const affiliateUrl = `https://${mktDomain}/dp/${asin}?tag=${tag}`;
            const defaultLayout = `🔥 <b>{titolo}</b>\n\n💰 {prezzo_scontato} <s>{prezzo}</s>\n🏷️ Sconto: -{sconto}\n\n{custom}`;
            const caption = buildMessage(
              (post.layout_body as string) || defaultLayout,
              {
                title: post.title, originalPrice: origPrice,
                discountedPrice: newPrice, discountPercent: newPct,
                customText: post.custom_text, isHistoricalLow: post.is_historical_low,
              },
              affiliateUrl,
            );

            let tgRes = await fetch(`${tgBase}/editMessageCaption`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: post.chat_id, message_id: post.message_id, caption: caption.slice(0, 1024), parse_mode: 'HTML' }),
            });
            let tgData = await tgRes.json() as { ok: boolean; description?: string };
            if (!tgData.ok && tgData.description?.includes('there is no caption')) {
              tgRes = await fetch(`${tgBase}/editMessageText`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: post.chat_id, message_id: post.message_id, text: caption.slice(0, 4096), parse_mode: 'HTML' }),
              });
              tgData = await tgRes.json() as { ok: boolean; description?: string };
            }
            if (!tgData.ok) console.error('[price-check] Telegram edit failed:', tgData.description);
          }
        }

        await new Promise(r => setTimeout(r, 1100)); // 1 req/sec between batches
      }
    }

    res.json({ ok: true, checked: results.length, changed: results.filter(r => r.priceChanged).length });
    return;
  }

  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  // ── Published posts (view=published) ──────────────────────────────────────
  if (req.query.view === 'published') {
    await ensurePublishedTable();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          id, emoji, title, image,
          original_price AS "originalPrice",
          discounted_price::text AS price,
          discounted_price AS "discountedPrice",
          discount_percent AS "discountPercent",
          platform,
          source_url AS "sourceUrl",
          product_id AS "productId",
          custom_text AS "customText",
          layout_id AS "layoutId",
          is_historical_low AS "isHistoricalLow",
          chat_id AS "chatId",
          message_id AS "messageId",
          terminata,
          published_at AS "publishedAt"
        FROM published_posts
        WHERE user_id = ${userId}
          AND published_at::date = CURRENT_DATE
        ORDER BY published_at DESC
      `;
      res.json(rows);
      return;
    }

    if (req.method === 'POST') {
      const p = req.body ?? {};
      await sql`
        INSERT INTO published_posts (
          id, user_id, emoji, title, image,
          original_price, discounted_price, discount_percent,
          platform, source_url, product_id, custom_text,
          layout_id, is_historical_low, chat_id, message_id
        ) VALUES (
          ${p.id}, ${userId}, ${p.emoji ?? ''}, ${p.title ?? ''}, ${p.image ?? ''},
          ${p.originalPrice ?? 0}, ${p.discountedPrice ?? parseFloat(p.price) ?? 0},
          ${p.discountPercent ?? 0},
          ${p.platform ?? 'amazon'}, ${p.sourceUrl ?? ''}, ${p.productId ?? ''},
          ${p.customText ?? ''}, ${p.layoutId ?? ''}, ${p.isHistoricalLow ?? false},
          ${p.chatId ?? ''}, ${p.messageId ?? 0}
        )
        ON CONFLICT (id) DO UPDATE SET
          chat_id = EXCLUDED.chat_id,
          message_id = EXCLUDED.message_id,
          custom_text = EXCLUDED.custom_text
      `;
      res.status(201).json({ ok: true });
      return;
    }
  }

  // ── Draft posts (default) ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT
        id, platform, source_url AS "sourceUrl", product_id AS "productId",
        title, image, original_price::float AS "originalPrice",
        discounted_price::float AS "discountedPrice", discount_percent AS "discountPercent",
        custom_text AS "customText", is_historical_low AS "isHistoricalLow",
        template_id AS "templateId", layout_id AS "layoutId", emoji
      FROM posts WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    res.json(rows);
    return;
  }

  const p = req.body ?? {};
  if (!p.id || !p.platform) { res.status(400).json({ error: 'id and platform required' }); return; }
  const [row] = await sql`
    INSERT INTO posts (
      id, user_id, platform, source_url, product_id, title, image,
      original_price, discounted_price, discount_percent,
      custom_text, is_historical_low, template_id, layout_id, emoji
    ) VALUES (
      ${p.id}, ${userId}, ${p.platform}, ${p.sourceUrl ?? ''}, ${p.productId ?? ''},
      ${p.title ?? ''}, ${p.image ?? ''},
      ${p.originalPrice ?? 0}, ${p.discountedPrice ?? 0}, ${p.discountPercent ?? 0},
      ${p.customText ?? ''}, ${p.isHistoricalLow ?? false},
      ${p.templateId ?? ''}, ${p.layoutId ?? ''}, ${p.emoji ?? ''}
    )
    RETURNING
      id, platform, source_url AS "sourceUrl", product_id AS "productId",
      title, image, original_price::float AS "originalPrice",
      discounted_price::float AS "discountedPrice", discount_percent AS "discountPercent",
      custom_text AS "customText", is_historical_low AS "isHistoricalLow",
      template_id AS "templateId", layout_id AS "layoutId", emoji
  `;
  res.status(201).json(row);
});
