import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';

// Cache in-memory: { fileId, title, username } per channelId — TTL 1h
const cache = new Map<string, { fileId: string | null; title: string; username?: string; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  const channelId = (req.query.channelId as string | undefined)?.trim();
  if (!channelId) { res.status(400).json({ error: 'channelId required' }); return; }

  const isPhotoRequest = req.query.photo === '1';
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    if (isPhotoRequest) { res.status(404).end(); return; }
    res.json({ title: channelId, photoUrl: null });
    return;
  }

  const tgBase = `https://api.telegram.org/bot${botToken}`;

  // Leggi o popola cache
  const now = Date.now();
  let entry = cache.get(channelId);
  if (!entry || now - entry.ts > CACHE_TTL) {
    try {
      const chatRes = await fetch(`${tgBase}/getChat?chat_id=${encodeURIComponent(channelId)}`);
      const chatJson = await chatRes.json() as any;
      if (!chatJson.ok) {
        entry = { fileId: null, title: channelId, ts: now };
      } else {
        const chat = chatJson.result;
        const title: string = chat.title ?? chat.username ?? channelId;
        let fileId: string | null = null;
        if (chat.photo?.small_file_id) {
          const fileRes = await fetch(`${tgBase}/getFile?file_id=${chat.photo.small_file_id}`);
          const fileJson = await fileRes.json() as any;
          fileId = fileJson.result?.file_path
            ? `https://api.telegram.org/file/bot${botToken}/${fileJson.result.file_path}`
            : null;
        }
        entry = { fileId, title, username: chat.username ?? undefined, ts: now };
      }
    } catch {
      entry = { fileId: null, title: channelId, ts: now };
    }
    cache.set(channelId, entry);
  }

  if (isPhotoRequest) {
    // Proxy immagine: scarica server-side e restituisce i bytes — il token non viene mai esposto al browser
    if (!entry.fileId) { res.status(404).end(); return; }
    try {
      const imgRes = await fetch(entry.fileId);
      if (!imgRes.ok) { res.status(404).end(); return; }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ct = imgRes.headers.get('content-type') ?? 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch {
      res.status(404).end();
    }
    return;
  }

  // JSON: photoUrl punta al proxy stesso, non al Telegram diretto
  const photoUrl = entry.fileId ? `/api/channel-info?channelId=${encodeURIComponent(channelId)}&photo=1` : null;
  res.json({ title: entry.title, photoUrl, username: entry.username });
});
