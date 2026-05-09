import type { IncomingMessage, ServerResponse } from 'http';

export default async function handler(req: IncomingMessage & { query?: any }, res: ServerResponse) {
  if ((req as any).method !== 'GET') {
    res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    res.writeHead(400).end(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN non configurato' }));
    return;
  }

  const tgBase = `https://api.telegram.org/bot${botToken}`;

  try {
    const tgRes = await fetch(`${tgBase}/getUpdates?limit=50&allowed_updates=["message"]`);
    if (!tgRes.ok) {
      const txt = await tgRes.text();
      res.writeHead(502).end(JSON.stringify({ error: `Telegram error ${tgRes.status}: ${txt}` }));
      return;
    }
    const data = await tgRes.json() as any;
    if (!data.ok) {
      res.writeHead(502).end(JSON.stringify({ error: data.description ?? 'Errore Telegram' }));
      return;
    }

    const found: Array<{ emojiId: string; fallback: string }> = [];
    const seen = new Set<string>();
    const toDelete: Array<{ chatId: number | string; messageId: number }> = [];

    for (const update of (data.result ?? [])) {
      const msg = update.message ?? update.edited_message;
      if (!msg) continue;

      const entities: any[] = [
        ...(msg.entities ?? []),
        ...(msg.caption_entities ?? []),
      ];

      let hasCustomEmoji = false;
      for (const ent of entities) {
        if (ent.type === 'custom_emoji' && ent.custom_emoji_id) {
          hasCustomEmoji = true;
          if (!seen.has(ent.custom_emoji_id)) {
            seen.add(ent.custom_emoji_id);
            const txt: string = msg.text ?? msg.caption ?? '';
            const fallback = txt.slice(ent.offset, ent.offset + ent.length) || '✨';
            found.push({ emojiId: ent.custom_emoji_id, fallback });
          }
        }
      }

      // Segna per cancellazione tutti i messaggi con emoji custom (tieni la chat pulita)
      if (hasCustomEmoji && msg.chat?.id && msg.message_id) {
        toDelete.push({ chatId: msg.chat.id, messageId: msg.message_id });
      }
    }

    // Cancella i messaggi in parallelo (ignora errori — potrebbero essere già cancellati)
    await Promise.allSettled(
      toDelete.map(({ chatId, messageId }) =>
        fetch(`${tgBase}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        })
      )
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, emojis: found.reverse() }));
  } catch (e: any) {
    res.writeHead(500).end(JSON.stringify({ error: e?.message ?? 'Errore sconosciuto' }));
  }
}
