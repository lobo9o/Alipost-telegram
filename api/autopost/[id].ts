import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db';
import { withErrorHandler, allowMethods } from '../_utils';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['PUT', 'DELETE'], req, res)) return;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    await sql`DELETE FROM autopost_queue WHERE id = ${id}`;
    res.json({ ok: true });
    return;
  }

  const { posts, status, scheduled } = req.body ?? {};
  const [row] = await sql`
    UPDATE autopost_queue
    SET posts = ${JSON.stringify(posts)}, status = ${status}, scheduled = ${scheduled ?? null}
    WHERE id = ${id}
    RETURNING id, posts, status, scheduled, created_at AS "createdAt"
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});
