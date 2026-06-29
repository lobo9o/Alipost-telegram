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
    // Auto-seed tag di sistema se non esistono ancora per questo utente
    const boxcouponId = `sys_boxcoupon_${userId}`;
    await sql`
      INSERT INTO tags (id, user_id, name, value)
      VALUES (${boxcouponId}, ${userId}, '{boxcoupon}', 'Abilita il coupon prima di acquistare')
      ON CONFLICT DO NOTHING
    `.catch(() => {});
    const countryId = `sys_country_${userId}`;
    await sql`
      INSERT INTO tags (id, user_id, name, value)
      VALUES (${countryId}, ${userId}, '{country}', 'Cina')
      ON CONFLICT DO NOTHING
    `.catch(() => {});
    const countryupId = `sys_countryup_${userId}`;
    await sql`
      INSERT INTO tags (id, user_id, name, value)
      VALUES (${countryupId}, ${userId}, '{countryup}', 'CINA')
      ON CONFLICT DO NOTHING
    `.catch(() => {});
    const minimoId = `sys_minstor_${userId}`;
    await sql`
      INSERT INTO tags (id, user_id, name, value)
      SELECT ${minimoId}, ${userId}, '{minimo_storico}', '🏆 Minimo Storico!'
      WHERE NOT EXISTS (SELECT 1 FROM tags WHERE user_id = ${userId} AND name = '{minimo_storico}')
    `.catch(() => {});
    const terminataId = `sys_terminata_${userId}`;
    await sql`
      INSERT INTO tags (id, user_id, name, value)
      SELECT ${terminataId}, ${userId}, '{terminata}', '❌ Offerta terminata'
      WHERE NOT EXISTS (SELECT 1 FROM tags WHERE user_id = ${userId} AND name = '{terminata}')
    `.catch(() => {});
    const rows = await sql`SELECT id, name, value FROM tags WHERE user_id = ${userId} ORDER BY created_at ASC`;
    res.json(rows);
    return;
  }

  const { id: newId, name, value = '' } = req.body ?? {};
  if (!newId || !name) { res.status(400).json({ error: 'id and name required' }); return; }
  console.log(`[tags] POST userId=${userId} name=${name}`);
  const [row] = await sql`
    INSERT INTO tags (id, user_id, name, value) VALUES (${newId}, ${userId}, ${name}, ${value})
    RETURNING id, name, value
  `;
  res.status(201).json(row);
});
