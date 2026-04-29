import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const id = req.query.id as string | undefined;

  if (id) {
    // ── Item operations (/api/tags/:id) ───────────────────────────
    if (!allowMethods(['PUT', 'DELETE'], req, res)) return;

    if (req.method === 'DELETE') {
      await sql`DELETE FROM tags WHERE id = ${id} AND user_id = ${userId}`;
      res.json({ ok: true });
      return;
    }

    const { name, value } = req.body ?? {};
    const [row] = await sql`
      UPDATE tags SET name = ${name}, value = ${value}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, name, value
    `;
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
    return;
  }

  // ── Collection operations (/api/tags) ─────────────────────────
  if (!allowMethods(['GET', 'POST'], req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT id, name, value FROM tags WHERE user_id = ${userId} ORDER BY created_at ASC`;
    res.json(rows);
    return;
  }

  const { id: newId, name, value = '' } = req.body ?? {};
  if (!newId || !name) { res.status(400).json({ error: 'id and name required' }); return; }
  const [row] = await sql`
    INSERT INTO tags (id, user_id, name, value) VALUES (${newId}, ${userId}, ${name}, ${value})
    RETURNING id, name, value
  `;
  res.status(201).json(row);
});
