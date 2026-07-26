export async function applyCustomEmoji(opts: {
  baseUserId: string;
  chatId: string;
  messageId: number;
  htmlText: string;
  enabled?: boolean;
}): Promise<void> {
  const { baseUserId, chatId, messageId, htmlText, enabled = true } = opts;
  if (!enabled) return;
  if (!messageId || !chatId || !htmlText) return;

  if (!htmlText.includes('<tg-emoji')) return;

  const getTgClient: ((id: string) => any) | undefined = (globalThis as any).__getTgClient;
  const client = getTgClient?.(baseUserId);
  console.log(`[emoji-edit] client lookup baseUserId=${baseUserId} found=${!!client}`);
  if (!client) {
    console.log(`[emoji-edit] nessun client MTProto per ${baseUserId}, skip`);
    return;
  }

  const preview = htmlText.slice(0, 120).replace(/\n/g, '↵');
  console.log(`[emoji-edit] editMessage chatId=${chatId} msgId=${messageId} htmlLen=${htmlText.length} preview="${preview}"`);
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
