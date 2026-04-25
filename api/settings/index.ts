import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
    const data = rows[0]?.data ?? {};
    const size = JSON.stringify(data).length;
    console.log('[settings] data size bytes:', size);
    if (size > 10_000) {
      console.warn('[settings] data troppo grande — reset a {}');
      await sql`UPDATE settings SET data = '{}'::jsonb, updated_at = now() WHERE user_id = ${userId}`;
      res.json({});
      return;
    }
    res.json(data);
    return;
  }

  // POST — replace settings
  const data = req.body;
  const json = JSON.stringify(data);
  const existing = await sql`SELECT id FROM settings WHERE user_id = ${userId}`;
  if (existing.length > 0) {
    await sql`UPDATE settings SET data = ${json}::jsonb, updated_at = now() WHERE user_id = ${userId}`;
  } else {
    await sql`INSERT INTO settings (user_id, data, updated_at) VALUES (${userId}, ${json}::jsonb, now())`;
  }
  res.json({ ok: true });
});
