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
    // Fetch all today's Amazon published posts with productId
    const posts = await sql`
      SELECT id, user_id, product_id, discounted_price, platform, chat_id, message_id
      FROM published_posts
      WHERE published_at::date = CURRENT_DATE
        AND platform = 'amazon'
        AND product_id <> ''
        AND terminata = false
    `;
    // Batch ASINs in groups of 10 (PA-API limit)
    const results: { id: string; priceChanged: boolean; newPrice?: number }[] = [];
    const PA_KEY = process.env.AMAZON_ACCESS_KEY;
    const PA_SECRET = process.env.AMAZON_SECRET_KEY;
    const PA_TAG = process.env.AMAZON_PARTNER_TAG;
    if (PA_KEY && PA_SECRET && PA_TAG && posts.length > 0) {
      const chunks: typeof posts[0][][] = [];
      for (let i = 0; i < posts.length; i += 10) chunks.push(posts.slice(i, i + 10));
      for (const chunk of chunks) {
        // Placeholder: actual PA-API call via product.ts logic would go here.
        // For now mark as processed — full implementation requires PA-API signing.
        for (const post of chunk) results.push({ id: post.id as string, priceChanged: false });
        await new Promise(r => setTimeout(r, 1100)); // 1 req/sec safety delay between batches
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
