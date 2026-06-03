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
  const hasPosts      = body.posts        !== undefined;
  const hasStatus     = body.status       !== undefined;
  const hasScheduled  = body.scheduled    !== undefined;
  const hasSilenzioso = body.silenzioso   !== undefined;
  const hasDestChannel = body.destChannel !== undefined;

  // Aggiorna solo dest_channel — usato dalla QueuePage quando l'utente seleziona un canale
  if (hasDestChannel && !hasPosts && !hasStatus && !hasScheduled && !hasSilenzioso) {
    const destCh = body.destChannel === '' ? null : (body.destChannel ?? null);
    const rows = await sql`
      UPDATE autopost_queue SET dest_channel = ${destCh}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, posts, status, scheduled, silenzioso, dest_channel, created_at AS "createdAt"
    `;
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    const r = rows[0] as any;
    res.json({ ...r, posts: typeof r.posts === 'string' ? JSON.parse(r.posts) : r.posts });
    return;
  }

  // Manteniamo generatedImage nel DB — serve al cron per pubblicare con overlay
  // NB: checkAndMarkHistoricalLow NON viene chiamato qui: l'utente può sovrascrivere
  // manualmente isHistoricalLow in modifica; il rilevamento automatico avviene solo
  // alla creazione (index.ts POST).
  const postsForDb = hasPosts ? (body.posts as any[]) : undefined;

  // silenzioso: null → NULL (auto/default), true/false → override esplicito
  const silenziosoVal = hasSilenzioso
    ? (body.silenzioso === null ? null : Boolean(body.silenzioso))
    : undefined;

  // Costruisce la SET dinamicamente per evitare di sovrascrivere campi non inviati
  let row: any;

  if (hasPosts) {
    // Aggiorna posts + status + scheduled + eventualmente silenzioso
    const rows = hasSilenzioso
      ? await sql`
          UPDATE autopost_queue
          SET posts = ${sql.json(postsForDb!)},
              status = ${body.status ?? 'draft'},
              scheduled = ${body.scheduled ?? null},
              silenzioso = ${silenziosoVal}
          WHERE id = ${id} AND user_id = ${userId}
          RETURNING id, posts, status, scheduled, silenzioso, created_at AS "createdAt"
        `
      : await sql`
          UPDATE autopost_queue
          SET posts = ${sql.json(postsForDb!)},
              status = ${body.status ?? 'draft'},
              scheduled = ${body.scheduled ?? null}
          WHERE id = ${id} AND user_id = ${userId}
          RETURNING id, posts, status, scheduled, silenzioso, created_at AS "createdAt"
        `;
    row = rows[0];
  } else if (hasStatus && hasSilenzioso) {
    const rows = await sql`
      UPDATE autopost_queue
      SET status = ${body.status}, silenzioso = ${silenziosoVal}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, posts, status, scheduled, silenzioso, created_at AS "createdAt"
    `;
    row = rows[0];
  } else if (hasStatus) {
    const rows = await sql`
      UPDATE autopost_queue
      SET status = ${body.status}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, posts, status, scheduled, silenzioso, created_at AS "createdAt"
    `;
    row = rows[0];
  } else if (hasSilenzioso) {
    // Aggiorna solo silenzioso — senza toccare status/posts
    const rows = await sql`
      UPDATE autopost_queue
      SET silenzioso = ${silenziosoVal}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, posts, status, scheduled, silenzioso, created_at AS "createdAt"
    `;
    row = rows[0];
  } else {
    res.status(400).json({ error: 'Nessun campo da aggiornare' });
    return;
  }

  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  const r = row as any;
  res.json({ ...r, posts: typeof r.posts === 'string' ? JSON.parse(r.posts) : r.posts });
});
