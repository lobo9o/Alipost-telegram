import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, posts, status, scheduled, created_at AS "createdAt"
      FROM autopost_queue WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    res.json(rows);
    return;
  }

  const { id, posts = [], status = 'draft', scheduled = null } = req.body ?? {};
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const [row] = await sql`
    INSERT INTO autopost_queue (id, user_id, posts, status, scheduled)
    VALUES (${id}, ${userId}, ${JSON.stringify(posts)}, ${status}, ${scheduled})
    RETURNING id, posts, status, scheduled, created_at AS "createdAt"
  `;
  res.status(201).json(row);
});
