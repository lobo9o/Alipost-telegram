import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db';
import { withErrorHandler, allowMethods } from '../_utils';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT id, name, value FROM tags ORDER BY created_at ASC`;
    res.json(rows);
    return;
  }

  // POST — create tag
  const { id, name, value = '' } = req.body ?? {};
  if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }
  const [row] = await sql`
    INSERT INTO tags (id, name, value) VALUES (${id}, ${name}, ${value})
    RETURNING id, name, value
  `;
  res.status(201).json(row);
});
