import sql from '../../lib/db.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

type ConvState = 'idle' | 'waiting_image' | 'waiting_body' | 'waiting_keyboard' | 'waiting_confirm' | 'waiting_preview_action';
interface ConvData { image?: string; body?: string; keyboard?: string; editPostId?: string }

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
      else if (t === 'text_link')    html += `<a href="${ev.e.url}">`;
      else if (t === 'custom_emoji') html += `<tg-emoji emoji-id="${ev.e.custom_emoji_id}">`;
    } else {
      if      (t === 'bold')         html += '</b>';
      else if (t === 'italic')       html += '</i>';
      else if (t === 'underline')    html += '</u>';
      else if (t === 'strikethrough')html += '</s>';
      else if (t === 'code')         html += '</code>';
      else if (t === 'pre')          html += '</pre>';
      else if (t === 'text_link')    html += '</a>';
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
  if (data.editPostId) {
    await sql`
      UPDATE custom_posts SET
        title = ${title}, image = ${data.image || ''}, body = ${data.body || ''},
        keyboard = ${data.keyboard || ''}, updated_at = NOW()
      WHERE id = ${data.editPostId} AND user_id = ${userId}
    `;
    console.log(`[tg-bot] post aggiornato userId=${userId} id=${data.editPostId} title="${title}"`);
  } else {
    await sql`
      INSERT INTO custom_posts (user_id, title, image, body, keyboard, schedules)
      VALUES (${userId}, ${title}, ${data.image || ''}, ${data.body || ''}, ${data.keyboard || ''}, ${sql.json([])})
    `;
    console.log(`[tg-bot] post salvato per userId=${userId} title="${title}"`);
  }
}

// ── Quiz callback handler ─────────────────────────────────────────

async function handleQuizCallback(cb: any) {
  const [, quizId, answerIdxStr] = (cb.data as string).split(':');
  const answerIdx  = parseInt(answerIdxStr, 10);
  const winnerTgId = cb.from?.id as number;
  const winnerName = cb.from?.username
    ? `@${cb.from.username}`
    : (cb.from?.first_name ?? String(winnerTgId));

  const [quiz] = await sql`SELECT * FROM quizzes WHERE id = ${quizId}`.catch(() => []);

  if (!quiz || quiz.status !== 'active') {
    const prev = quiz?.winner_username ?? 'qualcun altro';
    await tg('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: `⏰ Troppo tardi! Ha già vinto ${prev}`,
      show_alert: true,
    });
    return;
  }

  const answers = (Array.isArray(quiz.answers) ? quiz.answers : []) as Array<{ text: string; correct: boolean }>;
  const isCorrect = answers[answerIdx]?.correct === true;

  if (!isCorrect) {
    await tg('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: '❌ Risposta sbagliata, riprova!',
      show_alert: false,
    });
    return;
  }

  // Claim atomico: solo il primo ad arrivare vince
  const claimed = await sql`
    UPDATE quizzes SET
      status          = 'won',
      winner_tg_id    = ${winnerTgId},
      winner_username = ${winnerName},
      won_at          = now()
    WHERE id = ${quizId} AND status = 'active'
    RETURNING id
  `.catch(() => []);

  if (!claimed.length) {
    const [updated] = await sql`SELECT winner_username FROM quizzes WHERE id = ${quizId}`.catch(() => []);
    await tg('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: `⏰ Troppo tardi! Ha già vinto ${updated?.winner_username ?? 'qualcun altro'}`,
      show_alert: true,
    });
    return;
  }

  // Notifica vincitore
  await tg('answerCallbackQuery', {
    callback_query_id: cb.id,
    text: '🏆 Hai vinto! Ti mando il buono in privato...',
    show_alert: true,
  });

  // Aggiorna post nel canale
  await tg('editMessageText', {
    chat_id: quiz.channel_id,
    message_id: Number(quiz.message_id),
    text: `✅ <b>Quiz concluso!</b>\n\n❓ ${quiz.question}\n\n🏆 Ha vinto: <b>${winnerName}</b>\n\n<i>Il buono è stato inviato in privato al vincitore.</i>`,
    parse_mode: 'HTML',
  }).catch(() => {});

  const prizeMsg =
    `🎁 <b>Hai vinto il Quiz!</b>\n\n` +
    `Ecco il tuo codice Buono Amazon:\n\n` +
    `<code>${quiz.prize_code}</code>\n\n` +
    `<i>Riscattalo su amazon.it/gc/redeem — buona fortuna la prossima volta agli altri! 😄</i>`;

  // Prova prima con Bot API
  const dmResult = await tg('sendMessage', {
    chat_id: winnerTgId,
    text: prizeMsg,
    parse_mode: 'HTML',
  }).catch(() => null);

  if (!dmResult?.ok) {
    // Fallback: MTProto del profilo che ha creato il quiz
    try {
      const getTgClient = (globalThis as any).__getTgClient;
      const client = getTgClient?.(String(quiz.user_id));
      if (client) {
        const plain = prizeMsg.replace(/<[^>]+>/g, '');
        await (client as any).sendMessage(winnerTgId, { message: plain });
      } else {
        throw new Error('client non disponibile');
      }
    } catch {
      // Ultimo resort: metti il codice nel post del canale (non ideale ma garantisce la consegna)
      await tg('editMessageText', {
        chat_id: quiz.channel_id,
        message_id: Number(quiz.message_id),
        text:
          `✅ <b>Quiz concluso!</b>\n\n❓ ${quiz.question}\n\n🏆 Ha vinto: <b>${winnerName}</b>\n\n` +
          `<i>Il vincitore non ha ancora avviato una chat con il bot — contattaci in privato per ricevere il buono.</i>`,
        parse_mode: 'HTML',
      }).catch(() => {});
    }
  }
}

