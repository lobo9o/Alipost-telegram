import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM layouts WHERE id = ${id}`;
    res.json({ ok: true });
    return;
  }

  const { nome, tipo, body, active } = req.body ?? {};
  const [row] = await sql`
    UPDATE layouts SET nome = ${nome}, tipo = ${tipo}, body = ${body}, active = ${active}
    WHERE id = ${id}
    RETURNING id, nome, tipo, body, active
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});
