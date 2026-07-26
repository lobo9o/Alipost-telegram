import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const rawUserId = requireUserId(req, res);
  if (!rawUserId) return;
  // I custom post sono condivisi tra tutti i profili dello stesso utente
  const userId = rawUserId.includes(':') ? rawUserId.split(':')[0] : rawUserId;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, title, image, body, keyboard, schedules, created_at, updated_at
      FROM custom_posts
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    res.json(rows);
    return;
  }

  // POST — crea nuovo
  const { title = '', image = '', body = '', keyboard = '', schedules = [] } = req.body ?? {};
  const [row] = await sql`
    INSERT INTO custom_posts (user_id, title, image, body, keyboard, schedules)
    VALUES (${userId}, ${title}, ${image}, ${body}, ${keyboard}, ${sql.json(schedules ?? [])})
    RETURNING id, title, image, body, keyboard, schedules, created_at, updated_at
  `;
  res.json(row);
});