// ── Update handler principale ─────────────────────────────────────

export async function handleUpdate(update: any) {
  const msg = update.message;
  const cb  = update.callback_query;

  let chatId: number, userId: string, userMsgId: number | undefined;

  if (cb) {
    // Quiz callback: gestisci separatamente (ha il proprio answerCallbackQuery)
    if (typeof cb.data === 'string' && cb.data.startsWith('quiz:')) {
      await handleQuizCallback(cb).catch(e =>
        console.error('[tg-bot] quiz callback errore:', e.message?.slice(0, 120))
      );
      return;
    }
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

  // ── Modifica post esistente (deep link dall'app) ─────────────
  if (text.startsWith('/start edit_')) {
    const postId = text.slice('/start edit_'.length).trim();
    const [post] = await sql`SELECT * FROM custom_posts WHERE id = ${postId} AND user_id = ${userId}`;
    if (!post) {
      await sendMsg(chatId, '❌ Post non trovato o non autorizzato.');
      return;
    }
    const data: ConvData = {
      image: post.image || '',
      body: post.body || '',
      keyboard: post.keyboard || '',
      editPostId: postId,
    };
    const msgIds = userMsgId ? [userMsgId] : [];
    const introId = await sendMsg(chatId, `✏️ <b>Modifica Post</b>\n\nEcco la preview attuale. Usa i pulsanti per modificare o salva direttamente.`);
    if (introId) msgIds.push(introId);
    await sendPreviewAndConfirm(chatId, userId, data, msgIds);
    return;
  }

  // ── Preview post nel bot (deep link dall'app) ─────────────────
  if (text.startsWith('/start preview_')) {
    const postId = text.slice('/start preview_'.length).trim();
    const [post] = await sql`SELECT * FROM custom_posts WHERE id = ${postId} AND user_id = ${userId}`;
    if (!post) {
      await sendMsg(chatId, '❌ Post non trovato o non autorizzato.');
      return;
    }
    const previewBody = stripTgEmoji(post.body || '').replace(/<[^>]+>/g, '').slice(0, 1024);
    const msgIds: number[] = userMsgId ? [userMsgId] : [];
    let previewId: number | undefined;
    if (post.image) {
      previewId = await sendPhoto(chatId, post.image, previewBody, {});
    } else if (previewBody.trim()) {
      previewId = await sendMsg(chatId, previewBody, { parse_mode: undefined });
    } else {
      previewId = await sendMsg(chatId, '(Nessun testo)');
    }
    if (previewId) msgIds.push(previewId);
    const actionKb = {
      inline_keyboard: [[
        { text: '✅ OK — cancella tutto', callback_data: 'preview_ok' },
        { text: '✏️ Modifica', callback_data: 'preview_edit' },
      ]],
    };
    const actionId = await sendMsg(chatId, '👁 <i>Preview reale del post.</i>', { reply_markup: actionKb });
    if (actionId) msgIds.push(actionId);
    await saveConv(userId, 'waiting_preview_action', { editPostId: postId }, msgIds);
    return;
  }

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

  // ── waiting_preview_action ────────────────────────────────────
  if (state === 'waiting_preview_action') {
    const cbData = cb?.data;
    if (cbData === 'preview_ok') {
      await clearConv(userId, chatId, msgIds);
    } else if (cbData === 'preview_edit') {
      const postId = data.editPostId;
      if (!postId) { await clearConv(userId, chatId, msgIds); return; }
      const [post] = await sql`SELECT * FROM custom_posts WHERE id = ${postId} AND user_id = ${userId}`;
      if (!post) {
        await sendMsg(chatId, '❌ Post non trovato.');
        await clearConv(userId, chatId, msgIds);
        return;
      }
      const editData: ConvData = {
        image: post.image || '',
        body: post.body || '',
        keyboard: post.keyboard || '',
        editPostId: postId,
      };
      const introId = await sendMsg(chatId, '✏️ <b>Modifica Post</b>\n\nUsa i pulsanti per modificare o salva direttamente.');
      const newMsgIds: number[] = introId ? [introId] : [];
      await sendPreviewAndConfirm(chatId, userId, editData, newMsgIds);
    }
    return;
  }

  // ── waiting_confirm ───────────────────────────────────────────
  if (state === 'waiting_confirm') {
    const cbData = cb?.data;

    if (cbData === 'save') {
      await savePostToDB(userId, data);
      const saveMsg = data.editPostId
        ? '✅ <b>Post aggiornato!</b>\nTorna nell\'app per vederlo.'
        : '✅ <b>Post salvato!</b>\nTorna nell\'app per vederlo, programmarlo e modificarlo.';
      const id1 = await sendMsg(chatId, saveMsg);
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

  // Stato idle: intercetta emoji animate → buffer temporaneo, altrimenti risposta generica
  if (msg) {
    const entities: any[] = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
    const text: string = msg.text ?? msg.caption ?? '';
    const discovered: Array<{ emoji_char: string; custom_emoji_id: string }> = [];
    for (const entity of entities) {
      if (entity.type === 'custom_emoji' && entity.custom_emoji_id) {
        const emojiChar = text.slice(entity.offset, entity.offset + entity.length);
        if (emojiChar) discovered.push({ emoji_char: emojiChar, custom_emoji_id: String(entity.custom_emoji_id) });
      }
    }
    if (discovered.length > 0) {
      // Salva nel buffer temporaneo (non in emoji_ids): l'utente poi preme "Scopri emoji"
      // dal canale specifico e le emoji vengono trasferite sul profilo giusto.
      await sql`
        CREATE TABLE IF NOT EXISTS tg_emoji_buffer (
          base_user_id TEXT NOT NULL,
          emoji_char   TEXT NOT NULL,
          custom_emoji_id TEXT NOT NULL,
          received_at  TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (base_user_id, emoji_char)
        )
      `.catch(() => {});
      for (const { emoji_char, custom_emoji_id } of discovered) {
        await sql`
          INSERT INTO tg_emoji_buffer (base_user_id, emoji_char, custom_emoji_id)
          VALUES (${userId}, ${emoji_char}, ${custom_emoji_id})
          ON CONFLICT (base_user_id, emoji_char)
          DO UPDATE SET custom_emoji_id = EXCLUDED.custom_emoji_id, received_at = now()
        `.catch(() => {});
      }
      const replyId = await sendMsg(chatId,
        `✅ ${discovered.length} emoji anim${discovered.length === 1 ? 'ata rilevata' : 'ate rilevate'}!\n` +
        'Ora vai nel <b>canale</b> nell\'app e premi <b>Scopri emoji</b> per salvarle.'
      );
      // Cancella il messaggio utente e la risposta del bot dopo 6 secondi
      const toDelete = [replyId, userMsgId].filter(Boolean) as number[];
      setTimeout(() => {
        Promise.allSettled(toDelete.map(id => tg('deleteMessage', { chat_id: chatId, message_id: id })));
      }, 6000);
      return;
    }
    await sendMsg(chatId,
      '👋 Scrivi /newpost per creare un nuovo post promo.\n' +
      'Oppure usa il pulsante <b>+ Nuovo</b> nell\'app.'
    );
  }
}
