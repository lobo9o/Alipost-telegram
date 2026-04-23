import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ready } from '../lib/db.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

export function withErrorHandler(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await ready;
      await handler(req, res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[API Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  };
}

export function allowMethods(allowed: string[], req: VercelRequest, res: VercelResponse): boolean {
  if (!allowed.includes(req.method ?? '')) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  return true;
}
