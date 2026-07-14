export async function applyCustomEmoji(opts: {
  baseUserId: string;
  chatId: string;
  messageId: number;
  htmlText: string;
}): Promise<void> {
  const { baseUserId, chatId, messageId, htmlText } = opts;
  if (!messageId || !chatId || !htmlText) return;

  if (!htmlText.includes('<tg-emoji')) return;

  const getTgClient: ((id: string) => any) | undefined = (globalThis as any).__getTgClient;
  const client = getTgClient?.(baseUserId);
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
