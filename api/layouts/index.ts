import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, nome, tipo, body AS contenuto, active
      FROM layouts WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    res.json(rows);
    return;
  }

  const { id, nome, tipo, contenuto = '', active = false } = req.body ?? {};
  if (!id || !nome || !tipo) { res.status(400).json({ error: 'id, nome and tipo required' }); return; }
  const [row] = await sql`
    INSERT INTO layouts (id, user_id, nome, tipo, body, active)
    VALUES (${id}, ${userId}, ${nome}, ${tipo}, ${contenuto}, ${active})
    RETURNING id, nome, tipo, body AS contenuto, active
  `;
  res.status(201).json(row);
});
