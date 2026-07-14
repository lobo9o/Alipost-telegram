import { getActiveClient } from '../api/tg-monitor/worker.js';

/**
 * Dopo che il bot ha pubblicato un post (via Bot API, che ignora custom_emoji),
 * usa il client MTProto (GramJS) dell'utente per editare il messaggio con le
 * emoji animate. GramJS supporta <tg-emoji emoji-id="..."> nel parser HTML e lo
 * converte automaticamente in MessageEntityCustomEmoji.
 *
 * Se non c'è un client MTProto attivo per baseUserId, la funzione esce in silenzio
 * senza toccare il messaggio già pubblicato.
 */
export async function applyCustomEmoji(opts: {
  baseUserId: string;
  chatId: string;
  messageId: number;
  htmlText: string;
}): Promise<void> {
  const { baseUserId, chatId, messageId, htmlText } = opts;
  if (!messageId || !chatId || !htmlText) return;

  // Controlla se c'è almeno un <tg-emoji> nel testo, altrimenti è inutile editare
  if (!htmlText.includes('<tg-emoji')) return;

  const client = getActiveClient(baseUserId);
  console.log(`[emoji-edit] client per ${baseUserId}: ${client ? `trovato connected=${client.connected}` : 'non trovato'}`);
  if (!client) {
    console.log(`[emoji-edit] nessun client MTProto per ${baseUserId}, skip`);
    return;
  }

  try {
    await (client as any).editMessage(chatId, {
      message: messageId,
      text: htmlText,
      parseMode: 'html',
    });
    console.log(`[emoji-edit] ✅ emoji animate applicate: chatId=${chatId} msgId=${messageId}`);
  } catch (e: any) {
    console.warn(`[emoji-edit] errore edit (non bloccante): ${e.message}`);
  }
}
