import sql from '../../lib/db.js';

const BOT_TOKEN = process.env.PRIZE_BOT_TOKEN || '';
const TG_BASE   = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method: string, body: object) {
  const res = await fetch(`${TG_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function handlePrizeBotUpdate(update: any) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text   = (msg.text ?? '') as string;
  const fromId = msg.from?.id as number;

  if (text.startsWith('/start prize_')) {
    const quizId = text.slice('/start prize_'.length).trim();
    const [quiz] = await sql`SELECT * FROM quizzes WHERE id = ${quizId}`.catch(() => []);

    if (!quiz) {
      await tg('sendMessage', { chat_id: chatId, text: '❌ Quiz non trovato.' });
      return;
    }

    if (Number(quiz.winner_tg_id) !== Number(fromId)) {
      await tg('sendMessage', { chat_id: chatId, text: '❌ Non sei il vincitore di questo quiz.' });
      return;
    }

    let prizeMsg = '🎁 <b>Hai vinto il Quiz!</b>\n\n';
    if (quiz.prize_code) prizeMsg += `Ecco il tuo codice Buono Amazon:\n\n<code>${quiz.prize_code}</code>\n\n`;
    if (quiz.prize_link) prizeMsg += `🔗 <a href="${quiz.prize_link}">Clicca qui per riscattare il premio</a>\n\n`;
    prizeMsg += 'Buona fortuna la prossima volta agli altri! 😄';

    await tg('sendMessage', { chat_id: chatId, text: prizeMsg, parse_mode: 'HTML' });
    return;
  }

  if (text.startsWith('/start')) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '👋 Benvenuto! Questo bot consegna i premi ai vincitori dei quiz dei nostri canali.\n\nSe hai vinto un quiz, clicca il bottone <b>🎁 Ritira il tuo premio</b> nel post del canale. 🎉',
      parse_mode: 'HTML',
    });
  }
}
