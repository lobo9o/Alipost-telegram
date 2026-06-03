import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

function parseConfig(raw: unknown, id: string) {
  const cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {};
  return { id, ...cfg };
}

// Lazy migration — eseguita una volta per processo
let migrated = false;
async function ensureUpdatedAt() {
  if (migrated) return;
  await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`.catch(() => {});
  migrated = true;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  await ensureUpdatedAt();

  if (req.method === 'GET') {
    // updated_at DESC NULLS LAST → l'ultimo modificato dall'utente viene primo
    // Poi canvasW NOT NULL → preferisce template con dimensioni configurate
    // Poi created_at DESC → tra pari, il più recente
    const rows = await sql`
      SELECT id, config FROM templates WHERE user_id = ${userId}
      ORDER BY updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC
    `;
    if ((rows as any[]).length === 0) { res.json([]); return; }

    const result: any[] = [];
    for (const r of rows as any[]) {
      const cfg = parseConfig(r.config, r.id) as any;
      if (cfg.store && !cfg.storeAmazon) {
        cfg.storeAmazon = cfg.store;
        cfg.storeAliexpress = cfg.store;
        const { id: _id, ...configToSave } = cfg;
        await sql`UPDATE templates SET config = ${sql.json(configToSave)}, updated_at = NOW() WHERE id = ${r.id} AND user_id = ${userId}`.catch(() => {});
      }
      result.push(cfg);
    }
    res.json(result);
    return;
  }

  // POST — create new template
  const { id: clientId, ...config } = req.body ?? {};
  const newId = (clientId && typeof clientId === 'string' && clientId.trim()) ? clientId.trim() : null;
  const [row] = await sql`
    INSERT INTO templates (id, user_id, nome, tipo, config)
    VALUES (COALESCE(${newId}, gen_random_uuid()::text), ${userId}, 'Template', 'normal', ${sql.json(config)})
    RETURNING id, config
  `;
  res.status(201).json(parseConfig((row as any).config, (row as any).id));
});
