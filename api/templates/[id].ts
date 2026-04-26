import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

function parseConfig(raw: unknown, id: string) {
  const cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {};
  return { id, ...cfg };
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM templates WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  // PUT — update config column
  const { id: _id, ...config } = req.body ?? {};
  const [row] = await sql`
    UPDATE templates SET config = ${sql.json(config)}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, config
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(parseConfig((row as any).config, (row as any).id));
});
