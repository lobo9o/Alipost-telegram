import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  const channelId = (req.query.channelId as string | undefined)?.trim();
  if (!channelId) { res.status(400).json({ error: 'channelId required' }); return; }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) { res.json({ title: channelId, photoUrl: null }); return; }

  const tgBase = `https://api.telegram.org/bot${botToken}`;

  try {
    const chatRes = await fetch(`${tgBase}/getChat?chat_id=${encodeURIComponent(channelId)}`);
    const chatJson = await chatRes.json() as any;
    if (!chatJson.ok) { res.json({ title: channelId, photoUrl: null }); return; }

    const chat = chatJson.result;
    const title: string = chat.title ?? chat.username ?? channelId;

    if (!chat.photo?.small_file_id) {
      res.json({ title, photoUrl: null, username: chat.username ?? undefined });
      return;
    }

    const fileRes = await fetch(`${tgBase}/getFile?file_id=${chat.photo.small_file_id}`);
    const fileJson = await fileRes.json() as any;
    const filePath: string | undefined = fileJson.result?.file_path;
    const photoUrl = filePath ? `https://api.telegram.org/file/bot${botToken}/${filePath}` : null;

    res.json({ title, photoUrl, username: chat.username ?? undefined });
  } catch {
    res.json({ title: channelId, photoUrl: null });
  }
});
