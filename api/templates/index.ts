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
    const result = rows.map((r: any) => parseConfig(r.config, r.id));
    res.json(result);
    return;
  }

  // POST — create new template
  const { id, ...config } = req.body ?? {};
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const [row] = await sql`
    INSERT INTO templates (id, user_id, nome, tipo, config)
    VALUES (${id}, ${userId}, 'Template', 'normal', ${sql.json(config)})
    RETURNING id, config
  `;
  res.status(201).json(parseConfig((row as any).config, (row as any).id));
});
