import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

function parseConfig(raw: unknown, id: string) {
  const cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {};
  return { id, ...cfg };
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    // Restituisce solo il template più vecchio (quello configurato dall'utente).
    // Auto-cleanup: se ci sono duplicati (bug storico), li elimina in background.
    const rows = await sql`SELECT id, config FROM templates WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1`;
    if ((rows as any[]).length === 0) { res.json([]); return; }

    // Elimina duplicati in background senza bloccare la risposta
    sql`DELETE FROM templates WHERE user_id = ${userId} AND id != ${(rows as any[])[0].id}`.catch(() => {});

    const r = (rows as any[])[0];
    const cfg = parseConfig(r.config, r.id) as any;
    if (cfg.store && !cfg.storeAmazon) {
      cfg.storeAmazon = cfg.store;
      cfg.storeAliexpress = cfg.store;
      const { id: _id, ...configToSave } = cfg;
      await sql`UPDATE templates SET config = ${sql.json(configToSave)} WHERE id = ${r.id} AND user_id = ${userId}`.catch(() => {});
    }
    res.json([cfg]);
    return;
  }

  // POST — create new template
  const { id: _clientId, ...config } = req.body ?? {};
  const [row] = await sql`
    INSERT INTO templates (id, user_id, nome, tipo, config)
    VALUES (gen_random_uuid()::text, ${userId}, 'Template', 'normal', ${sql.json(config)})
    RETURNING id, config
  `;
  res.status(201).json(parseConfig((row as any).config, (row as any).id));
});
