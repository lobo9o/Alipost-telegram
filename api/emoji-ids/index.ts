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

      console.log(`[emoji-discover] userId=${userId} savedOffset=${savedOffset}`);
      const updRes = await fetch(
        `${tgBase}/getUpdates?offset=${savedOffset}&limit=100&timeout=0&allowed_updates=${encodeURIComponent('["message"]')}`,
      );
      const updData = await updRes.json() as any;
      console.log(`[emoji-discover] getUpdates ok=${updData.ok} count=${updData.result?.length ?? 0} err=${updData.description ?? ''}`);
      if (!updData.ok) return res.status(500).json({ error: updData.description ?? 'Errore Telegram' });

      const updates: any[] = updData.result ?? [];
      let newOffset = savedOffset;
      const discovered: Array<{ emoji_char: string; custom_emoji_id: string }> = [];

      for (const upd of updates) {
        newOffset = Math.max(newOffset, upd.update_id + 1);
        const msg = upd.message ?? upd.channel_post;
        if (!msg) { console.log(`[emoji-discover] upd=${upd.update_id} no message`); continue; }
        const entities: any[] = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
        const text: string = msg.text ?? msg.caption ?? '';
        const entityTypes = entities.map((e: any) => e.type).join(',');
        console.log(`[emoji-discover] upd=${upd.update_id} msg=${msg.message_id} chat=${msg.chat?.id} entities=[${entityTypes}] text="${text.slice(0,20)}"`);
        for (const entity of entities) {
          if (entity.type === 'custom_emoji' && entity.custom_emoji_id) {
            // Usa slice JS che lavora in UTF-16 — stesso sistema di Telegram
            const emojiChar = text.slice(entity.offset, entity.offset + entity.length);
            console.log(`[emoji-discover] found custom_emoji char="${emojiChar}" id=${entity.custom_emoji_id}`);
            if (emojiChar) discovered.push({ emoji_char: emojiChar, custom_emoji_id: entity.custom_emoji_id });
          }
        }
      }
      console.log(`[emoji-discover] discovered=${discovered.length}`);

      // Salva emoji trovate (upsert per char)
      for (const { emoji_char, custom_emoji_id } of discovered) {
        await sql`
          INSERT INTO emoji_ids (user_id, emoji_char, custom_emoji_id)
          VALUES (${userId}, ${emoji_char}, ${custom_emoji_id})
          ON CONFLICT (user_id, emoji_char)
          DO UPDATE SET custom_emoji_id = EXCLUDED.custom_emoji_id
        `;
      }

      // Cancella i messaggi che contenevano emoji custom (mantiene la chat pulita)
      const msgsToDelete: Array<{ chatId: number; messageId: number }> = [];
      for (const upd of updates) {
        const msg = upd.message ?? upd.channel_post;
        if (!msg) continue;
        const entities: any[] = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
        const hasCustomEmoji = entities.some((e: any) => e.type === 'custom_emoji');
        if (hasCustomEmoji) msgsToDelete.push({ chatId: msg.chat.id, messageId: msg.message_id });
      }
      for (const { chatId, messageId } of msgsToDelete) {
        await fetch(`${tgBase}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        }).catch(() => null);
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
