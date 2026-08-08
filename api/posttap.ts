import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS posttap_sessions (
      user_id   TEXT PRIMARY KEY,
      enabled   BOOLEAN NOT NULL DEFAULT FALSE,
      cookie    TEXT    NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const rawUserId = requireUserId(req, res);
  if (!rawUserId) return;
  const userId = rawUserId.includes(':') ? rawUserId.split(':')[0] : rawUserId;

  await ensureTable();

  if (req.method === 'GET') {
    const [row] = await sql`SELECT enabled, cookie FROM posttap_sessions WHERE user_id = ${userId}`;
    res.json({ enabled: row?.enabled ?? false, cookie: row?.cookie ?? '' });
    return;
  }

  // POST — salva
  const { enabled, cookie } = req.body ?? {};
  await sql`
    INSERT INTO posttap_sessions (user_id, enabled, cookie, updated_at)
    VALUES (${userId}, ${!!enabled}, ${cookie ?? ''}, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET enabled = EXCLUDED.enabled, cookie = EXCLUDED.cookie, updated_at = NOW()
  `;
  res.json({ ok: true });
});
