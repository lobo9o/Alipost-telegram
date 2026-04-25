import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

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
