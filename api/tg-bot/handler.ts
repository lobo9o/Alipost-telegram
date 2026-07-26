import sql from '../../lib/db.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

type ConvState = 'idle' | 'waiting_image' | 'waiting_body' | 'waiting_keyboard' | 'waiting_confirm';
interface ConvData { image?: string; body?: string; keyboard?: string }

// ── Telegram API helpers ──────────────────────────────────────────

async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TG_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMsg(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<number | undefined> {
  const r = await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  if (!r?.ok) console.error('[tg-bot] sendMessage error:', r?.description);
  return r?.result?.message_id;
}

async function sendPhoto(chatId: number, photo: string, caption: string, extra: Record<string, unknown> = {}): Promise<number | undefined> {
  if (photo.startsWith('data:')) {
    const mimeMatch = photo.match(/^data:([^;]+);base64,/);
    const mime = mimeMatch?.[1] || 'image/jpeg';
    const base64 = photo.replace(/^data:[^;]+;base64,/, '');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([Buffer.from(base64, 'base64')], { type: mime }), 'post.jpg');
    if (caption) form.append('caption', caption.slice(0, 1024));
    if (extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
    const res = await fetch(`${TG_BASE}/sendPhoto`, { method: 'POST', body: form });
    const r = await res.json() as any;
    if (!r?.ok) console.error('[tg-bot] sendPhoto error:', r?.description);
    return r?.result?.message_id;
  }
  const r = await tg('sendPhoto', { chat_id: chatId, photo, caption: caption.slice(0, 1024), ...extra });
  return r?.result?.message_id;
}

async function deleteMessages(chatId: number, ids: number[]): Promise<void> {
  await Promise.allSettled(ids.map(id => tg('deleteMessage', { chat_id: chatId, message_id: id })));
}

async function downloadTgFile(fileId: string): Promise<string> {
  const r = await tg('getFile', { file_id: fileId });
  const filePath = r?.result?.file_path;
  if (!filePath) return '';
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  if (!res.ok) return '';
  const mime = res.headers.get('content-type') || 'image/jpeg';
  const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  return `data:${mime};base64,${base64}`;
}

// ── HTML entity reconstruction ────────────────────────────────────
// Converte il testo con le entities Telegram in HTML Telegram (conserva <tg-emoji>)

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function entitiesToHtml(text: string, entities: any[] = []): string {
  if (!entities.length) return escHtml(text);

  const events: { pos: number; open: boolean; e: any }[] = [];
  for (const e of entities) {
    events.push({ pos: e.offset, open: true, e });
    events.push({ pos: e.offset + e.length, open: false, e });
  }
  // Ordina per posizione; a parità: prima chiusura (così tag adiacenti non si innestano)
  events.sort((a, b) => a.pos !== b.pos ? a.pos - b.pos : (a.open ? 1 : -1));

  let html = '';
  let i = 0;
  for (const ev of events) {
    while (i < ev.pos) html += escHtml(text[i++]);
    const t = ev.e.type;
    if (ev.open) {
      if      (t === 'bold')         html += '<b>';
      else if (t === 'italic')       html += '<i>';
      else if (t === 'underline')    html += '<u>';
      else if (t === 'strikethrough')html += '<s>';
      else if (t === 'code')         html += '<code>';
      else if (t === 'pre')          html += '<pre>';
      else if (t === 'custom_emoji') html += `<tg-emoji emoji-id="${ev.e.custom_emoji_id}">`;
    } else {
      if      (t === 'bold')         html += '</b>';
      else if (t === 'italic')       html += '</i>';
      else if (t === 'underline')    html += '</u>';
      else if (t === 'strikethrough')html += '</s>';
      else if (t === 'code')         html += '</code>';
      else if (t === 'pre')          html += '</pre>';
      else if (t === 'custom_emoji') html += '</tg-emoji>';
    }
  }
  while (i < text.length) html += escHtml(text[i++]);
  return html;
}

function stripTgEmoji(html: string): string {
  return html.replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/g, '$1');
}

// ── Conversation state (DB) ───────────────────────────────────────

async function getConv(userId: string) {
  const [row] = await sql`SELECT state, data, msg_ids FROM bot_conversations WHERE user_id = ${userId}`;
  return row;
}

async function saveConv(userId: string, state: ConvState, data: ConvData, msgIds: number[]) {
  await sql`
    INSERT INTO bot_conversations (user_id, state, data, msg_ids, updated_at)
    VALUES (${userId}, ${state}, ${sql.json(data)}, ${sql.json(msgIds)}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      state = EXCLUDED.state, data = EXCLUDED.data, msg_ids = EXCLUDED.msg_ids, updated_at = NOW()
  `;
}

async function clearConv(userId: string, chatId: number, msgIds: number[]) {
  await deleteMessages(chatId, msgIds);
  await sql`DELETE FROM bot_conversations WHERE user_id = ${userId}`;
}

