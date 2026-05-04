import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

// Aggiunge la colonna silenzioso se non esiste ancora (migrazione automatica)
async function ensureSilenziosoColumn() {
  await sql`ALTER TABLE autopost_queue ADD COLUMN IF NOT EXISTS silenzioso boolean`.catch(() => {});
}

let migrationDone = false;

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST', 'DELETE'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!migrationDone) {
    await ensureSilenziosoColumn();
    migrationDone = true;
  }

  // DELETE all — clear entire queue for this user
  if (req.method === 'DELETE') {
    const result = await sql`DELETE FROM autopost_queue WHERE user_id = ${userId}`;
    console.log('[autopost] clearAll userId:', userId, 'deleted:', (result as any).count ?? '?');
    res.json({ ok: true });
    return;
  }

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, posts, status, scheduled, silenzioso, created_at AS "createdAt"
      FROM autopost_queue WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    // Handle legacy rows where posts was stored as JSON string instead of JSONB array
    // Strip generatedImage from GET response — kept client-side only (too heavy for polling)
    const parsed = rows.map((r: any) => {
      const posts = typeof r.posts === 'string' ? JSON.parse(r.posts) : r.posts;
      const postsStripped = Array.isArray(posts)
        ? posts.map(({ generatedImage: _g, ...p }: any) => p)
        : posts;
      return {
        ...r,
        posts: postsStripped,
        tipo: Array.isArray(posts) && posts.length > 1 ? 'multi' : 'single',
        sched: r.scheduled ?? 'Auto',
        sel: false,
        silenzioso: r.silenzioso ?? undefined,
      };
    });
    res.json(parsed);
    return;
  }

  const { id, posts = [], status = 'draft', scheduled = null, silenzioso = null } = req.body ?? {};
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  // Salviamo generatedImage nel DB — serve al cron per pubblicare con overlay
  // Viene strippato solo dalla risposta GET per non appesantire il polling
  const postsForDb = posts as any[];
  const [row] = await sql`
    INSERT INTO autopost_queue (id, user_id, posts, status, scheduled, silenzioso)
    VALUES (${id}, ${userId}, ${sql.json(postsForDb)}, ${status}, ${scheduled}, ${silenzioso})
    RETURNING id, posts, status, scheduled, silenzioso, created_at AS "createdAt"
  `;
  res.status(201).json(row);
});
