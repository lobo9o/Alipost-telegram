import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

function parsePos(v: unknown) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch {} }
  return null;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, nome, tipo, overlay,
             COALESCE(badge_icon, logo) AS "badgeIcon",
             badge_enabled AS "badgeEnabled",
             COALESCE(bg_color, '#ffffff') AS "bgColor",
             product_pos AS "productPos",
             overlay_pos AS "overlayPos",
             badge_pos   AS "badgePos"
      FROM templates WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    res.json(rows);
    return;
  }

  const { id, nome, tipo, overlay = null, badgeIcon = null, badgeEnabled = false,
          bgColor = '#ffffff', productPos = null, overlayPos = null, badgePos = null } = req.body ?? {};
  if (!id || !nome || !tipo) { res.status(400).json({ error: 'id, nome and tipo required' }); return; }
  const [row] = await sql`
    INSERT INTO templates (id, user_id, nome, tipo, overlay, badge_icon, badge_enabled, bg_color, product_pos, overlay_pos, badge_pos)
    VALUES (${id}, ${userId}, ${nome}, ${tipo}, ${overlay}, ${badgeIcon},
            ${badgeEnabled}, ${bgColor},
            ${sql.json(productPos ?? { x: 5, y: 5, size: 90 })},
            ${sql.json(overlayPos ?? { x: 0, y: 0, size: 100 })},
            ${sql.json(badgePos ?? { x: 3, y: 3, size: 25 })})
    RETURNING id, nome, tipo, overlay,
              COALESCE(badge_icon, logo) AS "badgeIcon",
              badge_enabled AS "badgeEnabled",
              COALESCE(bg_color, '#ffffff') AS "bgColor",
              product_pos AS "productPos", overlay_pos AS "overlayPos", badge_pos AS "badgePos"
  `;
  res.status(201).json(row);
});
