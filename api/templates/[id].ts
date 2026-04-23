import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM templates WHERE id = ${id}`;
    res.json({ ok: true });
    return;
  }

  const { nome, tipo, overlay, logo, badgeEnabled } = req.body ?? {};
  const [row] = await sql`
    UPDATE templates
    SET nome = ${nome}, tipo = ${tipo}, overlay = ${overlay ?? null},
        logo = ${logo ?? null}, badge_enabled = ${badgeEnabled}
    WHERE id = ${id}
    RETURNING id, nome, tipo, overlay, logo, badge_enabled AS "badgeEnabled"
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});
