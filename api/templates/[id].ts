import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM templates WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  const { nome, tipo, overlay, badgeIcon, badgeEnabled,
          bgColor, productPos, overlayPos, badgePos } = req.body ?? {};
  const [row] = await sql`
    UPDATE templates SET
      nome = ${nome}, tipo = ${tipo},
      overlay = ${overlay ?? null},
      badge_icon = ${badgeIcon ?? null},
      badge_enabled = ${badgeEnabled},
      bg_color = ${bgColor ?? '#ffffff'},
      product_pos = ${sql.json(productPos ?? { x: 5, y: 5, size: 90 })},
      overlay_pos = ${sql.json(overlayPos ?? { x: 0, y: 0, size: 100 })},
      badge_pos   = ${sql.json(badgePos ?? { x: 3, y: 3, size: 25 })}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, nome, tipo, overlay,
              COALESCE(badge_icon, logo) AS "badgeIcon",
              badge_enabled AS "badgeEnabled",
              COALESCE(bg_color, '#ffffff') AS "bgColor",
              product_pos AS "productPos", overlay_pos AS "overlayPos", badge_pos AS "badgePos"
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});
