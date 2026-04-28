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
  // Try UPDATE first; if the layout was never persisted (e.g. a default/mock layout),
  // INSERT it so edits to pre-seeded layouts are always saved.
  const [row] = await sql`
    UPDATE layouts SET nome = ${nome}, tipo = ${tipo}, body = ${contenuto}, active = ${active}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, nome, tipo, body AS contenuto, active
  `;
  if (row) { res.json(row); return; }

  const [inserted] = await sql`
    INSERT INTO layouts (id, user_id, nome, tipo, body, active)
    VALUES (${id}, ${userId}, ${nome}, ${tipo}, ${contenuto ?? ''}, ${active ?? false})
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome, tipo = EXCLUDED.tipo,
      body = EXCLUDED.body, active = EXCLUDED.active
    RETURNING id, nome, tipo, body AS contenuto, active
  `;
  res.json(inserted);
});
