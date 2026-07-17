import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

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
    VALUES (${userId}, ${title}, ${image}, ${body}, ${keyboard}, ${JSON.stringify(schedules)}::jsonb)
    RETURNING id, title, image, body, keyboard, schedules, created_at, updated_at
  `;
  res.json(row);
});
