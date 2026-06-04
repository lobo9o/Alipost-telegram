import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';

// Cache in-memory: TTL 1h
const cache = new Map<string, { fileUrl: string | null; title: string; username?: string; ts: number }>();
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
    res.json({ title: '', photoUrl: null });
    return;
  }

  const tgBase = `https://api.telegram.org/bot${botToken}`;
  const now = Date.now();
  let entry = cache.get(channelId);

  if (!entry || now - entry.ts > CACHE_TTL) {
    let fileUrl: string | null = null;
    let title = '';
    let username: string | undefined;

    try {
      const chatRes = await fetch(`${tgBase}/getChat?chat_id=${encodeURIComponent(channelId)}`);
      const chatJson = await chatRes.json() as any;
      console.log(`[channel-info] getChat ${channelId} → ok=${chatJson.ok} title="${chatJson.result?.title}" hasPhoto=${!!chatJson.result?.photo}`);

      if (chatJson.ok) {
        const chat = chatJson.result;
        title = chat.title ?? chat.first_name ?? chat.username ?? '';
        username = chat.username ?? undefined;

        if (chat.photo?.small_file_id) {
          const fileRes = await fetch(`${tgBase}/getFile?file_id=${chat.photo.small_file_id}`);
          const fileJson = await fileRes.json() as any;
          console.log(`[channel-info] getFile → ok=${fileJson.ok} path="${fileJson.result?.file_path}"`);
          if (fileJson.ok && fileJson.result?.file_path) {
            fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileJson.result.file_path}`;
          }
        }
      } else {
        console.warn(`[channel-info] getChat ${channelId} FAILED:`, chatJson.description);
      }
    } catch (e: any) {
      console.error(`[channel-info] errore per ${channelId}:`, e?.message);
    }

    entry = { fileUrl, title, username, ts: now };
    cache.set(channelId, entry);
  }

  if (isPhotoRequest) {
    if (!entry.fileUrl) { res.status(404).end(); return; }
    try {
      const imgRes = await fetch(entry.fileUrl);
      if (!imgRes.ok) { res.status(404).end(); return; }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      res.setHeader('Content-Type', imgRes.headers.get('content-type') ?? 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch {
      res.status(404).end();
    }
    return;
  }

  const photoUrl = entry.fileUrl
    ? `/api/channel-info?channelId=${encodeURIComponent(channelId)}&photo=1`
    : null;
  res.json({ title: entry.title, photoUrl, username: entry.username });
});
