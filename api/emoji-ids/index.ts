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
      // Il webhook del bot salva le emoji animate in tg_emoji_buffer (per userId base).
      // "Scopri emoji" legge dal buffer e le copia su emoji_ids per il profilo/canale corrente.
      const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;

      const buffered = await sql`
        SELECT emoji_char, custom_emoji_id FROM tg_emoji_buffer
        WHERE base_user_id = ${baseUserId}
      `.catch(() => [] as any[]);

      for (const { emoji_char, custom_emoji_id } of buffered as { emoji_char: string; custom_emoji_id: string }[]) {
        await sql`
          INSERT INTO emoji_ids (user_id, emoji_char, custom_emoji_id)
          VALUES (${userId}, ${emoji_char}, ${custom_emoji_id})
          ON CONFLICT (user_id, emoji_char)
          DO UPDATE SET custom_emoji_id = EXCLUDED.custom_emoji_id
        `;
      }

      const rows = await sql`
        SELECT emoji_char, custom_emoji_id FROM emoji_ids
        WHERE user_id = ${userId} ORDER BY created_at DESC
      `;
      return res.json({ discovered: (buffered as any[]).length, emoji: rows });
    }

    if (action === 'from_pack') {
      // Importa emoji custom da un sticker set Telegram per nome
      const packName = (req.body?.pack_name as string | undefined)?.trim();
      if (!packName) return res.status(400).json({ error: 'pack_name obbligatorio' });

      const [settings] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
      const rawCfg = settings?.data ?? {};
      const cfg2 = (typeof rawCfg === 'string' ? JSON.parse(rawCfg) : rawCfg) as Record<string, any>;
      const botToken2 = cfg2.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken2) return res.status(400).json({ error: 'Token bot non configurato' });

      const tgBase2 = `https://api.telegram.org/bot${botToken2}`;
      const packRes = await fetch(`${tgBase2}/getStickerSet?name=${encodeURIComponent(packName)}`);
      const packData = await packRes.json() as any;
      if (!packData.ok) return res.status(400).json({ error: packData.description ?? 'Pack non trovato' });

      const stickers: any[] = packData.result?.stickers ?? [];
      const customEmoji = stickers.filter((s: any) => s.type === 'custom_emoji' && s.custom_emoji_id && s.emoji);

      for (const s of customEmoji) {
        await sql`
          INSERT INTO emoji_ids (user_id, emoji_char, custom_emoji_id)
          VALUES (${userId}, ${s.emoji}, ${s.custom_emoji_id})
          ON CONFLICT (user_id, emoji_char)
          DO UPDATE SET custom_emoji_id = EXCLUDED.custom_emoji_id
        `;
      }

      const allRows = await sql`SELECT emoji_char, custom_emoji_id FROM emoji_ids WHERE user_id = ${userId} ORDER BY created_at DESC`;
      return res.json({
        imported: customEmoji.length,
        total_in_pack: stickers.length,
        pack_title: packData.result?.title,
        emoji: allRows,
      });
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
