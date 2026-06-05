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
  // I template sono condivisi tra tutti i profili dello stesso utente base
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM templates WHERE id = ${id} AND (user_id = ${baseUserId} OR user_id = ${userId})`;
    res.json({ ok: true });
    return;
  }

  // PUT — aggiorna config; mantiene il template associato al profilo esatto (userId, non baseUserId)
  const { id: _id, ...config } = req.body ?? {};
  console.log(`[templates PUT] userId=${userId} baseUserId=${baseUserId} templateId=${id}`);
  let [row] = await sql`
    UPDATE templates SET config = ${sql.json(config)}, user_id = ${userId}, updated_at = NOW()
    WHERE id = ${id} AND (user_id = ${baseUserId} OR user_id = ${userId})
    RETURNING id, config
  `;
  console.log(`[templates PUT] result: ${row ? 'updated' : '404 not found'}`);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(parseConfig((row as any).config, (row as any).id));
});
