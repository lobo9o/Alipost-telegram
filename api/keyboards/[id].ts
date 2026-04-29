import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM keyboards WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  const { nome, contenuto } = req.body ?? {};
  const [row] = await sql`
    UPDATE keyboards SET nome = ${nome}, body = ${contenuto ?? ''}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, nome, body AS contenuto
  `;
  if (row) { res.json(row); return; }

  // Non esiste in DB: upsert (es. keyboard di default mai persistito)
  const [inserted] = await sql`
    INSERT INTO keyboards (id, user_id, nome, body)
    VALUES (${id}, ${userId}, ${nome}, ${contenuto ?? ''})
    ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, body = EXCLUDED.body
    WHERE keyboards.user_id = ${userId}
    RETURNING id, nome, body AS contenuto
  `;
  res.json(inserted ?? { id, nome, contenuto: contenuto ?? '' });
});
