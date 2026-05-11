import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, requireUserId } from '../_utils.js';

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT emoji_char, custom_emoji_id
      FROM emoji_ids
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return res.json({ emoji: rows });
  }

  if (req.method === 'POST') {
    const action = (req.body?.action ?? req.query.action) as string | undefined;

    if (action === 'discover') {
      // Carica bot token dalle settings utente
      const [settings] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
      const raw = settings?.data ?? {};
      const cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, any>;
      const botToken = cfg.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return res.status(400).json({ error: 'Token bot non configurato nelle impostazioni' });

      // Leggi offset salvato (per non ri-processare update già visti)
      const savedOffset = Number(cfg.tgUpdateOffset ?? 0);
      const tgBase = `https://api.telegram.org/bot${botToken}`;

      const updRes = await fetch(
        `${tgBase}/getUpdates?offset=${savedOffset}&limit=100&timeout=0&allowed_updates=${encodeURIComponent('["message"]')}`,
      );
      const updData = await updRes.json() as any;
      if (!updData.ok) return res.status(500).json({ error: updData.description ?? 'Errore Telegram' });

      const updates: any[] = updData.result ?? [];
      let newOffset = savedOffset;
      const discovered: Array<{ emoji_char: string; custom_emoji_id: string }> = [];

      for (const upd of updates) {
        newOffset = Math.max(newOffset, upd.update_id + 1);
        const msg = upd.message ?? upd.channel_post;
        if (!msg) continue;
        const entities: any[] = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
        const text: string = msg.text ?? msg.caption ?? '';
        for (const entity of entities) {
          if (entity.type === 'custom_emoji' && entity.custom_emoji_id) {
            // Usa slice JS che lavora in UTF-16 — stesso sistema di Telegram
            const emojiChar = text.slice(entity.offset, entity.offset + entity.length);
            if (emojiChar) discovered.push({ emoji_char: emojiChar, custom_emoji_id: entity.custom_emoji_id });
          }
        }
      }

      // Salva emoji trovate (upsert per char)
      for (const { emoji_char, custom_emoji_id } of discovered) {
        await sql`
          INSERT INTO emoji_ids (user_id, emoji_char, custom_emoji_id)
          VALUES (${userId}, ${emoji_char}, ${custom_emoji_id})
          ON CONFLICT (user_id, emoji_char)
          DO UPDATE SET custom_emoji_id = EXCLUDED.custom_emoji_id
        `;
      }

      // Aggiorna offset in settings così i prossimi discover partono da qui
      if (newOffset > savedOffset) {
        await sql`
          UPDATE settings
          SET data = data || ${sql.json({ tgUpdateOffset: newOffset })}
          WHERE user_id = ${userId}
        `;
      }

      const rows = await sql`
        SELECT emoji_char, custom_emoji_id FROM emoji_ids
        WHERE user_id = ${userId} ORDER BY created_at DESC
      `;
      return res.json({ discovered: discovered.length, emoji: rows });
    }

    // Aggiunta manuale: { emoji_char, custom_emoji_id }
    const { emoji_char, custom_emoji_id } = req.body ?? {};
    if (!emoji_char || !custom_emoji_id) {
      return res.status(400).json({ error: 'emoji_char e custom_emoji_id obbligatori' });
    }
    await sql`
      INSERT INTO emoji_ids (user_id, emoji_char, custom_emoji_id)
      VALUES (${userId}, ${emoji_char}, ${custom_emoji_id})
      ON CONFLICT (user_id, emoji_char)
      DO UPDATE SET custom_emoji_id = EXCLUDED.custom_emoji_id
    `;
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const emojiChar = (req.body?.emoji_char ?? req.query.emoji_char) as string | undefined;
    if (!emojiChar) return res.status(400).json({ error: 'emoji_char obbligatorio' });
    await sql`DELETE FROM emoji_ids WHERE user_id = ${userId} AND emoji_char = ${emojiChar}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
});
