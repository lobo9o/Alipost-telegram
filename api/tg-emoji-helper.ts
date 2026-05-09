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

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=50&allowed_updates=["message"]`);
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

    // Estrai custom_emoji_id da tutte le entities dei messaggi recenti
    const found: Array<{ emojiId: string; fallback: string }> = [];
    const seen = new Set<string>();

    for (const update of (data.result ?? [])) {
      const msg = update.message ?? update.edited_message;
      if (!msg) continue;

      // Le custom emoji arrivano sia in entities che in caption_entities
      const entities: any[] = [
        ...(msg.entities ?? []),
        ...(msg.caption_entities ?? []),
      ];

      for (const ent of entities) {
        if (ent.type === 'custom_emoji' && ent.custom_emoji_id) {
          if (!seen.has(ent.custom_emoji_id)) {
            seen.add(ent.custom_emoji_id);
            // Estrai il carattere fallback dal testo del messaggio
            const txt: string = msg.text ?? msg.caption ?? '';
            const fallback = txt.slice(ent.offset, ent.offset + ent.length) || '✨';
            found.push({ emojiId: ent.custom_emoji_id, fallback });
          }
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, emojis: found.reverse() }));
  } catch (e: any) {
    res.writeHead(500).end(JSON.stringify({ error: e?.message ?? 'Errore sconosciuto' }));
  }
}
