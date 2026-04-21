import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db';
import { withErrorHandler, allowMethods } from '../_utils';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT id, nome, tipo, body, active FROM layouts ORDER BY created_at ASC`;
    res.json(rows);
    return;
  }

  const { id, nome, tipo, body = '', active = false } = req.body ?? {};
  if (!id || !nome || !tipo) { res.status(400).json({ error: 'id, nome and tipo required' }); return; }
  const [row] = await sql`
    INSERT INTO layouts (id, nome, tipo, body, active)
    VALUES (${id}, ${nome}, ${tipo}, ${body}, ${active})
    RETURNING id, nome, tipo, body, active
  `;
  res.status(201).json(row);
});
