import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, nome, body AS contenuto
      FROM keyboards WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    res.json(rows);
    return;
  }

  const { id, nome, contenuto = '' } = req.body ?? {};
  if (!id || !nome) { res.status(400).json({ error: 'id e nome richiesti' }); return; }
  const [row] = await sql`
    INSERT INTO keyboards (id, user_id, nome, body)
    VALUES (${id}, ${userId}, ${nome}, ${contenuto})
    RETURNING id, nome, body AS contenuto
  `;
  res.status(201).json(row);
});
