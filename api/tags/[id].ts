import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM tags WHERE id = ${id}`;
    res.json({ ok: true });
    return;
  }

  // PUT — update tag
  const { name, value } = req.body ?? {};
  const [row] = await sql`
    UPDATE tags SET name = ${name}, value = ${value} WHERE id = ${id}
    RETURNING id, name, value
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});
