import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM autopost_queue WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  const body = req.body ?? {};
  const hasPosts = body.posts !== undefined;
  const [row] = hasPosts
    ? await sql`
        UPDATE autopost_queue
        SET posts = ${sql.json(body.posts)}, status = ${body.status}, scheduled = ${body.scheduled ?? null}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id, posts, status, scheduled, created_at AS "createdAt"
      `
    : await sql`
        UPDATE autopost_queue
        SET status = ${body.status}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id, posts, status, scheduled, created_at AS "createdAt"
      `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  const r = row as any;
  res.json({ ...r, posts: typeof r.posts === 'string' ? JSON.parse(r.posts) : r.posts });
});
