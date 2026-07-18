import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';
import { applyCustomEmoji } from '../../lib/applyCustomEmoji.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function safeCaption(html: string, max: number): string {
  return html.length <= max ? html : html.slice(0, max - 1) + '…';
}

async function buildKeyboard(body: string, links: Record<string, string> = {}): Promise<object | undefined> {
  if (!body?.trim()) return undefined;
  const rows = body.trim().split('\n').filter(r => r.trim());
  const keyboard = rows.map(row =>
    row.split('&&').map(b => b.trim()).filter(Boolean).map(btn => {
      const m = btn.match(/^(.*)\s*-\s*(https?:\/\/.+)$/) ?? btn.match(/^(.*)\s+-\s+(.+)$/);
      if (!m) return null;
      let url = m[2].trim();
      for (const [tag, val] of Object.entries(links)) url = url.split(tag).join(val);
      return { text: m[1].trim(), url };
    }).filter(Boolean)
  ).filter(r => r.length > 0);
  return keyboard.length ? { inline_keyboard: keyboard } : undefined;
}

async function sendCustomPost(post: Record<string, any>, channel: string, userId: string): Promise<{ ok: boolean; messageId?: number; chatId?: string; error?: string }> {
  if (!BOT_TOKEN) return { ok: false, error: 'BOT_TOKEN mancante' };
  const tgBase = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const caption = safeCaption(post.body || '', 1024);
  const replyMarkup = await buildKeyboard(post.keyboard || '');
  const hasImage = post.image && String(post.image).startsWith('http');

  let tgRes: Response;
  if (post.image && String(post.image).startsWith('data:')) {
    const base64 = String(post.image).replace(/^data:image\/\w+;base64,/, '');
    const form = new FormData();
    form.append('chat_id', channel);
    form.append('photo', new Blob([Buffer.from(base64, 'base64')], { type: 'image/jpeg' }), 'post.jpg');
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    tgRes = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: form });
  } else if (hasImage) {
    tgRes = await fetch(`${tgBase}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channel, photo: post.image, caption, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    });
  } else {
    tgRes = await fetch(`${tgBase}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channel, text: safeCaption(post.body || '', 4096), parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    });
  }
  const tgData = await tgRes.json() as { ok: boolean; result?: { message_id: number; chat?: { id: number } }; description?: string };
  if (!tgData.ok) return { ok: false, error: tgData.description };
  const messageId = tgData.result?.message_id ?? 0;
  const chatId = String(tgData.result?.chat?.id ?? channel);
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;
  if (messageId) applyCustomEmoji({ baseUserId, chatId, messageId, htmlText: caption, enabled: true }).catch(() => {});
  return { ok: true, messageId, chatId };
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'PUT', 'DELETE', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  if (req.method === 'GET') {
    const [row] = await sql`SELECT * FROM custom_posts WHERE id = ${id} AND user_id = ${userId}`;
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
    return;
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM custom_posts WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  // POST — pubblica subito su un canale
  if (req.method === 'POST') {
    const { channel } = req.body ?? {};
    if (!channel) { res.status(400).json({ error: 'channel required' }); return; }
    const [post] = await sql`SELECT * FROM custom_posts WHERE id = ${id} AND user_id = ${userId}`;
    if (!post) { res.status(404).json({ error: 'Not found' }); return; }
    const result = await sendCustomPost(post, channel, userId);
    if (!result.ok) { res.status(500).json({ error: result.error }); return; }
    res.json({ ok: true, messageId: result.messageId, chatId: result.chatId });
    return;
  }

  // PUT — aggiorna
  const { title, image, body, keyboard, schedules } = req.body ?? {};
  const [row] = await sql`
    UPDATE custom_posts SET
      title = ${title ?? ''}, image = ${image ?? ''}, body = ${body ?? ''},
      keyboard = ${keyboard ?? ''}, schedules = ${sql.json(schedules ?? [])},
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, title, image, body, keyboard, schedules, created_at, updated_at
  `;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

// Esportata per il cron job del scheduler
export { sendCustomPost };
