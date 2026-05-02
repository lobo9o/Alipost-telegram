import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods } from './_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST'], req, res)) return;
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.json({ resolved: response.url });
  } catch {
    // Fallback: GET con redirect follow
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' },
      });
      clearTimeout(timer);
      return res.json({ resolved: response.url });
    } catch (e2) {
      return res.status(200).json({ resolved: url }); // restituisce l'originale in caso di errore
    }
  }
});
