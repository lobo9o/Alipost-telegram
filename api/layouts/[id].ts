import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM layouts WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  const { nome, tipo, contenuto, active } = req.body ?? {};
  const [row] = await sql`
    UPDATE layouts SET nome = ${nome}, tipo = ${tipo}, body = ${contenuto}, active = ${active}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, nome, tipo, body AS contenuto, active
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});
