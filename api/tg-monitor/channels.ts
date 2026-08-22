import { withErrorHandler, requireUserId } from '../_utils.js';
import sql from '../../lib/db.js';

export default withErrorHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;

  // ── GET: lista canali ────────────────────────────────────────
  if (req.method === 'GET') {
    await sql`ALTER TABLE tg_monitor_channels ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT false`.catch(() => {});
    await sql`ALTER TABLE tg_monitor_channels ADD COLUMN IF NOT EXISTS dest_channel TEXT`.catch(() => {});
    await sql`ALTER TABLE tg_monitor_channels ADD COLUMN IF NOT EXISTS force_errore BOOLEAN NOT NULL DEFAULT false`.catch(() => {});
    const rows = await sql<{ id: string; channel: string; active: boolean; auto_publish: boolean; dest_channel: string | null; force_errore: boolean }[]>`
      SELECT id, channel, active, auto_publish, dest_channel, COALESCE(force_errore, false) AS force_errore FROM tg_monitor_channels
      WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    return res.json(rows);
  }

  // ── PATCH: aggiorna impostazioni canale ──────────────────────
  if (req.method === 'PATCH') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'ID mancante' });
    const { auto_publish, active, dest_channel, force_errore } = req.body ?? {};

    if (typeof dest_channel !== 'undefined') {
      const val = dest_channel === '' || dest_channel === null ? null : String(dest_channel);
      await sql`UPDATE tg_monitor_channels SET dest_channel = ${val} WHERE id = ${id} AND user_id = ${userId}`;
    }
    if (typeof force_errore === 'boolean') {
      await sql`UPDATE tg_monitor_channels SET force_errore = ${force_errore} WHERE id = ${id} AND user_id = ${userId}`;
    }
    if (typeof active === 'boolean' && typeof auto_publish === 'boolean') {
      await sql`UPDATE tg_monitor_channels SET active = ${active}, auto_publish = ${auto_publish} WHERE id = ${id} AND user_id = ${userId}`;
    } else if (typeof active === 'boolean') {
      await sql`UPDATE tg_monitor_channels SET active = ${active} WHERE id = ${id} AND user_id = ${userId}`;
    } else if (typeof auto_publish === 'boolean') {
      await sql`UPDATE tg_monitor_channels SET auto_publish = ${auto_publish} WHERE id = ${id} AND user_id = ${userId}`;
    } else if (typeof dest_channel === 'undefined' && typeof force_errore === 'undefined') {
      return res.status(400).json({ error: 'Nessun campo valido da aggiornare' });
    }

    const { reloadUser } = await import('./worker.js');
    reloadUser(baseUserId);

    return res.json({ ok: true });
  }

  // ── POST: aggiungi canale ────────────────────────────────────
  if (req.method === 'POST') {
    const { channel } = req.body ?? {};
    if (!channel || typeof channel !== 'string') {
      return res.status(400).json({ error: 'Campo "channel" mancante' });
    }

    const normalized = channel.trim().replace(/^https?:\/\/t\.me\//, '@').replace(/^t\.me\//, '@');

    const [row] = await sql<{ id: string }[]>`
      INSERT INTO tg_monitor_channels (id, user_id, channel)
      VALUES (${crypto.randomUUID()}, ${userId}, ${normalized})
      ON CONFLICT (user_id, channel) DO UPDATE SET active = true
      RETURNING id
    `;

    // Profilo secondario: crea riga settings con attivo=true se non esiste
    // Necessario perché publish.ts itera solo i profili con riga in settings
    if (userId !== baseUserId) {
      const [baseCfg] = await sql<{ data: unknown }[]>`SELECT data FROM settings WHERE user_id = ${baseUserId}`.catch(() => []);
      const baseData = baseCfg?.data as Record<string, any> ?? {};
      await sql`INSERT INTO settings (user_id, data) VALUES (${userId}, ${sql.json({ attivo: baseData.attivo ?? true })}) ON CONFLICT (user_id) DO NOTHING`.catch(() => {});
    }

    const { reloadUser } = await import('./worker.js');
    reloadUser(baseUserId);

    return res.json({ ok: true, id: row.id });
  }

  // ── DELETE: rimuovi canale ───────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'ID mancante' });

    await sql`DELETE FROM tg_monitor_channels WHERE id = ${id} AND user_id = ${userId}`;

    const { reloadUser } = await import('./worker.js');
    reloadUser(baseUserId);

    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
