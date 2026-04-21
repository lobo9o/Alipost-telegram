import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db';
import { withErrorHandler, allowMethods } from '../_utils';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT data FROM settings WHERE id = 1`;
    res.json(rows[0]?.data ?? {});
    return;
  }

  // POST — replace settings
  const data = req.body;
  await sql`
    INSERT INTO settings (id, data, updated_at) VALUES (1, ${JSON.stringify(data)}, now())
    ON CONFLICT (id) DO UPDATE SET data = ${JSON.stringify(data)}, updated_at = now()
  `;
  res.json({ ok: true });
});