// ── Preview + bottone conferma ────────────────────────────────────

const CONFIRM_KB = {
  inline_keyboard: [
    [{ text: '✅ Salva', callback_data: 'save' }, { text: '❌ Annulla', callback_data: 'cancel' }],
    [
      { text: '✏️ Riscrivi testo', callback_data: 'redo_body' },
      { text: '🖼 Cambia immagine', callback_data: 'redo_image' },
      { text: '🎹 Cambia tastiera', callback_data: 'redo_keyboard' },
    ],
  ],
};

async function sendPreviewAndConfirm(chatId: number, userId: string, data: ConvData, msgIds: number[]) {
  // Rimuove tg-emoji e tutti i tag HTML per la preview nel bot (evita ENTITY_TEXT_INVALID
  // da tag troncati a 1024 chars; la formattazione vera viene inviata al canale via MTProto)
  const previewBody = stripTgEmoji(data.body || '').replace(/<[^>]+>/g, '').slice(0, 1024);
  const hasAnim = (data.body || '').includes('<tg-emoji');

  let previewId: number | undefined;
  if (data.image) {
    previewId = await sendPhoto(chatId, data.image, previewBody, {});
  } else if (previewBody.trim()) {
    previewId = await sendMsg(chatId, previewBody, { parse_mode: undefined });
  } else {
    previewId = await sendMsg(chatId, '(Nessun testo)');
  }
  if (previewId) msgIds.push(previewId);

  if (data.keyboard?.trim()) {
    const kbId = await sendMsg(chatId, `🎹 <b>Tastiera:</b>\n<pre>${escHtml(data.keyboard)}</pre>`);
    if (kbId) msgIds.push(kbId);
  }

  if (hasAnim) {
    const noteId = await sendMsg(chatId,
      '✨ <i>Il testo contiene emoji animate — nella preview qui sopra appaiono normali, ma nel canale saranno animate al momento dell\'invio.</i>'
    );
    if (noteId) msgIds.push(noteId);
  }

  const cfmId = await sendMsg(chatId, '<b>Questa è la preview del tuo post.</b>\n\nSalvo?', { reply_markup: CONFIRM_KB });
  if (cfmId) msgIds.push(cfmId);

  await saveConv(userId, 'waiting_confirm', data, msgIds);
}

// ── Salva il post su DB ───────────────────────────────────────────

async function savePostToDB(userId: string, data: ConvData) {
  const plainBody = (data.body || '').replace(/<[^>]+>/g, '').trim();
  const title = plainBody.split('\n')[0].slice(0, 60) || 'Post Promo';
  await sql`
    INSERT INTO custom_posts (user_id, title, image, body, keyboard, schedules)
    VALUES (${userId}, ${title}, ${data.image || ''}, ${data.body || ''}, ${data.keyboard || ''}, ${sql.json([])})
  `;
  console.log(`[tg-bot] post salvato per userId=${userId} title="${title}"`);
}

// ── Update handler principale ─────────────────────────────────────

