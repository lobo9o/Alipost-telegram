import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const id = req.query.id as string | undefined;

  if (id) {
    // ── Item operations (/api/keyboards/:id) ─────────────────────
    if (!allowMethods(['PUT', 'DELETE'], req, res)) return;

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

    // Upsert (es. keyboard di default mai persistito)
    const [inserted] = await sql`
      INSERT INTO keyboards (id, user_id, nome, body)
      VALUES (${id}, ${userId}, ${nome}, ${contenuto ?? ''})
      ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, body = EXCLUDED.body
      WHERE keyboards.user_id = ${userId}
      RETURNING id, nome, body AS contenuto
    `;
    res.json(inserted ?? { id, nome, contenuto: contenuto ?? '' });
    return;
  }

  // ── Collection operations (/api/keyboards) ────────────────────
  if (!allowMethods(['GET', 'POST'], req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, nome, body AS contenuto
      FROM keyboards WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    res.json(rows);
    return;
  }

  const { id: newId, nome, contenuto = '' } = req.body ?? {};
  if (!newId || !nome) { res.status(400).json({ error: 'id e nome richiesti' }); return; }
  const [row] = await sql`
    INSERT INTO keyboards (id, user_id, nome, body)
    VALUES (${newId}, ${userId}, ${nome}, ${contenuto})
    RETURNING id, nome, body AS contenuto
  `;
  res.status(201).json(row);
});
