import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';
import { applyCustomEmoji } from '../../lib/applyCustomEmoji.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);

function balanceHtmlTags(html: string): string {
  const open: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (VOID_TAGS.has(tag)) continue;
    if (m[0].startsWith('</')) {
      const idx = open.lastIndexOf(tag);
      if (idx !== -1) open.splice(idx, 1);
    } else if (!m[0].endsWith('/>')) {
      open.push(tag);
    }
  }
  let out = html;
  for (let i = open.length - 1; i >= 0; i--) out += `</${open[i]}>`;
  return out;
}

function safeCaption(html: string, max: number): string {
  // Conta i caratteri visibili (esclusi i tag HTML) per trovare il punto di taglio corretto
  let visible = 0;
  let i = 0;
  let cutAt = -1;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      i = end === -1 ? html.length : end + 1;
    } else {
      visible++;
      if (visible === max && cutAt === -1) cutAt = i + 1;
      i++;
    }
  }
  const truncated = visible > max ? html.slice(0, cutAt) + '…' : html;
  // Chiude sempre i tag aperti, anche se il testo non era stato troncato
  return balanceHtmlTags(truncated);
}

// Bot API non supporta <tg-emoji>: li strippiamo prima dell'invio,
// poi ri-applichiamo via MTProto con applyCustomEmoji
function stripTgEmoji(html: string): string {
  return html.replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/g, '$1');
}

const KEYBOARD_COLOR_MAP: Record<string, string> = { g: 'success', r: 'danger', b: 'primary' };

function isValidTgUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /[a-zA-Z]/.test(u.hostname) && u.hostname.includes('.');
  } catch { return false; }
}

async function buildKeyboard(body: string, links: Record<string, string> = {}): Promise<object | undefined> {
  if (!body?.trim()) return undefined;
  const rows = body.trim().split('\n').filter(r => r.trim());
  const keyboard = rows.map(row =>
    row.split('&&').map(b => b.trim()).filter(Boolean).map(btn => {
      const colorMatch = btn.match(/^#([grb])\s+/);
      const style = colorMatch ? KEYBOARD_COLOR_MAP[colorMatch[1]] : undefined;
      const clean = colorMatch ? btn.slice(colorMatch[0].length) : btn;
      const m = clean.match(/^(.*)\s*-\s*(https?:\/\/.+)$/) ?? clean.match(/^(.*)\s+-\s+(.+)$/);
      if (!m) return null;
      let url = m[2].trim();
      for (const [tag, val] of Object.entries(links)) url = url.split(tag).join(val);
      const text = m[1].trim();
      if (!text || !isValidTgUrl(url)) return null;
      return { text, url, ...(style ? { style } : {}) };
    }).filter(Boolean)
  ).filter(r => r.length > 0);
  return keyboard.length ? { inline_keyboard: keyboard } : undefined;
}

async function sendCustomPost(post: Record<string, any>, channel: string, userId: string): Promise<{ ok: boolean; messageId?: number; chatId?: string; error?: string }> {
  if (!BOT_TOKEN) return { ok: false, error: 'BOT_TOKEN mancante' };
  const tgBase = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const rawBody = post.body || '';
  const isBase64 = post.image && String(post.image).startsWith('data:');
  const hasImage = post.image && String(post.image).startsWith('http');
  const maxLen = (isBase64 || hasImage) ? 1024 : 4096;
  // Bot API: testo visibile senza tag, limite applicato al testo
  // MTProto: HTML completo senza limite — GramJS misura il testo, non i tag
  const captionBotApi = safeCaption(stripTgEmoji(rawBody), maxLen);
  const captionMtProto = rawBody;
  const replyMarkup = await buildKeyboard(post.keyboard || '');

  let tgRes: Response;
  if (isBase64) {
    const mimeMatch = String(post.image).match(/^data:([^;]+);base64,/);
    const mime = mimeMatch?.[1] || 'image/jpeg';
    const base64 = String(post.image).replace(/^data:[^;]+;base64,/, '');
    const form = new FormData();
    form.append('chat_id', channel);
    form.append('photo', new Blob([Buffer.from(base64, 'base64')], { type: mime }), 'post.jpg');
    form.append('caption', captionBotApi);
    form.append('parse_mode', 'HTML');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    tgRes = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: form });
  } else if (hasImage) {
    tgRes = await fetch(`${tgBase}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channel, photo: post.image, caption: captionBotApi, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    });
  } else {
    tgRes = await fetch(`${tgBase}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channel, text: captionBotApi, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    });
  }
  const tgData = await tgRes.json() as { ok: boolean; result?: { message_id: number; chat?: { id: number } }; description?: string };
  if (!tgData.ok) return { ok: false, error: tgData.description };
  const messageId = tgData.result?.message_id ?? 0;
  const chatId = String(tgData.result?.chat?.id ?? channel);
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;
  if (messageId) applyCustomEmoji({ baseUserId, chatId, messageId, htmlText: captionMtProto, enabled: true }).catch(() => {});
  return { ok: true, messageId, chatId };
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'PUT', 'DELETE', 'POST'], req, res)) return;
  const rawUserId = requireUserId(req, res);
  if (!rawUserId) return;
  // I custom post sono condivisi tra tutti i profili dello stesso utente
  const userId = rawUserId.includes(':') ? rawUserId.split(':')[0] : rawUserId;
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