export async function handleUpdate(update: any) {
  const msg = update.message;
  const cb  = update.callback_query;

  let chatId: number, userId: string, userMsgId: number | undefined;

  if (cb) {
    chatId    = cb.message?.chat?.id;
    userId    = String(cb.from?.id);
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
  } else if (msg) {
    chatId    = msg.chat?.id;
    userId    = String(msg.from?.id);
    userMsgId = msg.message_id;
  } else {
    return;
  }

  if (!chatId || !userId || userId === 'undefined') return;

  const conv   = await getConv(userId);
  const state  = ((conv?.state) || 'idle') as ConvState;
  const data   = (conv?.data   ?? {})  as ConvData;
  const msgIds = (Array.isArray(conv?.msg_ids) ? [...conv.msg_ids] : []) as number[];

  if (userMsgId) msgIds.push(userMsgId);

  const text = msg?.text || '';

  // ── Avvio conversazione (/start newpost o /newpost) ───────────
  if (text === '/newpost' || text.startsWith('/start newpost')) {
    const id1 = await sendMsg(chatId,
      '📢 <b>Nuovo Post Promo</b>\n\n' +
      '1️⃣ Invia l\'<b>immagine</b> del post\n' +
      '    oppure scrivi /skip per saltarla'
    );
    await saveConv(userId, 'waiting_image', {}, userMsgId ? [userMsgId, ...(id1 ? [id1] : [])] : (id1 ? [id1] : []));
    return;
  }

  // ── waiting_image ─────────────────────────────────────────────
  if (state === 'waiting_image') {
    if (msg?.photo) {
      const loadId = await sendMsg(chatId, '⏳ Scarico immagine...');
      const photo = msg.photo[msg.photo.length - 1];
      const image = await downloadTgFile(photo.file_id);
      if (loadId) await tg('deleteMessage', { chat_id: chatId, message_id: loadId });
      const id1 = await sendMsg(chatId,
        '✅ Immagine ricevuta!\n\n' +
        '2️⃣ Invia il <b>testo del post</b>\n' +
        '    Puoi usare emoji animate, <b>grassetto</b>, <i>corsivo</i>, ecc.'
      );
      if (id1) msgIds.push(id1);
      await saveConv(userId, 'waiting_body', { ...data, image }, msgIds);
    } else if (text === '/skip') {
      const id1 = await sendMsg(chatId,
        '⏭ Nessuna immagine.\n\n' +
        '2️⃣ Invia il <b>testo del post</b>\n' +
        '    Puoi usare emoji animate, <b>grassetto</b>, <i>corsivo</i>, ecc.'
      );
      if (id1) msgIds.push(id1);
      await saveConv(userId, 'waiting_body', { ...data, image: '' }, msgIds);
    } else {
      const id1 = await sendMsg(chatId, '⚠️ Invia una <b>foto</b>, oppure /skip per non aggiungere immagini.');
      if (id1) msgIds.push(id1);
      await saveConv(userId, state, data, msgIds);
    }
    return;
  }

  // ── waiting_body ──────────────────────────────────────────────
  if (state === 'waiting_body') {
    const bodyText = msg?.text || msg?.caption || '';
    const entities = msg?.entities || msg?.caption_entities || [];
    if (!bodyText) {
      const id1 = await sendMsg(chatId, '⚠️ Invia il testo del post (puoi usare emoji animate!)');
      if (id1) msgIds.push(id1);
      await saveConv(userId, state, data, msgIds);
      return;
    }
    const body = entitiesToHtml(bodyText, entities);
    const id1 = await sendMsg(chatId,
      '✅ Testo ricevuto!\n\n' +
      '3️⃣ Invia i <b>bottoni della tastiera</b> (o /skip)\n\n' +
      'Formato — una riga = una fila di bottoni:\n' +
      '<pre>🛒 Acquista - https://amazon.it/dp/ASIN\n' +
      '#g 🟢 Offerta - https://amazon.it/dp/ASIN &amp;&amp; #r ℹ️ Info - https://t.me/canale</pre>\n' +
      'Colori: <code>#g</code> verde · <code>#r</code> rosso · <code>#b</code> blu'
    );
    if (id1) msgIds.push(id1);
    await saveConv(userId, 'waiting_keyboard', { ...data, body }, msgIds);
    return;
  }

  // ── waiting_keyboard ──────────────────────────────────────────
  if (state === 'waiting_keyboard') {
    const keyboard = text === '/skip' ? '' : text;
    await sendPreviewAndConfirm(chatId, userId, { ...data, keyboard }, msgIds);
    return;
  }

  // ── waiting_confirm ───────────────────────────────────────────
  if (state === 'waiting_confirm') {
    const cbData = cb?.data;

    if (cbData === 'save') {
      await savePostToDB(userId, data);
      const id1 = await sendMsg(chatId, '✅ <b>Post salvato!</b>\nTorna nell\'app per vederlo, programmarlo e modificarlo.');
      if (id1) msgIds.push(id1);
      setTimeout(() => clearConv(userId, chatId, msgIds).catch(console.error), 3500);

    } else if (cbData === 'cancel') {
      const id1 = await sendMsg(chatId, '❌ Creazione annullata.');
      if (id1) msgIds.push(id1);
      setTimeout(() => clearConv(userId, chatId, msgIds).catch(console.error), 2500);

    } else if (cbData === 'redo_image') {
      const id1 = await sendMsg(chatId, '1️⃣ Invia la nuova <b>immagine</b> (o /skip)');
      if (id1) msgIds.push(id1);
      await saveConv(userId, 'waiting_image', data, msgIds);

    } else if (cbData === 'redo_body') {
      const id1 = await sendMsg(chatId, '2️⃣ Invia il nuovo <b>testo del post</b>');
      if (id1) msgIds.push(id1);
      await saveConv(userId, 'waiting_body', data, msgIds);

    } else if (cbData === 'redo_keyboard') {
      const id1 = await sendMsg(chatId, '3️⃣ Invia i nuovi <b>pulsanti</b> (o /skip)');
      if (id1) msgIds.push(id1);
      await saveConv(userId, 'waiting_keyboard', data, msgIds);

    } else if (msg) {
      // Messaggio testuale durante la conferma
      const id1 = await sendMsg(chatId, 'Usa i pulsanti sopra per salvare, annullare o correggere il post.');
      if (id1) msgIds.push(id1);
      await saveConv(userId, state, data, msgIds);
    }
    return;
  }

  // Stato idle: risposta generica
  if (msg) {
    await sendMsg(chatId,
      '👋 Scrivi /newpost per creare un nuovo post promo.\n' +
      'Oppure usa il pulsante <b>+ Nuovo</b> nell\'app.'
    );
  }
}
