import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db';
import { withErrorHandler, allowMethods } from '../_utils';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM posts WHERE id = ${id}`;
    res.json({ ok: true });
    return;
  }

  const p = req.body ?? {};
  const [row] = await sql`
    UPDATE posts SET
      title = ${p.title}, image = ${p.image},
      original_price = ${p.originalPrice}, discounted_price = ${p.discountedPrice},
      discount_percent = ${p.discountPercent}, custom_text = ${p.customText},
      is_historical_low = ${p.isHistoricalLow}, template_id = ${p.templateId},
      layout_id = ${p.layoutId}, emoji = ${p.emoji}
    WHERE id = ${id}
    RETURNING
      id, platform, source_url AS "sourceUrl", product_id AS "productId",
      title, image, original_price::float AS "originalPrice",
      discounted_price::float AS "discountedPrice", discount_percent AS "discountPercent",
      custom_text AS "customText", is_historical_low AS "isHistoricalLow",
      template_id AS "templateId", layout_id AS "layoutId", emoji
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});
