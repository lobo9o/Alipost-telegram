import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

const MARKETPLACE_DOMAINS: Record<string, string> = {
  IT: 'www.amazon.it', US: 'www.amazon.com', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', ES: 'www.amazon.es', UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca',
};

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildMessage(contenuto: string, post: Record<string, any>, affiliateUrl: string): string {
  let t = contenuto;
  t = t.replace(/\{titolo\}/g, esc(post.title));
  t = t.replace(/\{prezzo\}/g, `${Number(post.originalPrice).toFixed(2)}€`);
  t = t.replace(/\{prezzo_scontato\}/g, `<b>${Number(post.discountedPrice).toFixed(2)}€</b>`);
  t = t.replace(/\{sconto\}/g, `<b>${post.discountPercent}%</b>`);
  t = t.replace(/\{custom\}/g, esc(post.customText));
  t = t.replace(/\{link_affiliato\}/g, `<a href="${affiliateUrl}">acquista qui</a>`);
  t = t.replace(/\{minimo_storico\}/g, post.isHistoricalLow ? '🏆 MINIMO STORICO!' : '');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return t;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST', 'PUT', 'DELETE'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { id } = req.query as { id: string };

  // ── DELETE ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    await sql`DELETE FROM posts WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ ok: true });
    return;
  }

  // ── PUT — update post ────────────────────────────────────────
  if (req.method === 'PUT') {
    const p = req.body ?? {};
    const [row] = await sql`
      UPDATE posts SET
        title = ${p.title}, image = ${p.image},
        original_price = ${p.originalPrice}, discounted_price = ${p.discountedPrice},
        discount_percent = ${p.discountPercent}, custom_text = ${p.customText},
        is_historical_low = ${p.isHistoricalLow}, template_id = ${p.templateId},
        layout_id = ${p.layoutId}, emoji = ${p.emoji}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING
        id, platform, source_url AS "sourceUrl", product_id AS "productId",
        title, image, original_price::float AS "originalPrice",
        discounted_price::float AS "discountedPrice", discount_percent AS "discountPercent",
        custom_text AS "customText", is_historical_low AS "isHistoricalLow",
        template_id AS "templateId", layout_id AS "layoutId", emoji
    `;
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
    return;
  }

  // ── POST — publish to Telegram ───────────────────────────────
  const { post, layoutContenuto } = req.body ?? {};
  if (!post) { res.status(400).json({ error: 'post required' }); return; }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  console.log('[publish] start userId:', userId, 'botToken:', botToken ? `set(${botToken.length}chars)` : 'MISSING');
  if (!botToken) { res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN non configurato su Vercel → vai in Vercel Settings → Environment Variables' }); return; }

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

  const channels: string[] = Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];
  console.log('[publish] channels from settings:', channels);
  if (!channels.length) {
    res.status(400).json({ error: 'Nessun canale Telegram configurato. Vai in Impostazioni → Canali Telegram.' });
    return;
  }
  const channel = channels[0];

  // Build affiliate URL
  let affiliateUrl: string = post.sourceUrl ?? '';
  if (!affiliateUrl && post.platform === 'amazon' && post.productId) {
    const mktCode = (cfg.amazon?.marketplace ?? 'IT').toUpperCase();
    const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
    affiliateUrl = `https://${domain}/dp/${post.productId}?tag=${cfg.amazon?.affiliateTag ?? ''}`;
  }

  const defaultLayout = `🔥 <b>{titolo}</b>\n\n💰 {prezzo_scontato} <s>{prezzo}</s>\n🏷️ Sconto: -{sconto}\n\n{custom}`;
  const messageText = buildMessage(layoutContenuto || defaultLayout, post, affiliateUrl);

  const replyMarkup = affiliateUrl
    ? { inline_keyboard: [[{ text: post.platform === 'amazon' ? '🛒 Acquista su Amazon' : '🛒 Acquista su AliExpress', url: affiliateUrl }]] }
    : undefined;

  const tgBase = `https://api.telegram.org/bot${botToken}`;
  const hasImage = post.image && post.image !== 'placeholder.jpg' && post.image.startsWith('http');

  let tgRes: Response;
  if (hasImage) {
    tgRes = await fetch(`${tgBase}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channel,
        photo: post.image,
        caption: messageText.slice(0, 1024),
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } else {
    tgRes = await fetch(`${tgBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channel,
        text: messageText,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  }

  const tgData = await tgRes.json() as { ok: boolean; description?: string };
  console.log('[publish]', channel, hasImage ? 'photo' : 'text', tgRes.status, tgData.ok ? 'ok' : tgData.description);

  if (!tgData.ok) {
    res.status(500).json({ error: `Telegram: ${tgData.description ?? 'errore sconosciuto'}` });
    return;
  }

  res.json({ ok: true });
});
