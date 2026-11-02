import sql from '../../lib/db.js';

const CHANNEL_ID = '-1003593220674';

export async function cavalieriPostsHandler(req: any, res: any) {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = 24;
  const offset = (page - 1) * limit;

  const posts = await sql`
    SELECT
      id, title, emoji,
      generated_image   AS "generatedImage",
      image,
      discounted_price  AS "discountedPrice",
      original_price    AS "originalPrice",
      discount_percent  AS "discountPercent",
      source_url        AS "sourceUrl",
      platform,
      published_at      AS "publishedAt",
      is_historical_low AS "isHistoricalLow"
    FROM published_posts
    WHERE chat_id = ${CHANNEL_ID}
      AND terminata = false
    ORDER BY published_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(posts);
}
