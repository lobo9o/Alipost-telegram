import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db';
import { withErrorHandler, allowMethods } from '../_utils';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, nome, tipo, overlay, logo, badge_enabled AS "badgeEnabled"
      FROM templates ORDER BY created_at ASC
    `;
    res.json(rows);
    return;
  }

  const { id, nome, tipo, overlay = null, logo = null, badgeEnabled = false } = req.body ?? {};
  if (!id || !nome || !tipo) { res.status(400).json({ error: 'id, nome and tipo required' }); return; }
  const [row] = await sql`
    INSERT INTO templates (id, nome, tipo, overlay, logo, badge_enabled)
    VALUES (${id}, ${nome}, ${tipo}, ${overlay}, ${logo}, ${badgeEnabled})
    RETURNING id, nome, tipo, overlay, logo, badge_enabled AS "badgeEnabled"
  `;
  res.status(201).json(row);
});
