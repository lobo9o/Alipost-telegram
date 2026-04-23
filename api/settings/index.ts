import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT data FROM settings WHERE id = 1`;
    res.json(rows[0]?.data ?? {});
    return;
  }

  // POST — replace settings
  const data = req.body;
  const json = JSON.stringify(data);
  await sql`
    INSERT INTO settings (id, data, updated_at) VALUES (1, ${json}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = ${json}::jsonb, updated_at = now()
  `;
  res.json({ ok: true });
});
