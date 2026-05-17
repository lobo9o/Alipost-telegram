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
    const rows = await sql`SELECT id, config FROM templates WHERE user_id = ${userId} ORDER BY created_at ASC`;
    const result = [];
    for (const r of rows as any[]) {
      const cfg = parseConfig(r.config, r.id) as any;
      if (cfg.store && !cfg.storeAmazon) {
        cfg.storeAmazon = cfg.store;
        cfg.storeAliexpress = cfg.store;
        const { id: _id, ...configToSave } = cfg;
        await sql`UPDATE templates SET config = ${sql.json(configToSave)} WHERE id = ${r.id} AND user_id = ${userId}`.catch(() => {});
      }
      result.push(cfg);
    }
    res.json(result);
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
