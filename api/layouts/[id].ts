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

  const { nome, tipo, contenuto } = req.body ?? {};
  // active non è nel tipo TextLayout — usiamo COALESCE per preservare il valore esistente
  const [row] = await sql`
    UPDATE layouts SET nome = ${nome}, tipo = ${tipo}, body = ${contenuto ?? ''}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, nome, tipo, body AS contenuto
  `;
  if (row) { res.json(row); return; }

  // Layout non esiste in DB (es. layout di default mai persistito): INSERT
  const [inserted] = await sql`
    INSERT INTO layouts (id, user_id, nome, tipo, body, active)
    VALUES (${id}, ${userId}, ${nome}, ${tipo}, ${contenuto ?? ''}, false)
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome, tipo = EXCLUDED.tipo, body = EXCLUDED.body
    WHERE layouts.user_id = ${userId}
    RETURNING id, nome, tipo, body AS contenuto
  `;
  res.json(inserted ?? { id, nome, tipo, contenuto: contenuto ?? '' });
});
