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
    console.log('[settings] GET userId:', userId, 'rows:', rows.length, 'size:', size, 'channels:', JSON.stringify((data as any)?.channels ?? []));
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
  console.log('[settings] BODY keys:', data ? Object.keys(data) : 'null/undefined');
  console.log('[settings] BODY channels raw:', JSON.stringify(data?.channels));
  console.log('[settings] BODY amazon.affiliateTag:', data?.amazon?.affiliateTag);
  const channels = Array.isArray(data?.channels) ? data.channels.filter((c: string) => typeof c === 'string' && c.trim()) : [];
  const cleaned = { ...data, channels };
  const json = JSON.stringify(cleaned);
  console.log('[settings] SAVE userId:', userId, 'channels:', channels, 'size:', json.length);
  const existing = await sql`SELECT id FROM settings WHERE user_id = ${userId}`;
  if (existing.length > 0) {
    const result = await sql`UPDATE settings SET data = ${json}::jsonb, updated_at = now() WHERE user_id = ${userId} RETURNING id`;
    console.log('[settings] UPDATE rows affected:', result.length);
  } else {
    await sql`INSERT INTO settings (user_id, data, updated_at) VALUES (${userId}, ${json}::jsonb, now())`;
    console.log('[settings] INSERT done');
  }
  res.json({ ok: true });
});
